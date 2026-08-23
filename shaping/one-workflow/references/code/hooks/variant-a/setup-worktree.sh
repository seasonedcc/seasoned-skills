#!/usr/bin/env bash
# WorktreeCreate hook. stdin: JSON payload from Claude Code.
# stdout must be exactly the resolved worktree path; diagnostics go to stderr.
set -euo pipefail
cd "$CLAUDE_PROJECT_DIR"
# Corepack's download prompt would read the JSON payload off stdin.
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
exec pnpm --filter @app/web exec tsx scripts/worktree/setup.ts --hook
