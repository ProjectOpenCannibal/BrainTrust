# BrainTrust

Plugin-only repo for OpenClaw Braintrust experimentation.

Contents:
- `extensions/braintrust/` — Braintrust plugin scaffold (config, command, quorum policy tests)

## Live Feature Validation

Run the reproducible validation script:

```bash
./scripts/validate-braintrust.sh
```

What it verifies:
- `/braintrust on` and `/braintrust status` command flow
- sample prompt path returns exactly one synthesized final output
- if quorum cannot be met, plugin emits explicit `Braintrust temporarily unavailable (...)` notice
