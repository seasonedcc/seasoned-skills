# Testing

The full testing playbook is the project's own committed material — the package does not ship this project's stack, so the playbook, and the checker scripts that enforce its gates, live in the repository as project content, and these instructions point at them exactly as they would point at package-generated ones. The project-specifics section below names where the playbook lives and which documents outrank it where they overlap; read the playbook before any testing work — execution commands, TDD and mutation proofs, gate reconciliation, unit-testing doctrine, the E2E stack and its core principles, and the settled decisions all live there, not here.

A few rulings hold on every stack and bind here too:

- The full end-to-end suite is continuous integration's job, never a local step. Locally, run the specs related to the change — related by the change's blast radius, not literally the specs of the files touched — and read the full-suite verdict fresh from the CI run on the draft pull request.
- A new surface and the spec that reaches it land in the same change. The coverage register of unreached surfaces only ever shrinks, and a surface a spec genuinely cannot reach is excused instead, on a committed list that admits an entry only with a one-line written rationale — "no spec yet" is never a rationale.
- Specs never assert one-shot flash messages — their delivery rests on a global no-prefetch property any future change can silently break, failing every such assertion at once. Assert the destination and the re-navigated state instead.
- Never mask a flake with a wait, a retry, or a weakened assertion: a spec that fails intermittently is a likely product bug until investigated. A contention-shaped failure — connection exhaustion, timeouts under load — is re-run alone before anyone treats it as a defect; the machine's real capacity limits are project facts, not doctrine.
- A green suite proves nothing about a specific test until that test has been seen red for the right reason. When red-first isn't natural, substitute a mutation proof: back the file up, neuter exactly the behavior the test pins, confirm the specific test fails with the expected message — not just "a" failure — then restore, verify the restore landed, and confirm green.

Testing doctrine lessons are codified in the playbook through a pull request on the project, never accreted here — this skill stays a pointer. Only workspace facts the playbook cannot carry belong in the project specifics below.
