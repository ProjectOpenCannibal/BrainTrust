import { describe, expect, it } from "vitest";
import { buildUnavailableNotice, evaluateQuorum } from "./policy.js";

describe("evaluateQuorum", () => {
  it("passes when at least 2 agents answer", () => {
    const result = evaluateQuorum([
      { id: "a", model: "sonnet", status: "ok" },
      { id: "b", model: "gpt", status: "ok" },
      { id: "c", model: "grok", status: "timeout" },
      { id: "d", model: "gemini", status: "refusal" },
    ]);
    expect(result.meetsQuorum).toBe(true);
    expect(result.participating).toBe(3);
    expect(result.answering).toBe(2);
  });

  it("fails when only 1 agent participated", () => {
    const result = evaluateQuorum([
      { id: "a", model: "sonnet", status: "ok" },
      { id: "b", model: "gpt", status: "timeout" },
      { id: "c", model: "grok", status: "error" },
    ]);
    expect(result.meetsQuorum).toBe(false);
    expect(result.reason).toContain("participated");
    expect(buildUnavailableNotice(result)).toContain("temporarily unavailable");
  });

  it("fails when participation is enough but answering is too low", () => {
    const result = evaluateQuorum([
      { id: "a", model: "sonnet", status: "refusal" },
      { id: "b", model: "gpt", status: "ok" },
      { id: "c", model: "grok", status: "refusal" },
    ]);
    expect(result.meetsQuorum).toBe(false);
    expect(result.reason).toContain("usable answers");
  });
});
