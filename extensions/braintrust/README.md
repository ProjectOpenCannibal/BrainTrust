# Braintrust Plugin (MVP Control Plane)

Feature-flagged plugin path for multi-agent orchestration in OpenClaw.

## Current behavior (implemented)
- Chat/auto-reply surfaces: `/braintrust on|off|status|unavailable` (via `registerCommand`)
- Local CLI surface: `openclaw braintrust [on|off|status|unavailable]` (via `registerCli`)
- Configurable team size / strategy / model roles
- Quorum contract configuration (`minParticipatingAgents`, `minAnsweringAgents`)
- Prompt injection with explicit quorum policy + unavailable contract
- Logging hooks for `llm_input` and `llm_output`
- Deterministic quorum policy helpers + unit tests

## Important limitation (still pending)
This plugin **does not yet perform true parallel fan-out/fan-in orchestration** by itself.
It sets control policy and prompt/lifecycle behavior; runtime fan-out wiring remains a core integration task.

Also note: `openclaw agent --local --message '/braintrust ...'` does not route through plugin slash-command dispatch. Use `openclaw braintrust ...` for local CLI control.

## Quorum contract
- Minimum participating agents: default `2`
- Minimum answering agents: default `2`
- If quorum fails, return explicit unavailable notice instead of pretending panel output.

See `src/policy.ts` and `src/policy.test.ts`.

## Test
```bash
pnpm vitest run extensions/braintrust/src/policy.test.ts extensions/braintrust/src/settings.test.ts
```


## Default model routing
- solver (`model`): `gemini-3-flash-preview`
- critic (`criticModel`): `openai-codex/gpt-5.3-codex`
- synthesizer (`synthModel`): `gemini-3.1-pro-preview`
- researcher (`researcherModel`): `grok-4-1-fast-reasoning`


Note: plugin id is `braintrust-plugin`; command remains `/braintrust`.
