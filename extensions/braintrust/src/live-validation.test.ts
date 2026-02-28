import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("openclaw/plugin-sdk", () => ({
  emptyPluginConfigSchema: () => ({}),
}));

type HookHandler = (args: { event: unknown; context?: unknown }) => Promise<{ prependContext?: string } | void>;

type FakeApi = {
  pluginConfig: Record<string, unknown>;
  logger: { info: (message: string) => void };
  registerCommand: (command: unknown) => void;
  on: (name: string, handler: HookHandler) => void;
};

function setupApi(pluginConfig: Record<string, unknown> = {}) {
  const hooks = new Map<string, HookHandler>();
  const commands: unknown[] = [];
  const logger = { info: vi.fn() };
  const api: FakeApi = {
    pluginConfig,
    logger,
    registerCommand: (command) => {
      commands.push(command);
    },
    on: (name, handler) => {
      hooks.set(name, handler);
    },
  };
  return { api, hooks, commands, logger };
}

type Command = { handler: (ctx: { args?: string }) => Promise<{ text: string }> };

describe("live braintrust validation flow", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("validates /braintrust on + status + synthesized output path", async () => {
    const { default: plugin } = await import("../index.ts");
    const { api, hooks, commands } = setupApi({ enabled: false, teamSize: 3 });

    plugin.register(api as never);

    const cmd = commands[0] as Command;
    const on = await cmd.handler({ args: "on" });
    const status = await cmd.handler({ args: "status" });

    expect(on.text).toContain("Braintrust: ON");
    expect(status.text).toContain("Braintrust: ON");

    const beforePromptBuild = hooks.get("before_prompt_build");
    expect(beforePromptBuild).toBeTypeOf("function");

    const out = await beforePromptBuild!({
      event: { messages: [{ role: "user", content: "Give me one rollout recommendation." }] },
      context: {
        runModel: async ({ role }: { role: string }) => {
          if (role === "critic") return { text: "Keep it small and reversible." };
          if (role === "researcher") return { text: "Ship behind a feature flag." };
          return { text: "Start with a 5% canary and monitor error budgets." };
        },
      },
    });

    const prepend = out?.prependContext ?? "";
    expect(prepend).toContain("Use this runtime-bridge synthesis as your final answer.");

    const lines = prepend
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.startsWith("BRAINTRUST MODE ACTIVE"))
      .filter((line) => !line.startsWith("Use this runtime-bridge synthesis as your final answer."));

    expect(lines).toHaveLength(1);
  });

  it("returns explicit unavailable notice when quorum is not met", async () => {
    const { default: plugin } = await import("../index.ts");
    const { api, hooks, commands } = setupApi({ enabled: true, teamSize: 4, minAnsweringAgents: 3, minParticipatingAgents: 3 });

    plugin.register(api as never);

    const cmd = commands[0] as Command;
    const status = await cmd.handler({ args: "status" });
    expect(status.text).toContain("Braintrust: ON");

    const beforePromptBuild = hooks.get("before_prompt_build");
    const out = await beforePromptBuild!({
      event: { messages: [{ role: "user", content: "Give me one rollout recommendation." }] },
      context: {
        runModel: async ({ role }: { role: string }) => {
          if (role === "critic") return { text: "I cannot comply with that request." };
          if (role === "researcher") throw new Error("simulated timeout");
          return { text: "candidate" };
        },
      },
    });

    expect(out?.prependContext).toContain("Quorum could not be satisfied");
    expect(out?.prependContext).toContain("Braintrust temporarily unavailable");
  });
});
