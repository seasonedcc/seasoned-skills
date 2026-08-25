# Configuration

One file at the root of your repository, `seasoned-skills.config.ts`, decides
everything the workflow generates for your project. Differences between projects
are configuration, never forks, so this file is where every difference lives.

The install writes it once, stating every option explicitly. After that it is
yours: edit it, run `seasoned-skills sync`, and the generated workflow follows.

An option exists here only where a real, durable difference between projects
demands one. If two projects would always answer the same way, there is no
option to answer.

## defineConfig

The file default-exports the result of `defineConfig`, which is an identity
function whose only job is to give your editor the full type. Autocomplete,
inline documentation, and a red squiggle on a bad value all come from it.

| Export | What it is |
| --- | --- |
| `defineConfig` | Wraps your configuration object so TypeScript checks it as you type. |

The package also ships the `SeasonedSkillsConfig` type behind it, if you would
rather annotate than wrap.

## A real example

```ts
import { defineConfig } from 'seasoned-skills'

export default defineConfig({
  projectName: 'atlas',
  contentDir: 'workflow-content',
  mergeStrategy: 'squash',
  agentMergesDuringGoal: false,
  outOfScopeFindings: 'bank',
  release: { target: 'deployed-product' },
  gates: {
    lint: 'pnpm lint',
    typecheck: 'pnpm typecheck',
    unit: 'pnpm test:unit',
    relatedSpecs: 'pnpm test:e2e',
    full: ['pnpm test:unit', 'pnpm test:e2e'],
  },
  calibrationFile: 'workflow-content/calibrations.md',
  webSurface: {
    coverageRegister: 'workflow-content/coverage-register.md',
    excusedSurfaces: 'workflow-content/excused-surfaces.md',
  },
  demoSeed: { seedManifest: 'workflow-content/seed-manifest.md' },
  stack: { name: 'react-router-kysely', databaseMutability: 'append-only' },
  provisioning: {
    services: ['postgres', 'redis'],
    repositories: [
      {
        path: '.',
        provisionSteps: ['pnpm install'],
        migrateCommand: 'pnpm migrate',
        seedCommand: 'pnpm seed',
        databases: [
          { name: 'primary', seeded: true, derivedPatterns: ['%_shadow'] },
          { name: 'jobs', envKey: 'JOBS_DATABASE_URL' },
        ],
        envFiles: [
          { path: '.env', databases: ['primary', 'jobs'], ports: { PORT: 'web' }, cacheStore: true },
          { path: '.env.test', databases: ['primary'], ports: { PORT: 'test' } },
        ],
        portBases: { web: 3000, test: 4000 },
        portBlocks: { test: 4 },
        templateCaching: true,
        migrationSources: ['migrations'],
        seedSources: ['seed'],
        cacheStoreIndex: true,
      },
    ],
  },
  additionalCriteria: [
    {
      text: 'A task is not done if a new table lands without its migration test.',
      backedBy: 'pnpm test:unit',
      quickDisposition: 'kept',
    },
  ],
  quickDisqualifiers: ['a new route', 'a new permission'],
  machinePrerequisites: [
    { binary: 'wkhtmltopdf', reason: 'the invoice renderer runs it', hint: 'brew install wkhtmltopdf' },
  ],
})
```

Most projects need far less than this. The two required objects are `release`
and `gates`; every optional key below is a layer you turn on when the machinery
behind it exists.

## The top level

| Key | Required | What it does |
| --- | --- | --- |
| `projectName` | yes | How your project refers to itself in the generated instructions. |
| `contentDir` | yes | The directory holding your own content: one markdown file per generated skill, plus one for the standing instructions. Every file is optional. A markdown file at its top level matching no known name fails the sync, so writing to a misnamed file can never fail silently. |
| `mergeStrategy` | yes | `'merge-commit'` or `'squash'`. How a branch reaches the mainline, and with it how a pushed branch takes in changes from its base. |
| `agentMergesDuringGoal` | no | Whether agents may merge to the base branch while executing a goal. Off unless you opt in. |
| `outOfScopeFindings` | no | What an agent does with breakage it finds outside its task. `'bank'`, the default, records it with evidence for you to rule on; `'autofix'` has agents fix it in a dedicated pass. |
| `release` | yes | What a release is for this project. See below. |
| `gates` | yes | Your lint, typecheck, and test commands. See below. |
| `calibrationFile` | yes | The committed file where subagent calibrations accumulate, stated relative to the Definition of Done. The install seeds it; updates arrive as pull requests. |
| `webSurface` | no | Declare it when the project has web pages people use. Browser verification and the responsive rules apply only where it exists. |
| `demoSeed` | no | Declare it to require that every new or changed page ships its seed section and its manifest entry in the same change. |
| `machineSurface` | no | Declare it when the project exposes an MCP server or a public API. Turns on the capability-parity criterion. |
| `stack` | no | The stack layer. Declare your stack, or don't; turning it off removes every trace of it. |
| `provisioning` | no | The resource table isolated worktree lanes are built from. Without it, a lane is a worktree and nothing else. |
| `additionalCriteria` | no | Whole Definition of Done criteria your project adds beyond the core ones. |
| `quickDisqualifiers` | no | Things that disqualify a change from quick mode, added to the package's own list. |
| `machinePrerequisites` | no | Binaries your own content depends on, beyond the ones the enabled layers already declare. Doctor checks them like any other. |

## What a release is

Two durably different practices, and the shape changes with the answer.

| Key | Required | What it does |
| --- | --- | --- |
| `release.target` | yes | `'deployed-product'` for curated notes, badge stamping, a pre-release audit pull request, and a publish that triggers the deploy. `'published-package'` for the package flow below. |
| `release.packages` | with `'published-package'` | The packages this repository publishes. At least one. |
| `release.packages[].name` | yes | The package name. |
| `release.packages[].tagPrefix` | no | This package's tag prefix, when it is not the default `v`. |
| `release.packages[].publishCommand` | yes | The command you run locally to publish. Publishing never runs from continuous integration. |

## The gate commands

Every gate is optional, because not every project has all of them. What you
declare here is woven into the standing instructions and the skills, so agents
run your commands rather than guessing at them.

| Key | Required | What it does |
| --- | --- | --- |
| `gates.lint` | no | The fast lint check a builder runs in its own foreground. |
| `gates.typecheck` | no | The type check, same tier. |
| `gates.unit` | no | The unit suite, counted among the fast gates. |
| `gates.relatedSpecs` | no | Runs the specs related to a change, chosen by how far the change reaches. |
| `gates.full` | no | The long gates, as a list. These belong to the session's coordinator, run as background shells, never to a builder. |

## Web pages

| Key | Required | What it does |
| --- | --- | --- |
| `webSurface.coverageRegister` | yes | The committed register of pages no spec reaches yet. It only ever shrinks, and once empty it is held empty. |
| `webSurface.excusedSurfaces` | yes | The committed list of pages a spec genuinely cannot reach, each entry admitted only with a one-line written reason. |

## Demo seed

| Key | Required | What it does |
| --- | --- | --- |
| `demoSeed.seedManifest` | yes | The committed manifest every page claims its seed section in. |

## The machine side

| Key | Required | What it does |
| --- | --- | --- |
| `machineSurface.parityStandard` | yes | The committed standard saying what the machine side must keep up with, audited by the review skills. |
| `machineSurface.exceptionRegister` | yes | The committed register of every tool standing outside the wrap-a-business-function rule, with a one-line reason each. |

## The stack layer

| Key | Required | What it does |
| --- | --- | --- |
| `stack.name` | yes | `'react-router-kysely'`, the one packaged stack today. |
| `stack.databaseMutability` | yes | `'append-only'` (insert is the only write, deletion is an event) or `'mutable-when-not-derivable'` (in-place updates and explicit transactional deletes stay legitimate). The stack skills are generated around your answer. |

## Worktree lanes

A lane is one named workspace for one piece of work, with its own worktree,
ports, databases, and env files. This table is where each repository declares
what it owns inside a lane, so provisioning and teardown both know exactly what
to create and what to remove.

| Key | Required | What it does |
| --- | --- | --- |
| `provisioning.repositories` | no | The repositories a lane can cover. Defaults to your own checkout with no resources. |
| `provisioning.services` | no | Shared services probed before starting, in case this machine already runs them. |
| `provisioning.serviceStartCommand` | no | The command run from the main checkout to start the declared services that are not already listening. The names of the missing ones are appended to it. Defaults to `docker compose up -d`. |
| `provisioning.databasePrefix` | no | The prefix every lane-owned database name carries. Teardown refuses to drop anything outside it. Defaults to your project directory's name followed by `_wt_`. |
| `provisioning.seedDateTimezone` | no | The IANA time zone that anchors the seed date, so demo data re-anchors on your team's calendar day. Defaults to this machine's zone. |
| `provisioning.laneProcessCommands` | no | The command names the lane-process sweep looks for. Defaults to the common dev-server commands. Interactive shells are never listed. |

### What a repository owns

| Key | Required | What it does |
| --- | --- | --- |
| `provisioning.repositories[].path` | yes | Path to this repository's main checkout, relative to your own. `provision --repo` selects entries by this exact path. |
| `provisioning.repositories[].provisionSteps` | no | The commands that set this repository up inside a fresh lane, such as installing dependencies. |
| `provisioning.repositories[].seedCommand` | no | The command that seeds this repository's databases. It runs only for databases created in the same run. |
| `provisioning.repositories[].migrateCommand` | with databases | The command that migrates one database, run in the lane worktree with that database's env key pointing at it. |
| `provisioning.repositories[].databases` | no | The databases this repository owns in a lane. |
| `provisioning.repositories[].envFile` | no | The env file that carries the managed allocation block, relative to this repository's worktree. Defaults to `.env`. |
| `provisioning.repositories[].envFiles` | no | Use this when one file is not enough, such as a test environment reusing the same env key names for different allocations. Declaring it replaces the single-file behavior entirely, and `envFile` is then ignored. |
| `provisioning.repositories[].portBases` | no | The base port each named service derives its lane-specific port from. |
| `provisioning.repositories[].portBlocks` | no | How many consecutive ports a named port holds, one per end-to-end worker for instance. Ports not listed hold one, and allocation hands out whole blocks. |
| `provisioning.repositories[].templateCaching` | no | Keeps the expensive migrate-and-seed result as a fingerprinted template database. |
| `provisioning.repositories[].cacheStoreIndex` | no | Gives the lane its own cache-store index, flushed at allocation. |
| `provisioning.repositories[].cacheStoreEnvKeys` | no | The env keys that receive the lane's cache-store URL. Defaults to `['REDIS_URL']`. |
| `provisioning.repositories[].migrationSources` | with `templateCaching` | The paths whose contents fingerprint the migrations, relative to this repository's worktree. |
| `provisioning.repositories[].seedSources` | no | The paths whose contents fingerprint the seed. |

### Databases

| Key | Required | What it does |
| --- | --- | --- |
| `provisioning.repositories[].databases[].name` | yes | The database's name inside the lane. |
| `provisioning.repositories[].databases[].derivedPatterns` | no | Patterns for databases derived from this one, dropped with it at teardown. |
| `provisioning.repositories[].databases[].envKey` | no | The env key that receives this database's lane URL. Defaults to the name in capitals followed by `_DATABASE_URL`. |
| `provisioning.repositories[].databases[].seeded` | no | Whether this database receives the seed, and under template caching whether its template is built with the seed baked in. |

### Env files

| Key | Required | What it does |
| --- | --- | --- |
| `provisioning.repositories[].envFiles[].path` | yes | Path relative to this repository's worktree, such as `apps/web/.env.test`. |
| `provisioning.repositories[].envFiles[].databases` | no | The declared databases whose lane URLs this file carries, each written under its own env key. |
| `provisioning.repositories[].envFiles[].ports` | no | Managed port entries, mapping an env key to a declared port name. |
| `provisioning.repositories[].envFiles[].cacheStore` | no | Whether this file carries the lane's cache-store URL entries. Off by default. |
| `provisioning.repositories[].envFiles[].extra` | no | Extra managed entries. Values may use the tokens `{slug}` for the lane slug and `{slug-dashed}` for the same slug with underscores replaced by dashes. |

## Criteria your project adds

Each entry becomes a whole Definition of Done criterion, alongside the core
ones, and each declares how it behaves under quick mode in the same change that
adds it.

| Key | Required | What it does |
| --- | --- | --- |
| `additionalCriteria[].text` | yes | The criterion, phrased as "a task is not done if …". |
| `additionalCriteria[].backedBy` | yes | Your own gate command or committed skill that backs it. A criterion nothing backs is a wish. |
| `additionalCriteria[].quickDisposition` | yes | `'kept'`, `'reduced'`, or `'excluded'` under quick mode. |
| `additionalCriteria[].quickText` | with `'reduced'` | The reduced phrasing. |

## Machine prerequisites

| Key | Required | What it does |
| --- | --- | --- |
| `machinePrerequisites[].binary` | yes | The binary that has to be on the PATH. |
| `machinePrerequisites[].reason` | yes | Why this project needs it, phrased to follow "Needed because …". |
| `machinePrerequisites[].hint` | yes | How to install it: a command, a URL, or both. |

## Where to go next

[Commands](commands.md) covers the binary that reads this file.
[What a project receives](what-a-project-receives.md) covers what the keys
above actually generate.
