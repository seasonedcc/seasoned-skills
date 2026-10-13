## Code that touches processes, the filesystem or the shell runs on Linux before it is pushed

Roughly half of this team works on Linux, and CI runs on Linux, so a change that touches processes, the filesystem or the shell runs through the unit suite in a Linux container before it is pushed — a gap that only shows on Linux is never minor. From the worktree:

```bash
docker run --rm -v "$PWD":/source:ro node:22-bookworm bash -c 'corepack enable && cp -r /source /home/node/work && rm -rf /home/node/work/node_modules /home/node/work/.git && chown -R node:node /home/node/work && su node -c "cd /home/node/work && git init -q && git add -A && git -c user.name=ci -c user.email=ci@localhost commit -qm snapshot && CI=true pnpm install --frozen-lockfile && pnpm test:unit"'
```

The suite runs as the `node` user because root reads what a normal user cannot, and the copy gets a fresh git repository because a worktree's `.git` points into the main checkout, which the container cannot see.

A green container is still not CI's verdict. A bare container runs none of the processes a real machine runs: the GitHub runner owns a process whose working directory even its owner cannot read, a bare container has none, and a sweep regression once passed the container and failed CI. Read the CI run on the pushed commit before trusting the change.
