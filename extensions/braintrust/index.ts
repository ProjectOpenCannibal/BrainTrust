import type {
  OpenClawPluginApi,
  PluginHookBeforePromptBuildEvent,
  PluginHookLlmInputEvent,
  PluginHookLlmOutputEvent,
} from "openclaw/plugin-sdk";

import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { buildUnavailableNotice, DEFAULT_QUORUM, type QuorumEvaluation } from "./src/policy.js";
import { readSettings } from "./src/settings.js";

function formatQuorumStatus(e?: QuorumEvaluation): string {
  if (!e) return `quorum: ${DEFAULT_QUORUM.minParticipatingAgents}/${DEFAULT_QUORUM.minAnsweringAgents}`;
  return `participating=${e.participating} answering=${e.answering} refused=${e.refused} failed=${e.failed}`;
}

export default {
  id: "braintrust",
  name: "Braintrust",
  description: "Multi-agent orchestration control plane",
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi) {
    const settings = readSettings(api.pluginConfig);
    let enabled = settings.enabled;
    let lastQuorumEvaluation: QuorumEvaluation | undefined;

    const statusLine = () =>
      [
        `Braintrust: ${enabled ? "ON" : "OFF"}`,
        `strategy=${settings.strategy}`,
        `teamSize=${settings.teamSize}`,
        `solver=${settings.model}`,
        `critic=${settings.criticModel}`,
        `synth=${settings.synthModel}`,
        `timeout=${settings.timeoutSeconds}s`,
        `minParticipating=${settings.minParticipatingAgents}`,
        `minAnswering=${settings.minAnsweringAgents}`,
        formatQuorumStatus(lastQuorumEvaluation),
      ].join(" · ");

    api.registerCommand({
      name: "braintrust",
      description: "Control Braintrust mode: /braintrust on|off|status|unavailable",
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
        if (arg === "unavailable") {
          const fallback = buildUnavailableNotice(
            lastQuorumEvaluation ?? {
              participating: 0,
              answering: 0,
              refused: 0,
              failed: settings.teamSize,
              meetsQuorum: false,
              reason: `only 0/${settings.teamSize} agents participated`,
            },
          );
          return { text: fallback };
        }
        return { text: statusLine() };
      },
    });

    api.on("before_prompt_build", async ({ event }) => {
      if (!enabled) return;
      const e = event as PluginHookBeforePromptBuildEvent;

      // Placeholder quorum state for now; true runtime fan-out wiring is next.
      lastQuorumEvaluation = {
        participating: settings.teamSize,
        answering: settings.teamSize,
        refused: 0,
        failed: 0,
        meetsQuorum: true,
      };

      const prepended = [
        "BRAINTRUST MODE ACTIVE.",
        `Use a ${settings.teamSize}-agent internal panel with strategy=${settings.strategy}.`,
        `Simulate roles: solver(model=${settings.model}), critic(model=${settings.criticModel}), synthesizer(model=${settings.synthModel}).`,
        `Quorum contract: require >=${settings.minParticipatingAgents} participating and >=${settings.minAnsweringAgents} answering agents.`,
        "If quorum cannot be satisfied, return exactly: Braintrust temporarily unavailable (...).",
        "Return only one final answer to the user.",
      ].join("\n");

      api.logger.info(
        `[braintrust] before_prompt_build msgCount=${Array.isArray(e.messages) ? e.messages.length : 0}`,
      );
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
