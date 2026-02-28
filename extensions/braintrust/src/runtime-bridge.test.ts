import { describe, expect, it } from "vitest";
import { runRuntimeBridge } from "./runtime-bridge.js";
import { DEFAULT_SETTINGS } from "./settings.js";

describe("runRuntimeBridge", () => {
  it("returns deterministic final answer when quorum passes", async () => {
    const settings = { ...DEFAULT_SETTINGS, enabled: true, teamSize: 3 };
    const result = await runRuntimeBridge(
      { prompt: "hello", settings },
      async ({ role }) => {
        if (role === "critic") return { text: "a longer candidate answer", refusal: false };
        return { text: "short", refusal: false };
      },
    );
    expect(result.unavailable).toBe(false);
    expect(result.final).toBe("short");
    expect(result.synthesis?.winnerId).toBe("agent-1");
  });

  it("returns unavailable when quorum misses due to timeouts/errors", async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      enabled: true,
      teamSize: 3,
      minParticipatingAgents: 2,
      minAnsweringAgents: 2,
    };
    const result = await runRuntimeBridge(
      { prompt: "hello", settings },
      async ({ role }) => {
        if (role === "solver") return { text: "ok", refusal: false };
        if (role === "critic") throw new Error("timeout after 90s");
        throw new Error("provider failed");
      },
    );
    expect(result.unavailable).toBe(true);
    expect(result.final.toLowerCase()).toContain("temporarily unavailable");
  });

  it("treats refusals as non-answering participants", async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      enabled: true,
      teamSize: 3,
      minParticipatingAgents: 2,
      minAnsweringAgents: 2,
    };
    const result = await runRuntimeBridge(
      { prompt: "hello", settings },
      async ({ role }) => {
        if (role === "solver") return { text: "ok", refusal: false };
        if (role === "critic") return { text: "cannot comply", refusal: true };
        return { text: "cannot comply", refusal: true };
      },
    );
    expect(result.unavailable).toBe(true);
    expect(result.reason).toContain("usable answers");
  });

  it("classifies refusal text even when explicit refusal flag is omitted", async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      enabled: true,
      teamSize: 3,
      minParticipatingAgents: 2,
      minAnsweringAgents: 2,
    };

    const result = await runRuntimeBridge(
      { prompt: "hello", settings },
      async ({ role }) => {
        if (role === "solver") return { text: "ok" };
        return { text: "I'm sorry, I cannot help with that." };
      },
    );

    expect(result.candidates.filter((c) => c.status === "refusal")).toHaveLength(2);
    expect(result.unavailable).toBe(true);
  });

  it("uses three scout models and reserves synth model for judge", async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      enabled: true,
      teamSize: 4,
      model: "gemini-3-flash-preview",
      criticModel: "openai-codex/gpt-5.3-codex",
      researcherModel: "grok-4-1-fast-reasoning",
      synthModel: "gemini-3.1-pro-preview",
      minParticipatingAgents: 2,
      minAnsweringAgents: 2,
    };
    const seen: string[] = [];
    const result = await runRuntimeBridge(
      { prompt: "hello", settings },
      async ({ model }) => {
        seen.push(model);
        return { text: `ok-${model}`, refusal: false };
      },
    );
    expect(result.unavailable).toBe(false);
    expect(new Set(seen)).toEqual(
      new Set([
        "gemini-3-flash-preview",
        "openai-codex/gpt-5.3-codex",
        "grok-4-1-fast-reasoning",
      ]),
    );
    expect(result.telemetry?.judgeModel ?? "deterministic").toBe("deterministic");
  });
});
