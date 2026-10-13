## Code that touches processes, the filesystem or the shell runs on Linux before it is pushed

Roughly half of this team works on Linux, and CI runs on Linux, so a change that touches processes, the filesystem or the shell runs through `pnpm test:unit:linux` before it is pushed — it runs the unit suite in a Linux container, and a gap that only shows on Linux is never minor.

A green container is still not CI's verdict. A bare container runs none of the processes a real machine runs: the GitHub runner owns a process whose working directory even its owner cannot read, a bare container has none, and a sweep regression once passed the container and failed CI. Read the CI run on the pushed commit before trusting the change.
