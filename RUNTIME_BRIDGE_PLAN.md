# Runtime Bridge Plan (Feature Branch)

Goal: move Braintrust from control-plane prompt shaping to true multi-agent fan-out/fan-in orchestration.

## Scope (this branch)
1. Add adapter interface for running N candidate agent turns in parallel.
2. Add deterministic merge contract (winner + synthesized final + quorum checks).
3. Return explicit unavailable response when quorum unmet.
4. Add unit tests for adapter error/refusal/timeout handling.

## Non-goals (this branch)
- Full UI/dashboard.
- Provider-specific model routing complexity.
- Streaming partial candidate outputs.
