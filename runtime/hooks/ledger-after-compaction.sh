#!/usr/bin/env bash
# SessionStart hook for compactions. Puts the session's ledger back in front
# of the agent before its next step: the decisions in force, word for word,
# printed as plain text Claude Code adds to the context. Prints nothing when
# the session has no ledger yet, and must never stop a compaction, so it
# always exits 0.
set -uo pipefail
[ -n "${CLAUDE_PROJECT_DIR:-}" ] || exit 0
cd "$CLAUDE_PROJECT_DIR" || exit 0
# Corepack's download prompt would read the JSON payload off stdin.
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
pnpm exec seasoned-skills ledger --hook 2>/dev/null || true
exit 0
