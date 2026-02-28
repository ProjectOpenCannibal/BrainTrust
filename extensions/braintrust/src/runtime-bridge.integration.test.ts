import { describe, expect, it } from "vitest";
import { runRuntimeBridge } from "./runtime-bridge.js";
import { DEFAULT_SETTINGS } from "./settings.js";

describe("runtime bridge integration flow", () => {
  it("handles timeout + refusal plumbing and still synthesizes deterministic winner", async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      enabled: true,
      teamSize: 4,
      timeoutSeconds: 1,
      minParticipatingAgents: 2,
      minAnsweringAgents: 2,
    };

    const started = Date.now();
    const result = await runRuntimeBridge(
      { prompt: "Build a rollout plan", settings },
      async ({ role, model }) => {
        if (role === "critic") {
          // Should be auto-classified as refusal by text even without refusal flag.
          return { text: "As an AI, I cannot provide this." };
        }
        if (role === "researcher") {
          // Should be converted into timeout by runtime bridge guardrail.
          await new Promise((resolve) => setTimeout(resolve, 1500));
          return { text: "late answer" };
        }
        // 4th worker uses synthModel but still acts as candidate in bridge fan-out.
        if (model === settings.synthModel) return { text: "brief" };
        return { text: "solid plan" };
      },
    );

    const tookMs = Date.now() - started;
    expect(tookMs).toBeLessThan(1400);

    expect(result.unavailable).toBe(false);
    expect(result.final).toBe("brief");
    expect(result.synthesis?.winnerId).toBe("agent-4");

    const byId = Object.fromEntries(result.candidates.map((c) => [c.id, c]));
    expect(byId["agent-2"].status).toBe("refusal");
    expect(byId["agent-3"].status).toBe("timeout");
    expect(byId["agent-1"].status).toBe("ok");
    expect(byId["agent-4"].status).toBe("ok");
  });
});
