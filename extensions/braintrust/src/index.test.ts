import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("openclaw/plugin-sdk", () => ({
  emptyPluginConfigSchema: () => ({}),
}));

type HookHandler = (args: unknown) => Promise<{ prependContext?: string } | void>;

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

describe("braintrust plugin runtime integration", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("executes runtime bridge through before_prompt_build when runtime executor exists", async () => {
    const { default: plugin } = await import("../index.js");
    const calls: Array<{ model: string; role: string }> = [];
    const { api, hooks } = setupApi({ enabled: true, teamSize: 3 });

    plugin.register(api as never);

    const beforePromptBuild = hooks.get("before_prompt_build");
    expect(beforePromptBuild).toBeTypeOf("function");

    const out = await beforePromptBuild!({
      event: { messages: [{ role: "user", content: "What is 2+2?" }] },
      context: {
        runModel: async ({ model, role }: { model: string; role: string }) => {
          calls.push({ model, role });
          if (role === "critic") return { text: "The answer is likely four." };
          return { text: "4" };
        },
      },
    });

    expect(calls).toHaveLength(3);
    expect(out?.prependContext).toContain("Use this runtime-bridge synthesis as your final answer.");
    expect(out?.prependContext).toContain("4");
  });

  it("falls back to policy-only injection when runtime executor is missing", async () => {
    const { default: plugin } = await import("../index.js");
    const { api, hooks } = setupApi({ enabled: true, teamSize: 3 });

    plugin.register(api as never);

    const beforePromptBuild = hooks.get("before_prompt_build");
    const out = await beforePromptBuild!({
      event: { messages: [{ role: "user", content: "Hello" }] },
      context: {},
    });

    expect(out?.prependContext).toContain("BRAINTRUST MODE ACTIVE.");
    expect(out?.prependContext).toContain("Simulate roles:");
  });

  it("tolerates missing or malformed before_prompt_build payloads", async () => {
    const { default: plugin } = await import("../index.js");
    const { api, hooks } = setupApi({ enabled: true, teamSize: 3 });

    plugin.register(api as never);

    const beforePromptBuild = hooks.get("before_prompt_build");
    expect(beforePromptBuild).toBeTypeOf("function");

    const malformedPayloads: unknown[] = [undefined, null, "oops", 42, {}, { event: null }, { event: { messages: null } }];

    for (const payload of malformedPayloads) {
      await expect(beforePromptBuild!(payload)).resolves.not.toThrow();
    }
  });

  it("tolerates missing or malformed llm_input/llm_output payloads", async () => {
    const { default: plugin } = await import("../index.js");
    const { api, hooks, logger } = setupApi({ enabled: true, teamSize: 3 });

    plugin.register(api as never);

    const llmInput = hooks.get("llm_input");
    const llmOutput = hooks.get("llm_output");

    expect(llmInput).toBeTypeOf("function");
    expect(llmOutput).toBeTypeOf("function");

    const malformedPayloads: unknown[] = [undefined, null, "oops", 42, {}, { event: null }, { event: { assistantTexts: "bad" } }];

    for (const payload of malformedPayloads) {
      await expect(llmInput!(payload)).resolves.not.toThrow();
      await expect(llmOutput!(payload)).resolves.not.toThrow();
    }

    expect(logger.info).toHaveBeenCalled();
  });

});
