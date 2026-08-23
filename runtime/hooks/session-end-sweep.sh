#!/usr/bin/env bash
# SessionEnd hook. Kills processes left running in worktree lanes, by the
# exact pids their lanes recorded. Must never block session end, so it
# always exits 0.
set -uo pipefail
cd "$CLAUDE_PROJECT_DIR" || exit 0
# Corepack's download prompt would read the JSON payload off stdin.
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
pnpm exec seasoned-skills sweep --lane-processes --hook 2>/dev/null || true
exit 0
