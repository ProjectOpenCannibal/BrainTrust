import type {
  OpenClawPluginApi,
  PluginHookBeforePromptBuildEvent,
  PluginHookLlmInputEvent,
  PluginHookLlmOutputEvent,
} from "openclaw/plugin-sdk";

import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { buildUnavailableNotice, DEFAULT_QUORUM, evaluateQuorum, type QuorumEvaluation } from "./src/policy.js";
import { runRuntimeBridge, type CandidateRunnerInput, type CandidateRunnerOutput } from "./src/runtime-bridge.js";
import { readSettings } from "./src/settings.js";

type RuntimeExecuteInput = {
  model: string;
  prompt: string;
  role: CandidateRunnerInput["role"];
  timeoutSeconds: number;
};

type RuntimeExecuteFn = (input: RuntimeExecuteInput) => Promise<CandidateRunnerOutput>;

function formatQuorumStatus(e?: QuorumEvaluation): string {
  if (!e) return `quorum: ${DEFAULT_QUORUM.minParticipatingAgents}/${DEFAULT_QUORUM.minAnsweringAgents}`;
  return `participating=${e.participating} answering=${e.answering} refused=${e.refused} failed=${e.failed}`;
}

function extractPromptFromMessages(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i] as { role?: string; content?: unknown };
    if (msg?.role !== "user") continue;
    const c = msg.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) {
      const text = c
        .map((part) => (typeof part === "string" ? part : (part as { text?: string })?.text ?? ""))
        .join("\n")
        .trim();
      if (text) return text;
    }
  }
  return "";
}

function readTextOutput(out: unknown): string {
  if (typeof out === "string") return out;
  if (!out || typeof out !== "object") return "";

  const candidate = out as {
    text?: unknown;
    outputText?: unknown;
    assistantText?: unknown;
    assistantTexts?: unknown;
    content?: unknown;
    choices?: unknown;
  };

  if (typeof candidate.text === "string") return candidate.text;
  if (typeof candidate.outputText === "string") return candidate.outputText;
  if (typeof candidate.assistantText === "string") return candidate.assistantText;
  if (Array.isArray(candidate.assistantTexts) && typeof candidate.assistantTexts[0] === "string") {
    return candidate.assistantTexts[0];
  }
  if (typeof candidate.content === "string") return candidate.content;
  if (Array.isArray(candidate.choices)) {
    const first = candidate.choices[0] as { text?: unknown; message?: { content?: unknown } } | undefined;
    if (typeof first?.text === "string") return first.text;
    if (typeof first?.message?.content === "string") return first.message.content;
  }
  return "";
}

function resolveRuntimeExecutor(api: OpenClawPluginApi, runtimeContext: unknown): RuntimeExecuteFn | undefined {
  const source = [
    runtimeContext as Record<string, unknown> | undefined,
    api as unknown as Record<string, unknown>,
  ];

  const names = ["runModel", "invokeModel", "runLlm", "invokeLlm", "complete"];

  for (const obj of source) {
    if (!obj) continue;
    for (const name of names) {
      const fn = obj[name];
      if (typeof fn !== "function") continue;
      return async (input) => {
        const out = await (fn as (payload: unknown) => Promise<unknown>)({
          model: input.model,
          role: input.role,
          timeoutSeconds: input.timeoutSeconds,
          messages: [
            {
              role: "system",
              content: `You are Braintrust ${input.role}. Respond with one concise candidate answer for the user prompt.`,
            },
            { role: "user", content: input.prompt },
          ],
        });
        const text = readTextOutput(out).trim();
        if (!text) {
          throw new Error("empty output");
        }
        return {
          text,
          refusal: /\b(cannot comply|i can't|i cannot|refuse|not able)\b/i.test(text),
        };
      };
    }
  }

  return undefined;
}

function buildFallbackPrepend(settings: ReturnType<typeof readSettings>): string {
  return [
    "BRAINTRUST MODE ACTIVE.",
    `Use a ${settings.teamSize}-agent internal panel with strategy=${settings.strategy}.`,
    `Simulate roles: solver(model=${settings.model}), critic(model=${settings.criticModel}), synthesizer(model=${settings.synthModel}).`,
    `Quorum contract: require >=${settings.minParticipatingAgents} participating and >=${settings.minAnsweringAgents} answering agents.`,
    "If quorum cannot be satisfied, return exactly: Braintrust temporarily unavailable (...).",
    "Return only one final answer to the user.",
  ].join("\n");
}

export default {
  id: "braintrust-plugin",
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
        `researcher=${settings.researcherModel}`,
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

    api.on("before_prompt_build", async ({ event, context }) => {
      if (!enabled) return;
      const e = event as PluginHookBeforePromptBuildEvent;
      const prompt = extractPromptFromMessages(e.messages);
      const execute = resolveRuntimeExecutor(api, context);

      if (!execute || !prompt) {
        api.logger.info("[braintrust] runtime bridge unavailable in hook context, using policy-only prompt injection");
        lastQuorumEvaluation = {
          participating: settings.teamSize,
          answering: settings.teamSize,
          refused: 0,
          failed: 0,
          meetsQuorum: true,
        };
        return { prependContext: buildFallbackPrepend(settings) };
      }

      const bridge = await runRuntimeBridge({ prompt, settings }, ({ role, model, prompt: p, timeoutSeconds }) =>
        execute({ role, model, prompt: p, timeoutSeconds }),
      );

      lastQuorumEvaluation = evaluateQuorum(bridge.candidates, {
        minParticipatingAgents: settings.minParticipatingAgents,
        minAnsweringAgents: settings.minAnsweringAgents,
      });

      api.logger.info(
        `[braintrust] runtime bridge complete unavailable=${bridge.unavailable} candidates=${bridge.candidates.length}`,
      );

      if (bridge.unavailable) {
        return {
          prependContext: [
            "BRAINTRUST MODE ACTIVE.",
            "Quorum could not be satisfied by runtime-bridge execution.",
            `Return exactly this notice: ${bridge.final}`,
          ].join("\n"),
        };
      }

      return {
        prependContext: [
          "BRAINTRUST MODE ACTIVE.",
          "Use this runtime-bridge synthesis as your final answer.",
          bridge.final,
        ].join("\n\n"),
      };
    });

    api.on("llm_input", async (payload) => {
      if (!enabled) return;
      const event = ((payload as any)?.event ?? payload) as PluginHookLlmInputEvent;
      const context = ((payload as any)?.context ?? {}) as any;
      const e = event;
      api.logger.info(
        `[braintrust] llm_input run=${(e as any)?.runId ?? "unknown"} session=${context?.sessionKey ?? "unknown"} model=${(e as any)?.model ?? "unknown"}`,
      );
    });

    api.on("llm_output", async (payload) => {
      if (!enabled) return;
      const event = ((payload as any)?.event ?? payload) as PluginHookLlmOutputEvent;
      const e = event;
      api.logger.info(
        `[braintrust] llm_output run=${(e as any)?.runId ?? "unknown"} model=${(e as any)?.model ?? "unknown"} responses=${Array.isArray((e as any)?.assistantTexts) ? (e as any).assistantTexts.length : 0}`,
      );
    });
  },
};
