import { describe, expect, it } from "vitest";
import { synthesizeDeterministic } from "./synth.js";

describe("synthesizeDeterministic", () => {
  it("picks shortest successful candidate", () => {
    const out = synthesizeDeterministic({
      prompt: "hello",
      candidates: [
        { id: "a", model: "x", status: "ok", text: "this is longer" },
        { id: "b", model: "y", status: "ok", text: "short" },
      ],
    });
    expect(out.final).toBe("short");
    expect(out.winnerId).toBe("b");
  });

  it("returns unavailable when no usable outputs", () => {
    const out = synthesizeDeterministic({
      prompt: "hello",
      candidates: [{ id: "a", model: "x", status: "refusal", text: "cannot" }],
    });
    expect(out.final.toLowerCase()).toContain("temporarily unavailable");
  });
});
