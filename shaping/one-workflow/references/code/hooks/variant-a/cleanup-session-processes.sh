#!/usr/bin/env bash
# SessionEnd hook. Kills processes left running in worktree lanes.
# Must never block session end, so it always exits 0.
set -uo pipefail
cd "$CLAUDE_PROJECT_DIR" || exit 0
# Corepack's download prompt would read the JSON payload off stdin.
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
pnpm --filter @app/web exec tsx scripts/worktree/processes.ts --hook || true
exit 0
