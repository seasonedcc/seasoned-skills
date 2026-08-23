#!/usr/bin/env bash
# The rig's own tests. No models, no audio — seconds, not minutes.
set -euo pipefail
cd "$(dirname "$0")"
exec .venv/bin/python -m unittest discover -p 'test_*.py' -v
