#!/usr/bin/env bash
# PreToolUse hook for Bash. Refuses a ledger write the shell could damage: an
# entry's text reaches the ledger only through the single-quoted heredoc
# <<'ENTRY', in a write that ends the command, so no line of an entry can
# ever run as a command. The command reader beside this script holds the
# rules; every other command passes untouched.
set -uo pipefail

refusal=$(python3 -B "$(dirname "$0")/command-reader.py" refusal 2>/dev/null) || exit 0

if [ -n "$refusal" ]; then
  printf '%s\n' "$refusal" >&2
  exit 2
fi

exit 0
