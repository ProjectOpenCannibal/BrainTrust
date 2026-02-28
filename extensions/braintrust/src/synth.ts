import type { Candidate } from "./policy.js";

export type SynthesisInput = {
  prompt: string;
  candidates: Candidate[];
};

export type SynthesisOutput = {
  final: string | undefined;
  winnerId?: string;
  judgeModel?: string;
  judgeLatencyMs?: number;
};

export type JudgeRunnerFn = (opts: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  timeoutSeconds: number;
}) => Promise<{ text: string; latencyMs?: number }>;

/**
 * Deterministic fallback synthesis.
 * Used when no judge runner is available.
 * Prefers shortest successful candidate (concise bias), stable tie-break by id.
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

function buildJudgePrompt(userPrompt: string, candidates: Candidate[]): string {
  const ok = candidates.filter((c) => c.status === "ok" && c.text?.trim());
  const candidateBlocks = ok
    .map(
      (c, i) =>
        `--- Scout ${i + 1} (${c.model}, ${c.id}) ---\n${c.text}\n--- End Scout ${i + 1} ---`,
    )
    .join("\n\n");

  return [
    "You are the Braintrust Judge. You have received responses from multiple scout agents to the same user prompt.",
    "Your job: synthesize the best parts of each response into ONE final answer.",
    "Rules:",
    "- Merge the strongest facts, reasoning, and details from all scouts.",
    "- Resolve any contradictions by favoring the most well-supported claim.",
    "- Do NOT mention the scouts, the panel, or this process in your answer.",
    "- Output ONLY the final merged answer. No meta-commentary.",
    "",
    `USER PROMPT: ${userPrompt}`,
    "",
    "SCOUT RESPONSES:",
    candidateBlocks,
  ].join("\n");
}

/**
 * Real synthesis: runs the synth/judge model with all scout outputs.
 * Falls back to deterministic if judge runner fails.
 */
export async function synthesizeWithJudge(
  input: SynthesisInput,
  judgeRunner: JudgeRunnerFn,
  judgeModel: string,
  timeoutSeconds: number,
): Promise<SynthesisOutput> {
  const ok = input.candidates.filter((c) => c.status === "ok" && c.text?.trim());
  if (ok.length === 0) {
    return { final: undefined };
  }

  if (ok.length === 1) {
    return { final: ok[0].text ?? "", winnerId: ok[0].id };
  }

  try {
    const started = Date.now();
    const result = await judgeRunner({
      model: judgeModel,
      systemPrompt: "You are the Braintrust Judge. Merge scout outputs into one best answer.",
      userPrompt: buildJudgePrompt(input.prompt, input.candidates),
      timeoutSeconds,
    });
    return {
      final: result.text.trim(),
      judgeModel,
      judgeLatencyMs: result.latencyMs ?? Date.now() - started,
    };
  } catch {
    return synthesizeDeterministic(input);
  }
}
