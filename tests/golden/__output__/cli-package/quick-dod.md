1. `pnpm run check` and `pnpm run tsc` are green. Run only the unit test files the change affects — the full suites run on the PR's CI.
2. A task is not done if it has leftover comments — remove them before finishing.
3. One `pr-review` pass over the lane's draft PR, with the fixes applied. A single pass, not a loop.