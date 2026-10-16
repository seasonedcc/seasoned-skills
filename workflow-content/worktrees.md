## A fresh worktree starts without dependencies

A newly created worktree of this repository has no `node_modules`, so every gate fails there with missing binaries (`vitest: not found`) until `pnpm install` runs in the worktree. Run it right after creating any worktree — plain or provisioned — before the first gate. This has bitten twice: a docs-only worktree and a provisioned lane both hit it.

## The CLI runs through `pnpm exec`

The `seasoned-skills` binary is a devDependency of this repository, so it lives in `node_modules/.bin` — a directory the agent shell's PATH does not carry, which is why `command -v seasoned-skills` finds nothing even where the binary is installed. Run every CLI command as `pnpm exec seasoned-skills <command>`, from a directory whose dependencies are installed. A bare invocation dies with `command not found`, and a backgrounded one hides that behind its trailing exit-code echo: the task reports success and only the log shows the failure.
