#!/usr/bin/env bash
# SessionEnd hook. Kills the processes this session left running in worktree
# lanes, and those of sessions that already ended, each by its exact pid —
# never another live session's. Then removes the session folders whose
# transcript Claude Code no longer keeps. Must never block session end, so it
# always exits 0.
set -uo pipefail
cd "$CLAUDE_PROJECT_DIR" || exit 0
# Corepack's download prompt would read the JSON payload off stdin.
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
pnpm exec seasoned-skills sweep --lane-processes --kill --hook 2>/dev/null || true
pnpm exec seasoned-skills sweep --sessions --remove --hook 2>/dev/null || true
exit 0
