## Checkouts and worktrees

Every repo's local checkout stays on its default branch at all times — branch work happens only in worktrees. Before starting any type of work involving a repo — building, but equally read-only work like audits, reviews, and architecture questions — `git fetch origin` and fast-forward the default branch first. A stale checkout silently invalidates whatever reads it: a coverage audit once ran against a main that was six commits behind and would have rediscovered a gap the missing commits had already closed. If a checkout is dirty or has diverged from origin, stop and surface it instead of forcing it current.

Independent tasks run in isolated git worktrees, each provisioned with its own resources. Use `seasoned-skills provision <lane>` (`--repo <path>`, repeatable, for the declared repositories a lane spans beyond the first) / `seasoned-skills teardown <lane>`, and load the `worktrees` skill for the lifecycle, naming conventions, and guardrails.

ALWAYS work in an isolated worktree unless told otherwise. The one exception is a documentation-only change (defined in the Definition of Done): it uses no provisioned resources, so it runs in a plain `git worktree add` with no provisioning — never on the main checkout's branch.

When the default branch advances under a long-lived feature branch, load the `main-sync` skill before syncing it in — the sync is a reviewed lane with its own obligations, not a mechanical merge.
