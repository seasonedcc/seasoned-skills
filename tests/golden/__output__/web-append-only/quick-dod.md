1. `pnpm run lint` and `pnpm run tsc` are green. Run only the unit test files the change affects — the full suites run on the PR's CI.
2. Open a PR. The CI E2E job stays the acceptance gate — fix any red on the branch.
3. A task is not done if it has leftover comments — remove them before finishing.
4. One `pr-review` pass over the lane's draft PR, with the fixes applied. A single pass, not a loop.
5. Verify the changed flow end to end with `agent-browser` and take a screenshot.
6. If user-visible behavior changed, update the existing spec that covers the flow — a brand-new spec still follows the `testing` skill in full.