#!/usr/bin/env bash
# PreToolUse hook for Bash. Blocks git stash anywhere in this repository:
# the stash stack is shared between the main checkout and every worktree,
# so a concurrent lane's push/pop can silently swap or drop another lane's
# uncommitted work. Shelve work with a patch file or a WIP commit instead.
set -uo pipefail

command=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input", {}).get("command", ""))' 2>/dev/null) || exit 0

if printf '%s' "$command" | grep -qE '(^|[[:space:];&(])git[[:space:]]+([^|;&]*[[:space:]])?stash([[:space:]]|$)'; then
  echo 'git stash is forbidden here: the stash stack is shared across the main checkout and every worktree, so parallel lanes can clobber each other. Shelve with `git diff > work.patch` (restore with `git apply`) or a WIP commit.' >&2
  exit 2
fi

exit 0
