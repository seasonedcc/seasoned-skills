#!/usr/bin/env bash
# Build the narration rig on a fresh Apple Silicon Mac.
#
# Everything this creates — the virtualenv, the model cache — stays out of git.
# Re-running is safe and cheap; it is how you pick up a version bump.
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required: https://docs.astral.sh/uv/getting-started/installation/" >&2
  exit 1
fi

if [[ "$(uname -sm)" != "Darwin arm64" ]]; then
  echo "The rig narrates on Apple Silicon: mlx-audio runs on the Mac GPU." >&2
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required to retime narration: brew install ffmpeg" >&2
  exit 1
fi

echo "==> Virtualenv"
uv venv --python 3.12 .venv

echo "==> Dependencies"
uv pip install --python .venv/bin/python --requirement requirements.txt

echo "==> Models (~3 GB, cached in ./models)"
HF_HOME="$PWD/models" .venv/bin/python - <<'PY'
from huggingface_hub import snapshot_download

for repo in (
    'mlx-community/chatterbox-multilingual-v3',
    'mlx-community/S3TokenizerV2',
    'mlx-community/whisper-large-v3-turbo-asr-fp16',
):
    print(f'  {repo}')
    snapshot_download(repo)
PY

echo "==> Checking the narrator voice against upstream"
EXPECTED=f1f7a7ded6a42051aab7de9a914b4e03498e226a642eda5135e2f4a7f7f1195b
ACTUAL=$(shasum -a 256 voices/emily.wav | cut -d' ' -f1)
if [[ "$ACTUAL" != "$EXPECTED" ]]; then
  echo "voices/emily.wav does not match the pinned checksum — see voices/VOICE.md" >&2
  exit 1
fi

echo
echo "Ready. Narrate a line:"
echo "  ./narrate.sh --text 'The recipe list opens on drafts.' --out /tmp/line.wav"
