# Braintrust Plugin (MVP Control Plane)

Feature-flagged plugin path for multi-agent orchestration in OpenClaw.

## Current behavior (implemented)
- `/braintrust on|off|status|unavailable`
- Configurable team size / strategy / model roles
- Quorum contract configuration (`minParticipatingAgents`, `minAnsweringAgents`)
- Prompt injection with explicit quorum policy + unavailable contract
- Logging hooks for `llm_input` and `llm_output`
- Deterministic quorum policy helpers + unit tests

## Important limitation (still pending)
This plugin **does not yet perform true parallel fan-out/fan-in orchestration** by itself.
It sets control policy and prompt/lifecycle behavior; runtime fan-out wiring remains a core integration task.

## Quorum contract
- Minimum participating agents: default `2`
- Minimum answering agents: default `2`
- If quorum fails, return explicit unavailable notice instead of pretending panel output.

See `src/policy.ts` and `src/policy.test.ts`.

## Test
```bash
pnpm vitest run extensions/braintrust/src/policy.test.ts extensions/braintrust/src/settings.test.ts
```
