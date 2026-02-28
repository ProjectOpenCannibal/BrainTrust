import { buildUnavailableNotice, evaluateQuorum, type Candidate, type CandidateStatus } from "./policy.js";
import type { BraintrustSettings } from "./settings.js";
import { synthesizeDeterministic, synthesizeWithJudge, type JudgeRunnerFn, type SynthesisOutput } from "./synth.js";

export type CandidateRunnerInput = {
  role: "solver" | "critic" | "researcher";
  model: string;
  prompt: string;
  timeoutSeconds: number;
};

export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type CandidateRunnerOutput = {
  text: string;
  refusal?: boolean;
  latencyMs?: number;
  tokenUsage?: TokenUsage;
};

export type CandidateRunner = (input: CandidateRunnerInput) => Promise<CandidateRunnerOutput>;

export type RuntimeBridgeInput = {
  prompt: string;
  settings: BraintrustSettings;
};

export type RuntimeBridgeTelemetry = {
  totalLatencyMs: number;
  candidateLatencies: { id: string; model: string; latencyMs: number; status: CandidateStatus }[];
  judgeLatencyMs?: number;
  judgeModel?: string;
};

export type RuntimeBridgeResult = {
  final: string;
  candidates: Candidate[];
  unavailable: boolean;
  reason?: string;
  synthesis?: SynthesisOutput;
  telemetry?: RuntimeBridgeTelemetry;
};

function roleFor(index: number): CandidateRunnerInput["role"] {
  if (index === 1) return "critic";
  if (index === 2) return "researcher";
  return "solver";
}

/**
 * All scouts use their assigned scout models.
 * The synth model is reserved for the judge pass and never used as a scout.
 */
function scoutModelFor(index: number, settings: BraintrustSettings): string {
  if (index === 1) return settings.criticModel;
  if (index === 2) return settings.researcherModel;
  return settings.model;
}

function classifyError(error: unknown): CandidateStatus {
  const msg = String(error ?? "").toLowerCase();
  if (msg.includes("timeout")) return "timeout";
  return "error";
}

function isLikelyRefusal(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const lower = t.toLowerCase();
  // Avoid false positives on long substantive answers.
  if (t.length > 500) return false;
  return [
    "i can't",
    "i cannot",
    "can't help with",
    "cannot help with",
    "cannot comply",
    "i'm sorry",
    "i am sorry",
    "as an ai",
    "unable to assist",
    "i must refuse",
  ].some((needle) => lower.includes(needle));
}

async function withTimeout<T>(promise: Promise<T>, timeoutSeconds: number): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(`timeout after ${timeoutSeconds}s`)), timeoutSeconds * 1000);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

export async function runRuntimeBridge(
  input: RuntimeBridgeInput,
  runCandidate: CandidateRunner,
  judgeRunner?: JudgeRunnerFn,
): Promise<RuntimeBridgeResult> {
  const bridgeStart = Date.now();
  const scoutCount = Math.min(input.settings.teamSize, 3);

  const tasks = Array.from({ length: scoutCount }, async (_, i) => {
    const id = `agent-${i + 1}`;
    const model = scoutModelFor(i, input.settings);
    const started = Date.now();
    try {
      const out = await withTimeout(
        runCandidate({
          role: roleFor(i),
          model,
          prompt: input.prompt,
          timeoutSeconds: input.settings.timeoutSeconds,
        }),
        input.settings.timeoutSeconds,
      );
      const latencyMs = out.latencyMs ?? Date.now() - started;
      const refusal = out.refusal ?? isLikelyRefusal(out.text);
      return {
        id,
        model,
        status: refusal ? "refusal" : "ok",
        text: out.text,
        latencyMs,
      } as Candidate;
    } catch (err) {
      return {
        id,
        model,
        status: classifyError(err),
        latencyMs: Date.now() - started,
      } as Candidate;
    }
  });

  const candidates = await Promise.all(tasks);
  const quorum = evaluateQuorum(candidates, {
    minParticipatingAgents: input.settings.minParticipatingAgents,
    minAnsweringAgents: input.settings.minAnsweringAgents,
  });

  if (!quorum.meetsQuorum) {
    return {
      final: buildUnavailableNotice(quorum),
      candidates,
      unavailable: true,
      reason: quorum.reason,
      telemetry: {
        totalLatencyMs: Date.now() - bridgeStart,
        candidateLatencies: candidates.map((c) => ({
          id: c.id,
          model: c.model,
          latencyMs: c.latencyMs ?? 0,
          status: c.status,
        })),
      },
    };
  }

  let synthesis: SynthesisOutput;
  if (judgeRunner) {
    synthesis = await synthesizeWithJudge(
      { prompt: input.prompt, candidates },
      judgeRunner,
      input.settings.synthModel,
      input.settings.timeoutSeconds,
    );
  } else {
    synthesis = synthesizeDeterministic({ prompt: input.prompt, candidates });
  }

  const telemetry: RuntimeBridgeTelemetry = {
    totalLatencyMs: Date.now() - bridgeStart,
    candidateLatencies: candidates.map((c) => ({
      id: c.id,
      model: c.model,
      latencyMs: c.latencyMs ?? 0,
      status: c.status,
    })),
    judgeLatencyMs: synthesis.judgeLatencyMs,
    judgeModel: synthesis.judgeModel,
  };

  const final = synthesis.final ?? buildUnavailableNotice({
    participating: 0,
    answering: 0,
    refused: 0,
    failed: candidates.length,
    meetsQuorum: false,
    reason: "no usable candidate output",
  });

  return {
    final,
    candidates,
    unavailable: false,
    synthesis,
    telemetry,
  };
}
