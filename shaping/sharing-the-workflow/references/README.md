# References

Work the build inherits, authored and approved during shaping.

- `docs-copywriting/` — the complete voice skill this project installs: the
  compact skill file and its deep voice guide. The build copies this folder
  verbatim into `.claude/skills/docs-copywriting/` and verifies the copy with
  `diff -r`; it does not rewrite it. The folder's first commit here was a
  verbatim copy of a battle-tested guide, edited in later commits into the
  skill this repository needs — the history shows exactly what changed.
