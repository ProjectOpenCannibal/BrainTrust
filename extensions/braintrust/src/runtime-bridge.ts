import { buildUnavailableNotice, evaluateQuorum, type Candidate, type CandidateStatus } from "./policy.js";
import type { BraintrustSettings } from "./settings.js";
import { synthesizeDeterministic } from "./synth.js";

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
};

function roleFor(index: number): CandidateRunnerInput["role"] {
  if (index === 1) return "critic";
  if (index === 2) return "researcher";
  return "solver";
}

function modelFor(index: number, settings: BraintrustSettings): string {
  if (index === settings.teamSize - 1) return settings.synthModel;
  if (index === 1) return settings.criticModel;
  return settings.model;
}

function classifyError(error: unknown): CandidateStatus {
  const msg = String(error ?? "").toLowerCase();
  if (msg.includes("timeout")) return "timeout";
  return "error";
}

export async function runRuntimeBridge(
  input: RuntimeBridgeInput,
  runCandidate: CandidateRunner,
): Promise<RuntimeBridgeResult> {
  const tasks = Array.from({ length: input.settings.teamSize }, async (_, i) => {
    const id = `agent-${i + 1}`;
    const started = Date.now();
    try {
      const out = await runCandidate({
        role: roleFor(i),
        model: modelFor(i, input.settings),
        prompt: input.prompt,
        timeoutSeconds: input.settings.timeoutSeconds,
      });
      const latencyMs = out.latencyMs ?? Date.now() - started;
      return {
        id,
        model: modelFor(i, input.settings),
        status: out.refusal ? "refusal" : "ok",
        text: out.text,
        latencyMs,
      } as Candidate;
    } catch (err) {
      return {
        id,
        model: modelFor(i, input.settings),
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
  };
}
