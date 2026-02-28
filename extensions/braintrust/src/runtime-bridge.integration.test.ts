import { describe, expect, it } from "vitest";
import { runRuntimeBridge } from "./runtime-bridge.js";
import { DEFAULT_SETTINGS } from "./settings.js";

describe("runtime bridge integration flow", () => {
  it("handles timeout + refusal plumbing and synthesizes via judge", async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      enabled: true,
      teamSize: 4,
      timeoutSeconds: 1,
      minParticipatingAgents: 2,
      minAnsweringAgents: 1,
    };

    const started = Date.now();
    const result = await runRuntimeBridge(
      { prompt: "Build a rollout plan", settings },
      async ({ role }) => {
        if (role === "critic") {
          return { text: "consider a phased rollout with guardrails" };
        }
        if (role === "researcher") {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          return { text: "late answer" };
        }
        return { text: "solid plan" };
      },
      async () => ({ text: "judge merged answer", latencyMs: 25 }),
    );

    const tookMs = Date.now() - started;
    expect(tookMs).toBeLessThan(1400);

    expect(result.unavailable).toBe(false);
    expect(result.final).toBe("judge merged answer");
    expect(result.synthesis?.judgeModel).toBe(settings.synthModel);

    const byId = Object.fromEntries(result.candidates.map((c) => [c.id, c]));
    expect(byId["agent-2"].status).toBe("ok");
    expect(byId["agent-3"].status).toBe("timeout");
    expect(byId["agent-1"].status).toBe("ok");
  });
});
