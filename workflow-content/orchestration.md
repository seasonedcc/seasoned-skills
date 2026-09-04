## History rewrites and push forms in charters

The permission classifier blocks subagents from `git commit --amend` and force-pushes, and sometimes blocks a bare `git push`. Charters therefore prescribe follow-up commits instead of history rewrites, and always the explicit push form — `git push origin <branch>`. A lane once stalled on an amend the classifier refused; the follow-up-commit shape landed the same content without a fight.

## Mutation proofs run from a committed tree

A mutation proof breaks one file on purpose, so its restore must touch exactly that file. Commit the batch's work before the first mutation, then restore with `git checkout -- <the one mutated file>`. A broad multi-path restore sweeps away whatever else the batch has written: a guard builder twice lost uncommitted work to `git checkout -- src docs tests` mid-batch and had to re-run the whole proof series from a committed tree.
