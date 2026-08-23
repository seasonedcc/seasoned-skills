#!/usr/bin/env bash
# Listen back to narration and check it against the screenplay. See transcribe.py.
set -euo pipefail
cd "$(dirname "$0")"
exec env HF_HOME="$PWD/models" .venv/bin/python transcribe.py "$@"
