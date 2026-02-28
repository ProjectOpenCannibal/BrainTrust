#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_DIR="$REPO_ROOT/extensions/braintrust"

if [[ ! -f "$PLUGIN_DIR/package.json" ]]; then
  echo "[error] braintrust plugin package.json not found at: $PLUGIN_DIR" >&2
  exit 1
fi

echo "== BrainTrust live validation =="
echo "repo: $REPO_ROOT"
echo "plugin: $PLUGIN_DIR"

echo "[1/2] Running unit/runtime tests for command + synthesis contract..."
(
  cd "$PLUGIN_DIR"
  if command -v pnpm >/dev/null 2>&1; then
    pnpm vitest run src/live-validation.test.ts src/runtime-bridge.integration.test.ts
  else
    npm exec --yes vitest run src/live-validation.test.ts src/runtime-bridge.integration.test.ts
  fi
)

echo "[2/2] Validation passed"
echo "- /braintrust on + status command path: OK"
echo "- sample prompt synthesis path: OK"
echo "- quorum-unavailable explicit notice path: OK"
