#!/usr/bin/env bash
# PreToolUse hook for the Agent tool. Blocks the harness's worktree-isolation
# option: a harness-created worktree is unprovisioned, so an agent spawned
# into one believes it has a lane and runs against resources it does not own.
# The guard redirects to a real provisioned lane, or to a plain worktree for
# deliberately unprovisioned work.
set -uo pipefail

isolation=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input", {}).get("isolation", ""))' 2>/dev/null) || exit 0

if [ "$isolation" = "worktree" ]; then
  echo 'isolation: "worktree" is blocked: a harness-created worktree is unprovisioned, so the agent would run against resources it does not own. Charter the agent to create its own isolation instead — `seasoned-skills provision <lane>` when the task needs env files, databases, or gates, or a plain `git worktree add` (removed after pushing) for deliberately unprovisioned work like read-only review or docs-only edits.' >&2
  exit 2
fi

exit 0
