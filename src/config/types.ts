/**
 * The consuming project's configuration, loaded from `seasoned-skills.config.ts`
 * at the repository root. The package exports these types so a project's editor
 * flags a bad option before the tool ever runs.
 *
 * An option exists only where a genuine, durable difference between projects
 * demands one — the active projects' configurations are the tested combinations,
 * and an option no project uses gets deleted.
 */
export interface SeasonedSkillsConfig {
  /** How the project refers to itself in generated instructions. */
  projectName: string

  /**
   * Directory of project-owned content the generation weaves in: one markdown
   * file per generated skill plus one for the doctrine layer. Every file is
   * mandatory once the skill generates — sync fails loud on an absent one.
   */
  contentDir: string

  /**
   * How a branch reaches the mainline — and with it how a pushed branch syncs
   * with its base, because the sync strategy follows from the merge strategy.
   */
  mergeStrategy: 'merge-commit' | 'squash'

  /**
   * Whether agents may merge to the base branch while executing a goal.
   * Off by default; opting in is a per-project decision.
   */
  agentMergesDuringGoal?: boolean

  /**
   * What an agent does with breakage it discovers outside its task's scope.
   * 'bank' (the conservative default): findings are banked with evidence and
   * adjudicated with the user. 'autofix': agents fix discovered breakage
   * autonomously under the codified Definition of Broken, always in a
   * dedicated pass.
   */
  outOfScopeFindings?: 'bank' | 'autofix'

  /** What a release is for this project — two durably different practices. */
  release: ReleaseConfig

  /** The project's gate commands, woven into the generated doctrine and skills. */
  gates: GateCommands

  /**
   * Committed, project-owned file of subagent calibrations, stated relative to
   * the Definition of Done. The install seeds it; updates travel as project
   * pull requests.
   */
  calibrationFile: string

  /**
   * Declared when the project has a user-facing web surface. Browser
   * verification and the responsive bar bind only where this exists, and the
   * coverage register binds where there are routes to cover.
   */
  webSurface?: WebSurfaceConfig

  /**
   * Switches the demo-seed criterion on: every new or changed user-facing
   * surface ships its seed section and its manifest entry in the same change.
   */
  demoSeed?: DemoSeedConfig

  /**
   * Declared when the project exposes a machine surface (an MCP server, a
   * public API). Switches the capability-parity criterion on.
   */
  machineSurface?: MachineSurfaceConfig

  /**
   * The stack layer — the only optional layer today. A project declares its
   * stack, or doesn't; disabling it removes every trace.
   */
  stack?: StackConfig

  /**
   * The resource table worktree provisioning is driven by: which repositories
   * a lane can cover, and what each of them owns — databases, port bases, env
   * files — alongside the shared services the machine provides.
   */
  provisioning?: ProvisioningConfig

  /**
   * Whole Definition of Done criteria the project injects beyond the core,
   * each backed by the project's own gate or committed skill.
   */
  additionalCriteria?: CriterionInjection[]

  /**
   * Quick-mode disqualifiers the project adds to the package's base list
   * (a new route, table, permission, or product surface).
   */
  quickDisqualifiers?: string[]

  /**
   * Binaries this project's own content depends on, beyond the ones the
   * enabled layers and skills already declare. Doctor checks them like every
   * other prerequisite — advisory, never blocking.
   */
  machinePrerequisites?: MachinePrerequisite[]
}

export interface MachinePrerequisite {
  /** The binary that must be on the PATH. */
  binary: string
  /** Why this project needs it, phrased to follow "Needed because …". */
  reason: string
  /** How to install it: a command, a URL, or both. */
  hint: string
}

export type ReleaseConfig =
  | {
      /** Curated notes, badge stamping, the pre-release audit pull request, and a publish that triggers the deploy. */
      target: 'deployed-product'
    }
  | {
      /**
       * The published-package flow: per-package bumps from the diff since the
       * last tag, gates, a commit to the default branch, and one GitHub
       * release per bumped package. npm publish never runs from continuous
       * integration — the user publishes locally.
       */
      target: 'published-package'
      packages: PackageReleaseFacts[]
    }

export interface PackageReleaseFacts {
  name: string
  /** Tag prefix for this package's releases, when not the default `v`. */
  tagPrefix?: string
  /** The command the user runs locally to publish. */
  publishCommand: string
}

export interface GateCommands {
  /** Fast checks a builder runs in its own foreground. */
  lint?: string
  typecheck?: string
  /** The unit-test suite counted among the fast gates. */
  unit?: string
  /** Runs the specs related to a change locally, chosen by blast radius. */
  relatedSpecs?: string
  /**
   * The long gates the orchestrator owns, run as its own background shells.
   */
  full?: string[]
}

export interface WebSurfaceConfig {
  /**
   * The shrink-only register of unreached surfaces, seeded at install when the
   * project already has them; once empty it is held empty forever.
   */
  coverageRegister: string
  /**
   * Committed list of surfaces a spec genuinely cannot reach, each entry
   * admitted only with a one-line written rationale.
   */
  excusedSurfaces: string
}

export interface DemoSeedConfig {
  /** The committed seed manifest the criterion asserts entries into. */
  seedManifest: string
}

export interface MachineSurfaceConfig {
  /** The committed capability-parity standard the review skills audit against. */
  parityStandard: string
  /**
   * The committed exception register: every tool standing outside the
   * wrap-a-business-function rule, with a one-line rationale each.
   */
  exceptionRegister: string
}

export interface StackConfig {
  name: 'react-router-kysely'
  /**
   * The stack layer's deepest option: 'append-only' (insert is the only write,
   * deletion is an event) or 'mutable-when-not-derivable' (in-place updates
   * and explicit transactional deletes stay legitimate).
   */
  databaseMutability: 'append-only' | 'mutable-when-not-derivable'
}

/**
 * The provisioning resource table. What a lane's isolation is derived from
 * belongs to the repository entry that owns it; what stays here is genuinely
 * project- or machine-scoped.
 */
export interface ProvisioningConfig {
  /**
   * The repositories a lane can be provisioned across, each declaring what it
   * owns. Defaults to this project's own checkout with no resources.
   */
  repositories?: RepositoryResource[]
  /** Shared services probed before starting, in case the machine already runs them. */
  services?: string[]
  /**
   * Command run from the main checkout to start declared services that are
   * not already listening; the not-running service names are appended.
   * Defaults to `docker compose up -d`.
   */
  serviceStartCommand?: string
  /**
   * Prefix every lane-owned database name carries; the teardown guard refuses
   * to drop anything outside it. Defaults to `<project-directory>_wt_`.
   */
  databasePrefix?: string
  /**
   * IANA timezone anchoring the seed date stored in template fingerprints,
   * so demo data re-anchors on the team's calendar day. Defaults to the
   * machine's timezone.
   */
  seedDateTimezone?: string
  /**
   * Command names the lane-process sweep enumerates (lsof by working
   * directory under the worktrees roots). Defaults to common dev-server
   * commands; interactive shells are never listed.
   */
  laneProcessCommands?: string[]
}

export interface EnvFileResource {
  /** Path relative to the declaring repository's worktree (e.g. 'apps/web/.env.test'). */
  path: string
  /** Names of declared database resources whose lane URLs this file carries (each written under its database's envKey). */
  databases?: string[]
  /** Managed port entries: env key → declared port name (e.g. { PORT: 'testPort', MAILDEV_PORT: 'testMaildevPort' }). */
  ports?: Record<string, string>
  /** Whether this file carries the lane's cache-store URL entries (cacheStoreEnvKeys). Default false. */
  cacheStore?: boolean
  /** Extra managed entries. Values may contain the tokens {slug} (the lane slug) and {slug-dashed} (the slug with underscores replaced by dashes). */
  extra?: Record<string, string>
}

export interface DatabaseResource {
  name: string
  /** Patterns for databases derived from this one, dropped with it at teardown. */
  derivedPatterns?: string[]
  /**
   * Env key that receives this database's lane URL in the managed block.
   * Defaults to `<NAME>_DATABASE_URL`.
   */
  envKey?: string
  /**
   * Whether this database receives the seed (and, under template caching,
   * whether its template is built with the seed baked in).
   */
  seeded?: boolean
}

/**
 * One repository a lane can cover, and everything that repository owns inside
 * the lane. `provision <lane> --repo <path>` selects entries by this path;
 * without the flag a lane covers the first declared entry alone. An entry that
 * declares no resources gets a worktree and its provision steps, nothing more.
 */
export interface RepositoryResource {
  /** Path to this repository's main checkout, relative to the project's own. */
  path: string
  /** Commands that provision this repository inside a fresh lane. */
  provisionSteps?: string[]
  /** The command that seeds this repository's databases, run only for databases created in the same run. */
  seedCommand?: string
  /**
   * Command that migrates a database, run in this repository's lane worktree
   * with that database's env key pointing at the target. Required when this
   * entry declares databases.
   */
  migrateCommand?: string
  /** Databases this repository owns in the lane; each may declare derived-name patterns. */
  databases?: DatabaseResource[]
  /**
   * Env file, relative to this repository's worktree, that carries the
   * managed allocation block. Defaults to `.env`.
   */
  envFile?: string
  /**
   * This repository's lane env files, when the single `envFile` is not enough
   * — e.g. a second file for the test environment that reuses the same env key
   * names for different allocations. When declared, this fully replaces the
   * single-file behavior (`envFile` is ignored): each entry seeds from this
   * repository's main checkout at the same relative path and carries its own
   * slice of the managed allocation block.
   */
  envFiles?: EnvFileResource[]
  /** Base port each of this repository's services derives its lane-specific port from. */
  portBases?: Record<string, number>
  /**
   * How many consecutive ports a named port holds (e.g. one per E2E worker:
   * the head port plus one per extra worker). Ports not listed hold one.
   * Allocation hands out and reserves whole blocks.
   */
  portBlocks?: Record<string, number>
  /** Keeps this repository's expensive migrate-and-seed result as a fingerprinted template database. */
  templateCaching?: boolean
  /** Gives the lane a cache-store index, flushed at allocation. */
  cacheStoreIndex?: boolean
  /**
   * Env keys that receive the lane's cache-store URL (base URL plus the
   * lane's index). Defaults to `['REDIS_URL']`.
   */
  cacheStoreEnvKeys?: string[]
  /**
   * Paths, relative to this repository's worktree, whose contents fingerprint
   * the migrations for template caching. Required when templateCaching is on.
   */
  migrationSources?: string[]
  /** Paths, relative to this repository's worktree, whose contents fingerprint the seed. */
  seedSources?: string[]
}

export interface CriterionInjection {
  /** The criterion, phrased as "a task is not done if …". */
  text: string
  /** The project's own gate command or committed skill that backs it. */
  backedBy: string
  /** How the criterion behaves in quick mode — declared in the same change that injects it. */
  quickDisposition: 'kept' | 'reduced' | 'excluded'
  /** The reduced phrasing, when the disposition is 'reduced'. */
  quickText?: string
}
