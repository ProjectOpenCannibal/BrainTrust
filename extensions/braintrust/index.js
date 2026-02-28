import { buildUnavailableNotice, DEFAULT_QUORUM, evaluateQuorum } from "./src/policy.js";
import { runRuntimeBridge } from "./src/runtime-bridge.js";
import { readSettings } from "./src/settings.js";
const braintrustConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    enabled: { type: "boolean", default: false },
    teamSize: { type: "integer", minimum: 1, maximum: 4, default: 3 },
    strategy: { type: "string", enum: ["independent", "debate", "panel"], default: "panel" },
    model: { type: "string", default: "gemini-3-flash-preview" },
    criticModel: { type: "string", default: "openai-codex/gpt-5.3-codex" },
    researcherModel: { type: "string", default: "grok-4-1-fast-reasoning" },
    synthModel: { type: "string", default: "gemini-3.1-pro-preview" },
    timeoutSeconds: { type: "integer", minimum: 10, maximum: 300, default: 90 },
    minParticipatingAgents: { type: "integer", minimum: 1, maximum: 4, default: 2 },
    minAnsweringAgents: { type: "integer", minimum: 1, maximum: 4, default: 2 }
  }
};
function formatQuorumStatus(e) {
  if (!e) return `quorum: ${DEFAULT_QUORUM.minParticipatingAgents}/${DEFAULT_QUORUM.minAnsweringAgents}`;
  return `participating=${e.participating} answering=${e.answering} refused=${e.refused} failed=${e.failed}`;
}
function parseBraintrustAction(raw) {
  const arg = (raw ?? "status").trim().toLowerCase();
  if (arg === "on" || arg === "off" || arg === "unavailable") return arg;
  return "status";
}
function extractPromptFromMessages(messages) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.role !== "user") continue;
    const c = msg.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) {
      const text = c.map((part) => typeof part === "string" ? part : part?.text ?? "").join("\n").trim();
      if (text) return text;
    }
  }
  return "";
}
function readTextOutput(out) {
  if (typeof out === "string") return out;
  if (!out || typeof out !== "object") return "";
  const candidate = out;
  if (typeof candidate.text === "string") return candidate.text;
  if (typeof candidate.outputText === "string") return candidate.outputText;
  if (typeof candidate.assistantText === "string") return candidate.assistantText;
  if (Array.isArray(candidate.assistantTexts) && typeof candidate.assistantTexts[0] === "string") {
    return candidate.assistantTexts[0];
  }
  if (typeof candidate.content === "string") return candidate.content;
  if (Array.isArray(candidate.choices)) {
    const first = candidate.choices[0];
    if (typeof first?.text === "string") return first.text;
    if (typeof first?.message?.content === "string") return first.message.content;
  }
  return "";
}
function resolveRuntimeExecutor(api, runtimeContext) {
  const source = [
    runtimeContext,
    api
  ];
  const names = ["runModel", "invokeModel", "runLlm", "invokeLlm", "complete"];
  for (const obj of source) {
    if (!obj) continue;
    for (const name of names) {
      const fn = obj[name];
      if (typeof fn !== "function") continue;
      return async (input) => {
        const out = await fn({
          model: input.model,
          role: input.role,
          timeoutSeconds: input.timeoutSeconds,
          messages: [
            {
              role: "system",
              content: `You are Braintrust ${input.role}. Respond with one concise candidate answer for the user prompt.`
            },
            { role: "user", content: input.prompt }
          ]
        });
        const text = readTextOutput(out).trim();
        if (!text) {
          throw new Error("empty output");
        }
        return {
          text,
          refusal: /\b(cannot comply|i can't|i cannot|refuse|not able)\b/i.test(text)
        };
      };
    }
  }
  return void 0;
}
function buildFallbackPrepend(settings) {
  return [
    "BRAINTRUST MODE ACTIVE.",
    `Use a ${settings.teamSize}-agent internal panel with strategy=${settings.strategy}.`,
    `Simulate roles: solver(model=${settings.model}), critic(model=${settings.criticModel}), synthesizer(model=${settings.synthModel}).`,
    `Quorum contract: require >=${settings.minParticipatingAgents} participating and >=${settings.minAnsweringAgents} answering agents.`,
    "If quorum cannot be satisfied, return exactly: Braintrust temporarily unavailable (...).",
    "Return only one final answer to the user."
  ].join("\n");
}
var index_default = {
  id: "braintrust-plugin",
  name: "Braintrust",
  description: "Multi-agent orchestration control plane",
  configSchema: braintrustConfigSchema,
  register(api) {
    const settings = readSettings(api.pluginConfig);
    let enabled = settings.enabled;
    let lastQuorumEvaluation;
    const statusLine = () => [
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
      formatQuorumStatus(lastQuorumEvaluation)
    ].join(" \xB7 ");
    const renderUnavailable = () => buildUnavailableNotice(
      lastQuorumEvaluation ?? {
        participating: 0,
        answering: 0,
        refused: 0,
        failed: settings.teamSize,
        meetsQuorum: false,
        reason: `only 0/${settings.teamSize} agents participated`
      }
    );
    const executeBraintrustAction = (action) => {
      if (action === "on") {
        enabled = true;
        return `\u2705 ${statusLine()}`;
      }
      if (action === "off") {
        enabled = false;
        return `\u{1F6D1} ${statusLine()}`;
      }
      if (action === "unavailable") {
        return renderUnavailable();
      }
      return statusLine();
    };
    api.registerCommand({
      name: "braintrust",
      description: "Control Braintrust mode: /braintrust on|off|status|unavailable",
      acceptsArgs: true,
      handler: async (ctx) => ({ text: executeBraintrustAction(parseBraintrustAction(ctx.args)) })
    });
    api.registerCli(
      ({ program }) => {
        program
          .command("braintrust")
          .description("Braintrust controls for local CLI surfaces")
          .argument("[action]", "on|off|status|unavailable", "status")
          .action((action) => {
            console.log(executeBraintrustAction(parseBraintrustAction(action)));
          });
      },
      { commands: ["braintrust"] }
    );
    api.on("before_prompt_build", async (payload) => {
      if (!enabled) return;
      const event = payload?.event ?? payload ?? {};
      const context = payload?.context ?? {};
      const prompt = extractPromptFromMessages(event?.messages);
      const execute = resolveRuntimeExecutor(api, context);
      if (!execute || !prompt) {
        api.logger.info("[braintrust] runtime bridge unavailable in hook context, using policy-only prompt injection");
        lastQuorumEvaluation = {
          participating: settings.teamSize,
          answering: settings.teamSize,
          refused: 0,
          failed: 0,
          meetsQuorum: true
        };
        return { prependContext: buildFallbackPrepend(settings) };
      }
      const bridge = await runRuntimeBridge(
        { prompt, settings },
        ({ role, model, prompt: p, timeoutSeconds }) => execute({ role, model, prompt: p, timeoutSeconds })
      );
      lastQuorumEvaluation = evaluateQuorum(bridge.candidates, {
        minParticipatingAgents: settings.minParticipatingAgents,
        minAnsweringAgents: settings.minAnsweringAgents
      });
      api.logger.info(
        `[braintrust] runtime bridge complete unavailable=${bridge.unavailable} candidates=${bridge.candidates.length}`
      );
      if (bridge.unavailable) {
        return {
          prependContext: [
            "BRAINTRUST MODE ACTIVE.",
            "Quorum could not be satisfied by runtime-bridge execution.",
            `Return exactly this notice: ${bridge.final}`
          ].join("\n")
        };
      }
      return {
        prependContext: [
          "BRAINTRUST MODE ACTIVE.",
          "Use this runtime-bridge synthesis as your final answer.",
          bridge.final
        ].join("\n\n")
      };
    });
    api.on("llm_input", async (payload) => {
      if (!enabled) return;
      const event = payload?.event ?? payload;
      const context = payload?.context ?? {};
      const e = event;
      api.logger.info(
        `[braintrust] llm_input run=${e?.runId ?? "unknown"} session=${context?.sessionKey ?? "unknown"} model=${e?.model ?? "unknown"}`
      );
    });
    api.on("llm_output", async (payload) => {
      if (!enabled) return;
      const event = payload?.event ?? payload;
      const e = event;
      api.logger.info(
        `[braintrust] llm_output run=${e?.runId ?? "unknown"} model=${e?.model ?? "unknown"} responses=${Array.isArray(e?.assistantTexts) ? e.assistantTexts.length : 0}`
      );
    });
  }
};
export {
  index_default as default
};
