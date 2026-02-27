# Braintrust Plugin (Scaffold)

Feature-flagged plugin path for multi-agent orchestration in OpenClaw.

## Current behavior
- Provides `/braintrust` control command (`on|off|status`).
- Adds system context on `before_prompt_build` when enabled.
- Emits lightweight telemetry to logs on LLM input/output.

## Why scaffold first?
OpenClaw plugin hooks can shape prompts and lifecycle behavior immediately, but full per-turn fan-out/fan-in orchestration (spawn N workers, merge outputs, stream final) needs one additional integration point in core runtime. This plugin establishes the config/command/hook surface first.

## Next wiring step
- Add a runtime orchestration hook (or gateway method) that plugin can call for:
  - parallel candidate runs
  - synthesis pass
  - deterministic final output substitution


## Quorum contract (implemented)
- Minimum participating agents: 2
- Minimum answering agents: 2
- If quorum fails, plugin must return explicit unavailable notice instead of pretending a panel answer.

See `src/policy.ts` and `src/policy.test.ts`.
