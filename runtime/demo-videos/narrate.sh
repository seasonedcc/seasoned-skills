#!/usr/bin/env bash
# Narration in the rig's narrator voice. See narrate.py for the arguments.
set -euo pipefail
cd "$(dirname "$0")"
exec env HF_HOME="$PWD/models" .venv/bin/python narrate.py "$@"
