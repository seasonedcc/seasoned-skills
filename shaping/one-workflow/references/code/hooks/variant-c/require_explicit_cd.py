"""PreToolUse hook: every Bash command must start with an explicit cd.

The workspace rule (CLAUDE.md, Tooling > Working directory) is unconditional:
the session's cwd drifts between shell calls, so every command starts with
`cd <absolute path>`. This hook enforces it mechanically — the rule was
violated seven times in a single session on willpower alone.

The rejection message contains the literal corrected command, ready to copy.
On retry, an agent's strongest reflex is to re-emit the most salient command
string in its context; when that string is the blocked original, the agent
loops. Making the corrected command the freshest string turns that reflex
into compliance. The `cd` goes on its own first line — the one-liner
`cd X && ...` form has been observed losing its prefix to exactly this loop.

Commands that clear that gate then get three ADVISORY warnings — a stale
checkout, a pipe-masked exit code, and `gh` run from the workspace root. All
are workspace rules that were violated after being codified in prose, and all
are cheap to detect at the moment of the command. They never block: the
warning rides back on `hookSpecificOutput.additionalContext` with exit code
0, so the command runs either way.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time

ALLOWED_START = re.compile(r"^[\s(]*cd\s+[\"']?[/~$]")
CD_TARGET = re.compile(r"""^[\s(]*cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))""")
PIPE_INTO_FILTER = re.compile(r"\|\s*(?:tail|head|grep|sed|awk)\b")
EXIT_STATUS = re.compile(r"\$\?")
GH_INVOCATION = re.compile(r"(?:^|[\s;&|(])gh\s")
STALE_FETCH_SECONDS = 6 * 60 * 60


def workspace_root() -> str:
    project_directory = os.environ.get("CLAUDE_PROJECT_DIR")
    if project_directory:
        return os.path.realpath(project_directory)
    return os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))


def target_directory(command: str) -> str | None:
    match = CD_TARGET.match(command)
    if not match:
        return None
    path = next(group for group in match.groups() if group is not None)
    if "$" in path:
        return None
    return os.path.expanduser(path)


def stale_checkout_warning(command: str) -> str | None:
    directory = target_directory(command)
    if not directory or not os.path.isdir(directory):
        return None
    try:
        completed = subprocess.run(
            ["git", "-C", directory, "rev-parse", "--git-common-dir"],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if completed.returncode != 0:
        return None
    common_directory = os.path.join(directory, completed.stdout.strip())
    repository = os.path.basename(os.path.dirname(os.path.abspath(common_directory)))
    fetch_head = os.path.join(common_directory, "FETCH_HEAD")
    try:
        age_seconds = time.time() - os.stat(fetch_head).st_mtime
    except OSError:
        freshness = "has no recorded fetch"
    else:
        if age_seconds < STALE_FETCH_SECONDS:
            return None
        freshness = f"was last fetched {int(age_seconds // 3600)}h ago"
    return (
        f"Workspace rule reminder: {repository} {freshness} —"
        " `git fetch origin` and fast-forward the default branch before relying"
        ' on reads (CLAUDE.md, "Checkouts and worktrees").'
    )


def pipe_masked_exit_code_warning(command: str) -> str | None:
    pipe = PIPE_INTO_FILTER.search(command)
    if not pipe or not EXIT_STATUS.search(command, pipe.end()):
        return None
    return (
        "Workspace rule reminder: after a pipeline, `$?` reports the LAST"
        " stage's status, not the command's. Capture the whole log"
        ' (`cmd > file 2>&1; echo "exit=$?"`) and read the file (CLAUDE.md,'
        ' "Shell scripting").'
    )


def gh_at_workspace_root_warning(command: str) -> str | None:
    if not GH_INVOCATION.search(command):
        return None
    directory = target_directory(command)
    if not directory or os.path.realpath(directory) != workspace_root():
        return None
    return (
        "Workspace rule reminder: `gh` resolves the repo from cwd, and this"
        " command runs it from the workspace root — where it targets the"
        " Claude Code setup repo (the workspace root repo). If the PR, issue, or run"
        " lives in a nested product repo, cd into that repo's checkout instead"
        ' (CLAUDE.md, "Working directory").'
    )


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0
    if payload.get("tool_name") != "Bash":
        return 0
    command = (payload.get("tool_input") or {}).get("command", "")
    if ALLOWED_START.match(command):
        warnings = [
            warning
            for warning in (
                stale_checkout_warning(command),
                pipe_masked_exit_code_warning(command),
                gh_at_workspace_root_warning(command),
            )
            if warning
        ]
        if warnings:
            json.dump(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "additionalContext": "\n".join(warnings),
                    }
                },
                sys.stdout,
            )
        return 0
    current_directory = payload.get("cwd") or "<absolute path of the target directory>"
    sys.stderr.write(
        "Workspace rule (enforced): every shell command starts with an explicit"
        " `cd <absolute path>` on its own first line, because the session's cwd"
        " drifts between calls. Do NOT re-send the blocked command. Copy this"
        " corrected version exactly, replacing the directory only if it is not"
        f" the right target:\n\ncd {current_directory}\n{command}\n"
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())
