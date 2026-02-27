import { DEFAULT_QUORUM } from "./policy.js";

export type BraintrustStrategy = "independent" | "debate" | "panel";

export type BraintrustSettings = {
  enabled: boolean;
  teamSize: number;
  strategy: BraintrustStrategy;
  model: string;
  criticModel: string;
  synthModel: string;
  timeoutSeconds: number;
  minParticipatingAgents: number;
  minAnsweringAgents: number;
};

export const DEFAULT_SETTINGS: BraintrustSettings = {
  enabled: false,
  teamSize: 3,
  strategy: "panel",
  model: "sonnet",
  criticModel: "sonnet",
  synthModel: "opus",
  timeoutSeconds: 90,
  minParticipatingAgents: DEFAULT_QUORUM.minParticipatingAgents,
  minAnsweringAgents: DEFAULT_QUORUM.minAnsweringAgents,
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

export function readSettings(raw: Record<string, unknown> | undefined): BraintrustSettings {
  const p = raw ?? {};
  const strategy: BraintrustStrategy =
    p.strategy === "independent" || p.strategy === "debate" || p.strategy === "panel"
      ? p.strategy
      : DEFAULT_SETTINGS.strategy;

  const teamSize = clampInt(p.teamSize, 1, 4, DEFAULT_SETTINGS.teamSize);
  const minParticipatingAgents = clampInt(
    p.minParticipatingAgents,
    1,
    teamSize,
    DEFAULT_SETTINGS.minParticipatingAgents,
  );
  const minAnsweringAgents = clampInt(
    p.minAnsweringAgents,
    1,
    minParticipatingAgents,
    DEFAULT_SETTINGS.minAnsweringAgents,
  );

  return {
    enabled: Boolean(p.enabled ?? DEFAULT_SETTINGS.enabled),
    teamSize,
    strategy,
    model: String(p.model ?? DEFAULT_SETTINGS.model),
    criticModel: String(p.criticModel ?? DEFAULT_SETTINGS.criticModel),
    synthModel: String(p.synthModel ?? DEFAULT_SETTINGS.synthModel),
    timeoutSeconds: clampInt(p.timeoutSeconds, 10, 300, DEFAULT_SETTINGS.timeoutSeconds),
    minParticipatingAgents,
    minAnsweringAgents,
  };
}
