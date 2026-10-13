#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

container_script=$(cat <<'CONTAINER'
set -euo pipefail
corepack enable
cp -r /source /home/node/work
# A linked worktree's .git points outside the mount, so the copy gets a repository of its own.
rm -rf /home/node/work/node_modules /home/node/work/.git
chown -R node:node /home/node/work
# The suite runs as node because root reads what a normal user cannot.
su node --command '
  set -euo pipefail
  cd /home/node/work
  git init --quiet
  git add --all
  git -c user.name=snapshot -c user.email=snapshot@localhost commit --quiet --message snapshot
  CI=true pnpm install --frozen-lockfile
  pnpm test:unit
'
CONTAINER
)

exec docker run --rm --volume "$PWD:/source:ro" node:22-bookworm bash -c "$container_script"
