import { buildUnavailableNotice, evaluateQuorum, type Candidate, type CandidateStatus } from "./policy.js";
import type { BraintrustSettings } from "./settings.js";
import { synthesizeDeterministic, type SynthesisOutput } from "./synth.js";

export type CandidateRunnerInput = {
  role: "solver" | "critic" | "researcher";
  model: string;
  prompt: string;
  timeoutSeconds: number;
};

export type CandidateRunnerOutput = {
  text: string;
  refusal?: boolean;
  latencyMs?: number;
};

export type CandidateRunner = (input: CandidateRunnerInput) => Promise<CandidateRunnerOutput>;

export type RuntimeBridgeInput = {
  prompt: string;
  settings: BraintrustSettings;
};

export type RuntimeBridgeResult = {
  final: string;
  candidates: Candidate[];
  unavailable: boolean;
  reason?: string;
  synthesis?: SynthesisOutput;
};

function roleFor(index: number): CandidateRunnerInput["role"] {
  if (index === 1) return "critic";
  if (index === 2) return "researcher";
  return "solver";
}

function modelFor(index: number, settings: BraintrustSettings): string {
  if (index === settings.teamSize - 1) return settings.synthModel;
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
  const t = text.trim().toLowerCase();
  if (!t) return false;
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
  ].some((needle) => t.includes(needle));
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
): Promise<RuntimeBridgeResult> {
  const tasks = Array.from({ length: input.settings.teamSize }, async (_, i) => {
    const id = `agent-${i + 1}`;
    const model = modelFor(i, input.settings);
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
    };
  }

  const synthesis = synthesizeDeterministic({
    prompt: input.prompt,
    candidates,
  });

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
  };
}
