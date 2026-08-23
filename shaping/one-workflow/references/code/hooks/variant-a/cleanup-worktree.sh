#!/usr/bin/env bash
# WorktreeRemove hook. Drops the worktree databases and frees its ports.
# Must never block removal, so it always exits 0.
set -uo pipefail
cd "$CLAUDE_PROJECT_DIR" || exit 0
# Corepack's download prompt would read the JSON payload off stdin.
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
pnpm --filter @app/web exec tsx scripts/worktree/teardown.ts --hook || true
exit 0
