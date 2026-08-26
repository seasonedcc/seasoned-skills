# seasoned-skills

Seasoned's skills to orchestrate the full product cycle with AI agents.

This package carries one complete way of working, run inside Claude
Code, Anthropic's coding agent: how an idea becomes a shaped project
(one written down and thought through before any build starts), how AI
agents build it end to end, with everything that needs taste running on
Fable, the strongest Claude model, and how the lessons learned along the
way are kept. A project adopts it by installing the package and
answering an interview once. From then on, everything the workflow needs
inside the project is generated from the installed version: the standing
instructions, the skills, the small supporting tools. The project commits
only its configuration and its own content, and staying current means
upgrading a version.

We built it because we were maintaining the same way of working in three
repositories, by hand. Every lesson was learned once but taught to only one
project, and the copies quietly drifted apart. Now a lesson written once
reaches every project on its next upgrade, a new project costs an install
instead of an afternoon of copying and pruning, and differences between
projects are configuration, never forks.

## Where this is going

We are building toward one thing: AI agents doing all the work of product
development. Pulling requirements out of meetings, issues, user feedback,
and the running product's behavior. Shaping, building, releasing, and
watching what ships. Today we still bring the ideas and rule on the
quality. Real autonomy means agents decide what to shape and shape it
themselves, then decide what ships, to which audience, and how fast the
rollout goes. Feedback from the outside world — the running product
observed, users talking to the AI itself — starts the next shaping session
on its own. Two doors stay open to us for good: anyone can start a shaping
session, and every shaping document waits for human review before the
build starts. But coming up with the work stops being something only we do.

## Find your way in

- **Understanding the way of working.**
  [The way of working](docs/the-way-of-working.md) tells the whole story,
  from the moment an idea arrives to the moment it ships.
  [Running a session](docs/running-a-session.md) is the manual for the
  person at the keyboard while agents build.
- **Adopting it.**
  [Adopting the workflow](docs/adopting-the-workflow.md) covers what your
  codebase needs in place first, the install itself, and how to stay
  current afterwards.
- **Looking something up.** The reference answers in under a minute:
  [the commands](docs/reference/commands.md),
  [the configuration file](docs/reference/configuration.md),
  [what a project receives](docs/reference/what-a-project-receives.md),
  and [the files and settings the package manages](docs/reference/managed-footprint.md).

## This repository

This repository is consumer number zero: the workflow it ships is
installed here from the package itself, so the repo works under the very
rules it distributes. It holds itself to the same adopter's bar the docs
state, in the form that applies to a command-line package: its own CI runs
both test tiers as required checks.

## License

[MIT](LICENSE).
