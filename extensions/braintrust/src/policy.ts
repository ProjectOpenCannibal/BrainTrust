export type CandidateStatus = "ok" | "refusal" | "timeout" | "error";

export type Candidate = {
  id: string;
  model: string;
  status: CandidateStatus;
  text?: string;
  latencyMs?: number;
};

export type QuorumConfig = {
  minParticipatingAgents: number;
  minAnsweringAgents: number;
};

export type QuorumEvaluation = {
  participating: number;
  answering: number;
  refused: number;
  failed: number;
  meetsQuorum: boolean;
  reason?: string;
};

export const DEFAULT_QUORUM: QuorumConfig = {
  minParticipatingAgents: 2,
  minAnsweringAgents: 2,
};

export function evaluateQuorum(
  candidates: Candidate[],
  cfg: QuorumConfig = DEFAULT_QUORUM,
): QuorumEvaluation {
  const participating = candidates.filter((c) => c.status !== "timeout" && c.status !== "error").length;
  const answering = candidates.filter((c) => c.status === "ok").length;
  const refused = candidates.filter((c) => c.status === "refusal").length;
  const failed = candidates.length - participating;

  if (participating < cfg.minParticipatingAgents) {
    return {
      participating,
      answering,
      refused,
      failed,
      meetsQuorum: false,
      reason: `only ${participating}/${candidates.length} agents participated`,
    };
  }

  if (answering < cfg.minAnsweringAgents) {
    return {
      participating,
      answering,
      refused,
      failed,
      meetsQuorum: false,
      reason: `only ${answering}/${candidates.length} agents produced usable answers`,
    };
  }

  return {
    participating,
    answering,
    refused,
    failed,
    meetsQuorum: true,
  };
}

export function buildUnavailableNotice(evalResult: QuorumEvaluation): string {
  return `Braintrust temporarily unavailable (${evalResult.reason ?? "insufficient quorum"}).`;
}
