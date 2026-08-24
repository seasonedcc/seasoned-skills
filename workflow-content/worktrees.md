## A fresh worktree starts without dependencies

A newly created worktree of this repository has no `node_modules`, so every gate fails there with missing binaries (`vitest: not found`) until `pnpm install` runs in the worktree. Run it right after creating any worktree — plain or provisioned — before the first gate. This has bitten twice: a docs-only worktree and a provisioned lane both hit it.
