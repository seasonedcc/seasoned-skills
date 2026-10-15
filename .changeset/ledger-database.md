---
'seasoned-skills': patch
---

Each session's ledger is now a database that refuses every edit and every
delete. It lives at `.sessions/<session id>/ledger.db` and takes new entries
of three kinds — a decision, a finding about the product with where it came
from, and progress — each stamped by the database's own clock. A change of
mind is a new entry that replaces an older one, and the older one stays
readable. Agents write with `pnpm exec seasoned-skills ledger decision`,
`ledger finding`, and `ledger progress`, the text arriving on standard input
through the quoted heredoc `<<'ENTRY'`. They read back what is in force with
`ledger`, find anything with `ledger search`, and open one entry with
`ledger show`; `ledger print` gives you the whole record as plain text.

Sync registers two new hooks. After every compaction (Claude Code
summarizing the conversation to free room), one puts the decisions in force
back in front of the agent, word for word. Before every Bash command, the
ledger write guard refuses a ledger write the shell could damage: text that
doesn't arrive through `<<'ENTRY'`, a second write in the same command, or
anything after the entry. The `git stash` guard no longer reads an entry's
text, so an entry can mention a forbidden command.

Subagents now write their findings straight into the session's ledger, each
under its own task name, and their reports point at those entries. Decisions
and progress stay with the orchestrator, the main agent you talk to. Lessons
about how we work stay in the conversation for the end-of-task review
instead of going in the ledger. A session that's running when you upgrade
keeps its markdown ledger as history and writes every new entry to the
database; nothing imports the old file.

The package now needs Node 22.16 or later (`engines.node` is `>=22.16.0`),
the first Node whose built-in SQLite has the full-text search the ledger's
search runs on. On an earlier Node 22 only `ledger` fails, with "The ledger
needs Node 22.16 or later.", and every other command keeps working. The nested `ledger`
commands have one side effect: `seasoned-skills <command> --version` is now
refused, while `seasoned-skills --version` still prints the version.
