import type { Candidate } from "./policy.js";

export type SynthesisInput = {
  prompt: string;
  candidates: Candidate[];
};

export type SynthesisOutput = {
  final: string;
  winnerId?: string;
};

/**
 * Deterministic synthesis placeholder.
 * - prefers shortest successful candidate (concise bias)
 * - stable tie-break by id
 */
export function synthesizeDeterministic(input: SynthesisInput): SynthesisOutput {
  const ok = input.candidates.filter((c) => c.status === "ok" && c.text?.trim());
  if (ok.length === 0) {
    return {
      final: "Braintrust temporarily unavailable (no usable candidate output).",
    };
  }
  ok.sort((a, b) => {
    const la = (a.text ?? "").length;
    const lb = (b.text ?? "").length;
    if (la !== lb) return la - lb;
    return a.id.localeCompare(b.id);
  });
  return {
    final: ok[0].text ?? "",
    winnerId: ok[0].id,
  };
}
