import type {
  OpenClawPluginApi,
  PluginHookBeforePromptBuildEvent,
  PluginHookLlmInputEvent,
  PluginHookLlmOutputEvent,
} from "openclaw/plugin-sdk";

import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";

type BraintrustStrategy = "independent" | "debate" | "panel";

type BraintrustSettings = {
  enabled: boolean;
  teamSize: number;
  strategy: BraintrustStrategy;
  model: string;
  criticModel: string;
  synthModel: string;
  timeoutSeconds: number;
};

const DEFAULTS: BraintrustSettings = {
  enabled: false,
  teamSize: 3,
  strategy: "panel",
  model: "sonnet",
  criticModel: "sonnet",
  synthModel: "opus",
  timeoutSeconds: 90,
};

function clampTeamSize(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULTS.teamSize;
  return Math.max(1, Math.min(4, Math.trunc(n)));
}

function readSettings(raw: Record<string, unknown> | undefined): BraintrustSettings {
  const p = raw ?? {};
  const strategy =
    p.strategy === "independent" || p.strategy === "debate" || p.strategy === "panel"
      ? p.strategy
      : DEFAULTS.strategy;
  return {
    enabled: Boolean(p.enabled ?? DEFAULTS.enabled),
    teamSize: clampTeamSize(p.teamSize),
    strategy,
    model: String(p.model ?? DEFAULTS.model),
    criticModel: String(p.criticModel ?? DEFAULTS.criticModel),
    synthModel: String(p.synthModel ?? DEFAULTS.synthModel),
    timeoutSeconds: Math.max(10, Math.min(300, Number(p.timeoutSeconds ?? DEFAULTS.timeoutSeconds))),
  };
}

export default {
  id: "braintrust",
  name: "Braintrust",
  description: "Multi-agent orchestration control plane (scaffold)",
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi) {
    const settings = readSettings(api.pluginConfig);
    let enabled = settings.enabled;

    const statusLine = () =>
      [
        `Braintrust: ${enabled ? "ON" : "OFF"}`,
        `strategy=${settings.strategy}`,
        `teamSize=${settings.teamSize}`,
        `solver=${settings.model}`,
        `critic=${settings.criticModel}`,
        `synth=${settings.synthModel}`,
        `timeout=${settings.timeoutSeconds}s`,
      ].join(" · ");

    api.registerCommand({
      name: "braintrust",
      description: "Control Braintrust mode: /braintrust on|off|status",
      acceptsArgs: true,
      handler: async (ctx) => {
        const arg = (ctx.args ?? "status").trim().toLowerCase();
        if (arg === "on") {
          enabled = true;
          return { text: `✅ ${statusLine()}` };
        }
        if (arg === "off") {
          enabled = false;
          return { text: `🛑 ${statusLine()}` };
        }
        return { text: statusLine() };
      },
    });

    api.on("before_prompt_build", async ({ event }) => {
      if (!enabled) return;
      const e = event as PluginHookBeforePromptBuildEvent;
      const prepended = [
        "BRAINTRUST MODE ACTIVE.",
        `Use a ${settings.teamSize}-agent internal panel with strategy=${settings.strategy}.`,
        `Simulate roles: solver(model=${settings.model}), critic(model=${settings.criticModel}), synthesizer(model=${settings.synthModel}).`,
        "Return only one final answer to the user.",
      ].join("\n");

      api.logger.info(`[braintrust] before_prompt_build session panel requested; msgCount=${Array.isArray(e.messages) ? e.messages.length : 0}`);
      return { prependContext: prepended };
    });

    api.on("llm_input", async ({ event, context }) => {
      if (!enabled) return;
      const e = event as PluginHookLlmInputEvent;
      api.logger.info(
        `[braintrust] llm_input run=${e.runId} session=${context.sessionKey ?? "unknown"} model=${e.model}`,
      );
    });

    api.on("llm_output", async ({ event }) => {
      if (!enabled) return;
      const e = event as PluginHookLlmOutputEvent;
      api.logger.info(
        `[braintrust] llm_output run=${e.runId} model=${e.model} responses=${e.assistantTexts.length}`,
      );
    });
  },
};
