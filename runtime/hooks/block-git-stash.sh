#!/usr/bin/env bash
# PreToolUse hook for Bash. Blocks git stash anywhere in this repository:
# the stash stack is shared between the main checkout and every worktree,
# so a concurrent lane's push/pop can silently swap or drop another lane's
# uncommitted work. Shelve work with a patch file or a WIP commit instead.
# The command reader beside this script decides from the commands the shell
# would run, so a commit message or an entry that only mentions it passes.
set -uo pipefail

stash=$(python3 -B "$(dirname "$0")/command-reader.py" runs-git-stash 2>/dev/null) || exit 0

if [ -n "$stash" ]; then
  echo 'git stash is forbidden here: the stash stack is shared across the main checkout and every worktree, so parallel lanes can clobber each other. Shelve with `git diff > work.patch` (restore with `git apply`) or a WIP commit.' >&2
  exit 2
fi

exit 0
