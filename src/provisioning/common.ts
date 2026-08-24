import { createHash } from 'node:crypto'
import type {
  DatabaseResource,
  EnvFileResource,
  ProvisioningConfig,
  RepositoryResource,
} from '../config/types.js'

/**
 * Pure provisioning logic: resource allocation by deterministic hash of the
 * lane name, the managed environment block that records the allocation and
 * doubles as the idempotency sentinel, port-block planning, derived-database
 * family matching, template fingerprints, and lsof output parsing. Everything
 * here is side-effect free and unit-tested; the runtime modules wire it to
 * git, Postgres, and the filesystem.
 */

const ENV_MARKER =
  '# --- managed by seasoned-skills worktree provisioning (per-lane isolation) ---'

const DEFAULT_ENV_FILE = '.env'
const DEFAULT_CACHE_STORE_ENV_KEYS = ['REDIS_URL']
const DEFAULT_SERVICE_START_COMMAND = 'docker compose up -d'
const DEFAULT_LANE_PROCESS_COMMANDS = [
  'node',
  'pnpm',
  'npm',
  'yarn',
  'turbo',
  'vite',
  'python',
  'python3',
  'uv',
]

/** Indexes 1..14 — 0 stays with the main checkout and is never touched. */
const CACHE_STORE_INDEXES = 14

/** The window of offsets a lane's hash spreads port plans across. */
const PORT_OFFSET_RANGE = 400

const POSTGRES_IDENTIFIER_LIMIT = 63

type PortPlan = Record<string, number>

type TemplateFingerprint = {
  migrationsHash: string
  seedHash?: string
  seedDate?: string
}

type ResolvedDatabase = {
  name: string
  envKey: string
  seeded: boolean
  derivedPatterns: string[]
}

type ResolvedEnvFile = {
  /** Path relative to the declaring repository's worktree. */
  path: string
  /** Declared database resources whose lane URLs this file carries. */
  databases: ResolvedDatabase[]
  /** Managed port entries: env key → declared port name. */
  ports: Record<string, string>
  /** Whether this file carries the lane's cache-store URL entries. */
  cacheStore: boolean
  /** Extra managed entries, slug tokens not yet replaced. */
  extra: Record<string, string>
}

/** One repository entry with every default applied — everything it owns in a lane. */
type ResolvedRepository = {
  path: string
  provisionSteps: string[]
  migrateCommand: string | undefined
  seedCommand: string | undefined
  databases: ResolvedDatabase[]
  portBases: Record<string, number>
  portBlocks: Record<string, number>
  templateCaching: boolean
  cacheStoreIndex: boolean
  cacheStoreEnvKeys: string[]
  envFile: string
  /**
   * At least one entry; the absent case is synthesized as one file at
   * `envFile` carrying this repository's whole slice, so downstream code has
   * one code path over a list.
   */
  envFiles: ResolvedEnvFile[]
  migrationSources: string[]
  seedSources: string[]
}

type ResolvedProvisioning = {
  /** At least one entry, in declaration order; the first is the default selection. */
  repositories: ResolvedRepository[]
  services: string[]
  serviceStartCommand: string
  databasePrefix: string
  seedDateTimezone: string | undefined
  laneProcessCommands: string[]
}

const RESOURCE_NAME_PATTERN = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/
const PORT_NAME_PATTERN = /^[a-z][a-zA-Z0-9]*$/

function laneSlug(lane: string) {
  return lane
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 28)
    .replace(/_+$/, '')
}

/** Default database prefix for a project, from its main checkout's directory name. */
function defaultDatabasePrefix(projectDirectoryName: string) {
  const slug = laneSlug(projectDirectoryName)
  if (!slug) {
    throw new Error(
      `cannot derive a database prefix from "${projectDirectoryName}"; declare provisioning.databasePrefix`,
    )
  }
  return `${slug}_wt_`
}

/** Resource options that used to sit at the top level and now belong to a repository entry. */
const RELOCATED_TOP_LEVEL_OPTIONS = [
  'databases',
  'portBases',
  'portBlocks',
  'envFile',
  'envFiles',
  'templateCaching',
  'cacheStoreIndex',
  'cacheStoreEnvKeys',
  'migrationSources',
  'seedSources',
]

/**
 * Refuse a table still carrying the relocated options at the top level. Nothing
 * reads them any more, so a silently ignored `databases` or `envFile` would
 * leave the lane running its steps against the developer's own databases.
 */
function refuseRelocatedTopLevelOptions(provisioning: ProvisioningConfig) {
  const present = RELOCATED_TOP_LEVEL_OPTIONS.filter((option) => option in provisioning)
  if (present.length === 0) return
  throw new Error(
    `provisioning no longer carries ${present.map((option) => `"${option}"`).join(', ')} at the top level; move each into the repositories entry that owns it`,
  )
}

/**
 * Refuse a database name two declared repositories share. The namespace is
 * project-global: a lane database is named from the prefix, the lane slug, and
 * the resource name, and a template database from the prefix and the resource
 * name — neither carries the repository, so two entries sharing a name would
 * migrate one another's databases across successive runs of one lane.
 */
function refuseSharedDatabaseNames(repositories: ResolvedRepository[]) {
  const declaredBy = new Map<string, string>()
  for (const repository of repositories) {
    for (const database of repository.databases) {
      const other = declaredBy.get(database.name)
      if (other !== undefined) {
        throw new Error(
          `repositories "${other}" and "${repository.path}" both declare the database "${database.name}"; lane and template database names carry no repository, so a database name is unique across the whole table`,
        )
      }
      declaredBy.set(database.name, repository.path)
    }
  }
}

/**
 * Normalize the resource table: apply every default, validate names, and fail
 * loud on a table the implementation cannot honor. `databasePrefix` falls back
 * to the given default (derived from the project directory by the caller).
 */
function resolveProvisioning(
  config: ProvisioningConfig | undefined,
  defaults: { databasePrefix: string },
): ResolvedProvisioning {
  const provisioning = config ?? {}
  refuseRelocatedTopLevelOptions(provisioning)
  const databasePrefix = provisioning.databasePrefix ?? defaults.databasePrefix
  if (!/^[a-z][a-z0-9_]*_$/.test(databasePrefix)) {
    throw new Error(
      `databasePrefix "${databasePrefix}" must be lowercase alphanumeric/underscore and end with an underscore`,
    )
  }
  const declared = provisioning.repositories?.length
    ? provisioning.repositories
    : [{ path: '.' }]
  const seenPaths = new Set<string>()
  for (const repository of declared) {
    if (seenPaths.has(repository.path)) {
      throw new Error(`repository "${repository.path}" is declared twice`)
    }
    seenPaths.add(repository.path)
  }
  const repositories = declared.map(resolveRepository)
  refuseSharedDatabaseNames(repositories)
  return {
    repositories,
    services: provisioning.services ?? [],
    serviceStartCommand:
      provisioning.serviceStartCommand ?? DEFAULT_SERVICE_START_COMMAND,
    databasePrefix,
    seedDateTimezone: provisioning.seedDateTimezone,
    laneProcessCommands:
      provisioning.laneProcessCommands ?? DEFAULT_LANE_PROCESS_COMMANDS,
  }
}

/**
 * Normalize one repository entry. Every cross-field rule is an entry-level
 * rule: what a repository declares, it declares whole.
 */
function resolveRepository(repository: RepositoryResource): ResolvedRepository {
  const databases = (repository.databases ?? []).map(resolveDatabase)
  const seen = new Set<string>()
  for (const database of databases) {
    if (seen.has(database.name)) {
      throw new Error(
        `repository "${repository.path}" declares the database resource "${database.name}" twice`,
      )
    }
    seen.add(database.name)
  }
  const portBases = repository.portBases ?? {}
  const portBlocks = repository.portBlocks ?? {}
  for (const name of Object.keys(portBases)) {
    if (!PORT_NAME_PATTERN.test(name)) {
      throw new Error(`port name "${name}" must be camelCase alphanumeric`)
    }
  }
  for (const [name, span] of Object.entries(portBlocks)) {
    if (!(name in portBases)) {
      throw new Error(`portBlocks names "${name}" but portBases does not declare it`)
    }
    if (!Number.isInteger(span) || span < 1) {
      throw new Error(`portBlocks.${name} must be a positive integer`)
    }
  }
  const templateCaching = repository.templateCaching ?? false
  const migrationSources = repository.migrationSources ?? []
  if (templateCaching && migrationSources.length === 0) {
    throw new Error(
      `repository "${repository.path}" turns templateCaching on but declares no migrationSources to fingerprint`,
    )
  }
  if (databases.length > 0 && !repository.migrateCommand) {
    throw new Error(
      `repository "${repository.path}" must declare migrateCommand when it owns databases`,
    )
  }
  const envFile = repository.envFile ?? DEFAULT_ENV_FILE
  const cacheStoreIndex = repository.cacheStoreIndex ?? false
  const cacheStoreEnvKeys = repository.cacheStoreEnvKeys ?? DEFAULT_CACHE_STORE_ENV_KEYS
  return {
    path: repository.path,
    provisionSteps: repository.provisionSteps ?? [],
    migrateCommand: repository.migrateCommand,
    seedCommand: repository.seedCommand,
    databases,
    portBases,
    portBlocks,
    templateCaching,
    cacheStoreIndex,
    cacheStoreEnvKeys,
    envFile,
    envFiles: resolveEnvFiles(repository.envFiles, {
      envFile,
      databases,
      portBases,
      cacheStoreIndex,
      cacheStoreEnvKeys,
    }),
    migrationSources,
    seedSources: repository.seedSources ?? [],
  }
}

/**
 * The lane's shared port pool, collected across the repositories one
 * provisioning run covers. Port allocation is lane-wide, so a name two covered
 * repositories both declare would hand them the same port. That is refused
 * here, where the selection is known, rather than in the table: repositories
 * that never land in one lane together are free to reuse each other's port
 * names.
 */
function laneResourcePool(repositories: ResolvedRepository[]) {
  const portBases: Record<string, number> = {}
  const portBlocks: Record<string, number> = {}
  const portDeclaredBy = new Map<string, string>()
  for (const repository of repositories) {
    for (const [name, base] of Object.entries(repository.portBases)) {
      const other = portDeclaredBy.get(name)
      if (other !== undefined) {
        throw new Error(
          `repositories "${other}" and "${repository.path}" both declare the port "${name}"; a lane covering both needs distinct port names`,
        )
      }
      portDeclaredBy.set(name, repository.path)
      portBases[name] = base
    }
    for (const [name, span] of Object.entries(repository.portBlocks)) {
      portBlocks[name] = span
    }
  }
  return { portBases, portBlocks }
}

function resolveDatabase(database: DatabaseResource): ResolvedDatabase {
  if (!RESOURCE_NAME_PATTERN.test(database.name)) {
    throw new Error(
      `database resource name "${database.name}" must be a lowercase slug with single underscores`,
    )
  }
  return {
    name: database.name,
    envKey: database.envKey ?? defaultDatabaseEnvKey(database.name),
    seeded: database.seeded ?? false,
    derivedPatterns: database.derivedPatterns ?? [],
  }
}

const ENV_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/

/**
 * Normalize the declared env files. When none are declared, the single-file
 * behavior is synthesized as one entry at `envFile` carrying every database,
 * every port under its derived key, and the cache-store URL — so every
 * consumer walks the same list. Declared entries fully replace that, and are
 * validated loudly: every referenced resource must exist, and every allocated
 * resource must be recorded in some file, or its value would be unreachable
 * (and lost on an idempotent re-run).
 */
function resolveEnvFiles(
  declared: EnvFileResource[] | undefined,
  context: {
    envFile: string
    databases: ResolvedDatabase[]
    portBases: Record<string, number>
    cacheStoreIndex: boolean
    cacheStoreEnvKeys: string[]
  },
): ResolvedEnvFile[] {
  const { envFile, databases, portBases, cacheStoreIndex, cacheStoreEnvKeys } = context
  if (declared === undefined) {
    return [
      {
        path: envFile,
        databases,
        ports: Object.fromEntries(
          Object.keys(portBases).map((name) => [envKeyForPort(name), name]),
        ),
        cacheStore: true,
        extra: {},
      },
    ]
  }
  if (declared.length === 0) {
    throw new Error('envFiles must declare at least one file')
  }
  const byName = new Map(databases.map((database) => [database.name, database]))
  const seenPaths = new Set<string>()
  const envFiles = declared.map((file): ResolvedEnvFile => {
    if (seenPaths.has(file.path)) {
      throw new Error(`envFiles declares "${file.path}" twice`)
    }
    seenPaths.add(file.path)
    const fileDatabases = (file.databases ?? []).map((name) => {
      const database = byName.get(name)
      if (!database) {
        throw new Error(
          `envFiles entry "${file.path}" names database "${name}" but no database resource declares it`,
        )
      }
      return database
    })
    for (const [envKey, portName] of Object.entries(file.ports ?? {})) {
      if (!ENV_KEY_PATTERN.test(envKey)) {
        throw new Error(
          `envFiles entry "${file.path}" uses env key "${envKey}"; keys must be SCREAMING_SNAKE_CASE`,
        )
      }
      if (!Object.hasOwn(portBases, portName)) {
        throw new Error(
          `envFiles entry "${file.path}" maps ${envKey} to port "${portName}" but portBases does not declare it`,
        )
      }
    }
    for (const envKey of Object.keys(file.extra ?? {})) {
      if (!ENV_KEY_PATTERN.test(envKey)) {
        throw new Error(
          `envFiles entry "${file.path}" uses env key "${envKey}"; keys must be SCREAMING_SNAKE_CASE`,
        )
      }
    }
    const writtenKeys = [
      ...(file.cacheStore && cacheStoreIndex ? cacheStoreEnvKeys : []),
      ...fileDatabases.map((database) => database.envKey),
      ...Object.keys(file.ports ?? {}),
      ...Object.keys(file.extra ?? {}),
    ]
    const duplicate = writtenKeys.find((key, index) => writtenKeys.indexOf(key) !== index)
    if (duplicate !== undefined) {
      throw new Error(
        `envFiles entry "${file.path}" writes env key "${duplicate}" more than once`,
      )
    }
    return {
      path: file.path,
      databases: fileDatabases,
      ports: file.ports ?? {},
      cacheStore: file.cacheStore ?? false,
      extra: file.extra ?? {},
    }
  })
  for (const database of databases) {
    const carried = envFiles.some((file) =>
      file.databases.some((candidate) => candidate.name === database.name),
    )
    if (!carried) {
      throw new Error(
        `database "${database.name}" is listed in no envFiles entry; its lane URL would be recorded nowhere`,
      )
    }
  }
  for (const portName of Object.keys(portBases)) {
    const carried = envFiles.some((file) => Object.values(file.ports).includes(portName))
    if (!carried) {
      throw new Error(
        `port "${portName}" is mapped in no envFiles entry; its lane port would be recorded nowhere`,
      )
    }
  }
  if (cacheStoreIndex && !envFiles.some((file) => file.cacheStore)) {
    throw new Error(
      'cacheStoreIndex is on but no envFiles entry carries cacheStore; the lane cache-store URL would be recorded nowhere',
    )
  }
  return envFiles
}

function screamingSnakeCase(name: string) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()
}

function envKeyForPort(portName: string) {
  return screamingSnakeCase(portName)
}

function defaultDatabaseEnvKey(resourceName: string) {
  return `${resourceName.toUpperCase()}_DATABASE_URL`
}

function laneDatabaseName(prefix: string, slug: string, resourceName: string) {
  const name = `${prefix}${slug}_${resourceName}`
  if (name.length > POSTGRES_IDENTIFIER_LIMIT) {
    throw new Error(
      `database name "${name}" exceeds Postgres's ${POSTGRES_IDENTIFIER_LIMIT}-character limit; shorten the lane name`,
    )
  }
  return name
}

/**
 * Template names carry a double underscore no `laneSlug` output can produce
 * (separators collapse to single underscores), so no lane's databases can
 * ever collide with — or match teardown patterns against — a template.
 */
function templateDatabaseName(prefix: string, resourceName: string) {
  return `${prefix}template__${resourceName}`
}

function buildingTemplateDatabaseName(prefix: string, resourceName: string) {
  return `${prefix}template_building__${resourceName}`
}

function isLaneOwnedDatabaseName(prefix: string, name: string) {
  return name.startsWith(prefix) && /^[a-z0-9_]+$/.test(name)
}

/**
 * FNV-1a hash of the slug, folded into the offset window. The offset moves in
 * whole blocks of `step` ports (the widest declared port block), so two lanes
 * either land on the same ports — which assignment resolves — or a full
 * block apart, never one-to-three ports apart where an overlap would only
 * surface once both lanes run at the same time.
 */
function hashOffset(slug: string, step = 1) {
  let hash = 2166136261
  for (const character of slug) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  const slots = Math.floor(PORT_OFFSET_RANGE / step)
  return (Math.abs(hash) % slots) * step
}

function widestPortBlock(portBlocks: Record<string, number>) {
  return Math.max(1, ...Object.values(portBlocks))
}

/** Every port a named port holds: itself plus its block, for blocked ports. */
function portsHeldBy(portName: string, port: number, portBlocks: Record<string, number>) {
  const span = portBlocks[portName] ?? 1
  return Array.from({ length: span }, (_, held) => port + held)
}

function basePortPlan(
  slug: string,
  portBases: Record<string, number>,
  portBlocks: Record<string, number> = {},
) {
  const offset = hashOffset(slug, widestPortBlock(portBlocks))
  return Object.fromEntries(
    Object.entries(portBases).map(([name, base]) => [name, base + offset]),
  ) as PortPlan
}

function assignPortPlan(
  slug: string,
  portBases: Record<string, number>,
  portBlocks: Record<string, number> = {},
  reservedPorts: Iterable<number> = [],
) {
  const taken = new Set<number>(reservedPorts)
  const resolved: PortPlan = {}
  for (const [name, base] of Object.entries(basePortPlan(slug, portBases, portBlocks))) {
    let port = base
    while (portsHeldBy(name, port, portBlocks).some((held) => taken.has(held))) {
      port += 1
    }
    for (const held of portsHeldBy(name, port, portBlocks)) taken.add(held)
    resolved[name] = port
  }
  return resolved
}

async function busyPorts(
  plan: PortPlan,
  portBlocks: Record<string, number>,
  isPortFree: (port: number) => boolean | Promise<boolean>,
) {
  const busy: number[] = []
  for (const [name, port] of Object.entries(plan)) {
    for (const held of portsHeldBy(name, port, portBlocks)) {
      if (!(await isPortFree(held))) busy.push(held)
    }
  }
  return busy
}

async function resolvePortPlan(
  slug: string,
  portBases: Record<string, number>,
  portBlocks: Record<string, number>,
  reservedPorts: Iterable<number>,
  isPortFree: (port: number) => boolean | Promise<boolean>,
) {
  const reserved = new Set<number>(reservedPorts)
  let plan = assignPortPlan(slug, portBases, portBlocks, reserved)
  let busy = await busyPorts(plan, portBlocks, isPortFree)
  while (busy.length > 0) {
    for (const port of busy) reserved.add(port)
    plan = assignPortPlan(slug, portBases, portBlocks, reserved)
    busy = await busyPorts(plan, portBlocks, isPortFree)
  }
  return plan
}

/** Ports an env-value record claims, whole blocks included. */
function portsClaimedByEnv(
  values: Record<string, string>,
  portBases: Record<string, number>,
  portBlocks: Record<string, number> = {},
) {
  return Object.keys(portBases).flatMap((name) => {
    const port = Number(values[envKeyForPort(name)])
    if (!Number.isInteger(port) || port <= 0) return []
    return portsHeldBy(name, port, portBlocks)
  })
}

function reservedPortsFromEnvFiles(
  envFileContents: Iterable<string | null | undefined>,
  portBases: Record<string, number>,
  portBlocks: Record<string, number> = {},
) {
  const reserved = new Set<number>()
  for (const contents of envFileContents) {
    if (!contents?.includes(ENV_MARKER)) continue
    for (const port of portsClaimedByEnv(
      readEnvValues(contents),
      portBases,
      portBlocks,
    )) {
      reserved.add(port)
    }
  }
  return reserved
}

/**
 * Ports an env-value record claims under one declared file's own key→port
 * mapping, whole blocks included. The same env key name in two files maps to
 * different ports, so claims are always read per file.
 */
function portsClaimedByEnvFile(
  values: Record<string, string>,
  file: ResolvedEnvFile,
  portBlocks: Record<string, number> = {},
) {
  return Object.entries(file.ports).flatMap(([envKey, portName]) => {
    const port = Number(values[envKey])
    if (!Number.isInteger(port) || port <= 0) return []
    return portsHeldBy(portName, port, portBlocks)
  })
}

/**
 * Every port sibling lanes hold in one repository, scanned across every env
 * file that repository declares — one contents entry per declared file, in
 * declaration order. A colliding key name (e.g. PORT in two files)
 * contributes both values.
 */
function reservedPortsFromLaneEnvFiles(
  laneContents: Iterable<readonly (string | null | undefined)[]>,
  repository: ResolvedRepository,
) {
  const reserved = new Set<number>()
  for (const contentsByFile of laneContents) {
    repository.envFiles.forEach((file, index) => {
      const contents = contentsByFile[index]
      if (!contents?.includes(ENV_MARKER)) return
      for (const port of portsClaimedByEnvFile(
        readEnvValues(contents),
        file,
        repository.portBlocks,
      )) {
        reserved.add(port)
      }
    })
  }
  return reserved
}

function worktreePathsFromPorcelain(listing: string, excludePath: string) {
  const paths: string[] = []
  for (const line of listing.split('\n')) {
    const match = line.match(/^worktree (.+)$/)
    const path = match?.[1]
    if (!path || path === excludePath) continue
    paths.push(path)
  }
  return paths
}

function withDatabaseName(databaseUrl: string, databaseName: string) {
  const url = new URL(databaseUrl)
  url.pathname = `/${databaseName}`
  return url.toString()
}

function databaseNameFromUrl(databaseUrl: string) {
  return new URL(databaseUrl).pathname.replace(/^\//, '')
}

function readEnvValues(contents: string) {
  const values: Record<string, string> = {}
  for (const line of contents.split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (match?.[1] !== undefined && match[2] !== undefined) {
      values[match[1]] = match[2]
    }
  }
  return values
}

function upsertEnvValues(contents: string, values: Record<string, string>) {
  const managedKeys = new Set(Object.keys(values))
  const keptLines = contents.split('\n').filter((line) => {
    if (line.trim() === ENV_MARKER) return false
    const match = line.match(/^([A-Z0-9_]+)=/)
    return !(match?.[1] !== undefined && managedKeys.has(match[1]))
  })
  while (keptLines.at(-1) === '') keptLines.pop()
  const managedLines = Object.entries(values).map(([key, value]) => `${key}=${value}`)
  return [...keptLines, '', ENV_MARKER, ...managedLines, ''].join('\n')
}

/**
 * Repoint localhost URLs in copied env contents from the main checkout's port
 * to the lane's, so OAuth callbacks and self-referencing URLs keep working
 * inside the lane.
 */
function repointLocalhostUrls(contents: string, fromPort: number, toPort: number) {
  if (!Number.isInteger(fromPort) || fromPort === toPort) return contents
  const localhostPort = new RegExp(
    `(?<![\\w.])((?:localhost|127\\.0\\.0\\.1):)${fromPort}\\b`,
    'g',
  )
  return contents
    .split('\n')
    .map((line) => {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (match?.[1] === undefined || match[2] === undefined) return line
      return `${match[1]}=${match[2].replace(localhostPort, (_, host) => `${host}${toPort}`)}`
    })
    .join('\n')
}

type LaneAllocation = {
  ports: PortPlan
  /** Lane database URL per database resource name. */
  databaseUrls: Record<string, string>
  cacheStoreUrl?: string
}

/**
 * The values the managed block records — one repository's whole slice of the
 * lane's allocation. The block is what makes re-runs idempotent: parse it back
 * and the lane keeps its ports, databases, and cache-store index.
 */
function laneEnvValues(allocation: LaneAllocation, repository: ResolvedRepository) {
  const values: Record<string, string> = {}
  for (const database of repository.databases) {
    const url = allocation.databaseUrls[database.name]
    if (url === undefined) {
      throw new Error(`allocation carries no URL for database "${database.name}"`)
    }
    values[database.envKey] = url
  }
  for (const name of Object.keys(repository.portBases)) {
    const port = allocation.ports[name]
    if (port === undefined) {
      throw new Error(`allocation carries no port for "${name}"`)
    }
    values[envKeyForPort(name)] = String(port)
  }
  if (repository.cacheStoreIndex) {
    if (allocation.cacheStoreUrl === undefined) {
      throw new Error('allocation carries no cache-store URL')
    }
    for (const key of repository.cacheStoreEnvKeys) {
      values[key] = allocation.cacheStoreUrl
    }
  }
  return values
}

/** Replace the slug tokens an extra managed entry's value may carry. */
function replaceSlugTokens(value: string, slug: string) {
  return value
    .replaceAll('{slug}', slug)
    .replaceAll('{slug-dashed}', slug.replaceAll('_', '-'))
}

/**
 * The slice of the allocation one declared env file records: its databases'
 * URLs under their env keys, its port entries under the declared keys, the
 * cache-store URL when the file carries it, and its extra entries with the
 * slug tokens replaced.
 */
function laneEnvValuesForFile(
  allocation: LaneAllocation,
  repository: ResolvedRepository,
  file: ResolvedEnvFile,
  slug: string,
) {
  const values: Record<string, string> = {}
  for (const database of file.databases) {
    const url = allocation.databaseUrls[database.name]
    if (url === undefined) {
      throw new Error(`allocation carries no URL for database "${database.name}"`)
    }
    values[database.envKey] = url
  }
  for (const [envKey, portName] of Object.entries(file.ports)) {
    const port = allocation.ports[portName]
    if (port === undefined) {
      throw new Error(`allocation carries no port for "${portName}"`)
    }
    values[envKey] = String(port)
  }
  if (file.cacheStore && repository.cacheStoreIndex) {
    if (allocation.cacheStoreUrl === undefined) {
      throw new Error('allocation carries no cache-store URL')
    }
    for (const key of repository.cacheStoreEnvKeys) {
      values[key] = allocation.cacheStoreUrl
    }
  }
  for (const [key, value] of Object.entries(file.extra)) {
    values[key] = replaceSlugTokens(value, slug)
  }
  return values
}

/**
 * Every file one repository declares, its slice of the allocation merged into
 * one record, in declaration order, the first file winning on a colliding key
 * — the environment that repository's provisioning steps run under. For the
 * synthesized single-file case this equals `laneEnvValues`.
 */
function mergedLaneEnvValues(
  allocation: LaneAllocation,
  repository: ResolvedRepository,
  slug: string,
) {
  const merged: Record<string, string> = {}
  for (const file of repository.envFiles) {
    for (const [key, value] of Object.entries(
      laneEnvValuesForFile(allocation, repository, file, slug),
    )) {
      if (!(key in merged)) merged[key] = value
    }
  }
  return merged
}

/**
 * Read one repository's slice of a lane's allocation back from its env files
 * — one contents entry per declared file, in declaration order, null where a
 * file is absent. A managed block in ANY file is the sentinel: with none, the
 * repository's lane worktree is fresh. With one, the allocation is merged from
 * every marked file using that file's own key→port mapping; a file may be
 * missing its block (the caller re-writes it from the merged allocation), but
 * a value recorded nowhere — or recorded twice with a disagreement — is a
 * hand-edit the implementation refuses to guess about.
 */
function parseLaneAllocationFromFiles(
  contentsByFile: readonly (string | null | undefined)[],
  repository: ResolvedRepository,
): LaneAllocation | null {
  if (!contentsByFile.some((contents) => contents?.includes(ENV_MARKER))) return null
  const complain = (what: string): never => {
    throw new Error(
      `the managed env block is present but ${what} is missing; fix or delete the managed blocks and re-run`,
    )
  }
  const disagree = (what: string): never => {
    throw new Error(
      `the managed env blocks disagree about ${what}; fix or delete the managed blocks and re-run`,
    )
  }
  const ports: PortPlan = {}
  const databaseUrls: Record<string, string> = {}
  let cacheStoreUrl: string | undefined
  repository.envFiles.forEach((file, index) => {
    const contents = contentsByFile[index]
    if (!contents?.includes(ENV_MARKER)) return
    const values = readEnvValues(contents)
    for (const [envKey, portName] of Object.entries(file.ports)) {
      const port = Number(values[envKey])
      if (!Number.isInteger(port) || port <= 0) complain(`${envKey} (in ${file.path})`)
      if (ports[portName] !== undefined && ports[portName] !== port) {
        disagree(`the port "${portName}"`)
      }
      ports[portName] = port
    }
    for (const database of file.databases) {
      const url = values[database.envKey]
      if (!url) complain(`${database.envKey} (in ${file.path})`)
      else {
        const known = databaseUrls[database.name]
        if (known !== undefined && known !== url) {
          disagree(`the URL for database "${database.name}"`)
        }
        databaseUrls[database.name] = url
      }
    }
    if (file.cacheStore && repository.cacheStoreIndex) {
      const key = repository.cacheStoreEnvKeys[0]
      const url = key === undefined ? undefined : values[key]
      if (!url) complain(`${key ?? 'the cache-store env key'} (in ${file.path})`)
      else {
        if (cacheStoreUrl !== undefined && cacheStoreUrl !== url) {
          disagree('the cache-store URL')
        }
        cacheStoreUrl = url
      }
    }
  })
  for (const name of Object.keys(repository.portBases)) {
    if (ports[name] === undefined) complain(`a value for port "${name}"`)
  }
  for (const database of repository.databases) {
    if (databaseUrls[database.name] === undefined) complain(database.envKey)
  }
  const allocation: LaneAllocation = { ports, databaseUrls }
  if (repository.cacheStoreIndex) {
    if (cacheStoreUrl === undefined) {
      complain(repository.cacheStoreEnvKeys[0] ?? 'the cache-store env key')
    } else {
      allocation.cacheStoreUrl = cacheStoreUrl
    }
  }
  return allocation
}

/**
 * Read one repository's slice back from its (single) env file. No marker means
 * no allocation (a fresh lane worktree). A marker with a missing key is a
 * hand-edit the implementation refuses to guess about.
 */
function parseLaneAllocation(
  contents: string,
  repository: ResolvedRepository,
): LaneAllocation | null {
  return parseLaneAllocationFromFiles([contents], repository)
}

/** Strip a trailing database index: redis://host:6379/2 -> redis://host:6379 */
function cacheStoreBaseUrl(url: string) {
  return url.replace(/\/[0-9]+$/, '')
}

function withCacheStoreIndex(url: string, index: number) {
  return `${cacheStoreBaseUrl(url)}/${index}`
}

function cacheStoreIndexFromUrl(url: string) {
  const match = url.match(/\/([0-9]+)$/)
  return match?.[1] === undefined ? null : Number(match[1])
}

/**
 * First free cache-store index (1..CACHE_STORE_INDEXES), starting from the
 * lane's hash and skipping indexes sibling lanes claimed. Index 0 — the main
 * checkout's default — is never handed out.
 */
function allocateCacheStoreIndex(slug: string, takenIndexes: Iterable<number>) {
  const taken = new Set<number>(takenIndexes)
  const start = 1 + (hashOffset(slug) % CACHE_STORE_INDEXES)
  for (let step = 0; step < CACHE_STORE_INDEXES; step += 1) {
    const candidate = 1 + ((start - 1 + step) % CACHE_STORE_INDEXES)
    if (!taken.has(candidate)) return candidate
  }
  return null
}

/**
 * Whether a cache-store URL may be flushed: only an explicitly indexed lane
 * database, never an index-less URL or database 0 — the main checkout's.
 */
function isFlushableCacheStoreUrl(url: string) {
  const index = cacheStoreIndexFromUrl(url)
  return index !== null && index > 0
}

/**
 * Why a lane must not be seeded — null means it must. Seeding belongs to
 * databases created in this same run: an existing database holds a
 * developer's data a second seed would collide with.
 */
function seedRefusal({
  databasesAreNew,
  seedRequested,
  hasSeedCommand,
}: {
  databasesAreNew: boolean
  seedRequested: boolean
  hasSeedCommand: boolean
}) {
  if (!databasesAreNew) return 'existing databases reused'
  if (!seedRequested) return 'seeding was skipped'
  if (!hasSeedCommand) return 'no seed command is declared'
  return null
}

/**
 * Compile a derived-name pattern against a lane database's name. Patterns
 * come from the resource table: `{base}` stands for the lane database name
 * and `*` matches any run of identifier characters. Matches are anchored, so
 * a sibling lane whose slug merely extends this one stays out of the blast
 * radius.
 */
function compileDerivedPattern(pattern: string, baseName: string) {
  const source = pattern
    .split('*')
    .map((part) =>
      part
        .split('{base}')
        .map((piece) => piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join(escapeRegExp(baseName)),
    )
    .join('[a-z0-9_]*')
  return new RegExp(`^${source}$`)
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The lane's whole derived-database family among the server's databases: the
 * lane databases themselves plus everything the declared derived-name
 * patterns match, so nothing derived is ever orphaned. Injection-unsafe names
 * never match.
 */
function laneDatabaseFamily(
  existingNames: Iterable<string>,
  laneDatabases: { baseName: string; derivedPatterns: string[] }[],
) {
  const matchers = laneDatabases.flatMap(({ baseName, derivedPatterns }) => [
    compileDerivedPattern('{base}', baseName),
    ...derivedPatterns.map((pattern) => compileDerivedPattern(pattern, baseName)),
  ])
  const family: string[] = []
  for (const name of existingNames) {
    if (!/^[a-z0-9_]+$/.test(name)) continue
    if (matchers.some((matcher) => matcher.test(name))) family.push(name)
  }
  return family
}

function fingerprintSources(sources: Iterable<[string, string]>) {
  const hash = createHash('sha256')
  const sorted = [...sources].sort(([left], [right]) => left.localeCompare(right))
  for (const [path, contents] of sorted) {
    hash.update(`${path}\0${contents.length}\0${contents}`)
  }
  return hash.digest('hex')
}

function todaysSeedDate(now = new Date(), timeZone?: string) {
  return new Intl.DateTimeFormat(
    'en-CA',
    timeZone === undefined ? {} : { timeZone },
  ).format(now)
}

function parseTemplateFingerprint(comment: string | null | undefined) {
  if (!comment) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(comment)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const candidate = parsed as Record<string, unknown>
  if (typeof candidate.migrationsHash !== 'string') return null
  const fingerprint: TemplateFingerprint = {
    migrationsHash: candidate.migrationsHash,
  }
  if (typeof candidate.seedHash === 'string') {
    fingerprint.seedHash = candidate.seedHash
  }
  if (typeof candidate.seedDate === 'string') {
    fingerprint.seedDate = candidate.seedDate
  }
  return fingerprint
}

function planTemplateUsage(
  stored: TemplateFingerprint | null,
  current: TemplateFingerprint,
  { freshSeed = false } = {},
) {
  if (!stored) {
    return { action: 'rebuild' as const, reason: 'no template database yet' }
  }
  if (stored.seedHash !== current.seedHash) {
    return {
      action: 'rebuild' as const,
      reason: 'the seed changed since the template was built',
    }
  }
  if (stored.migrationsHash !== current.migrationsHash) {
    return {
      action: 'migrate' as const,
      reason: 'the template predates the migrations on this branch',
    }
  }
  if (stored.seedDate !== current.seedDate) {
    return freshSeed
      ? {
          action: 'rebuild' as const,
          reason: `the template was seeded on ${stored.seedDate}`,
        }
      : {
          action: 'copy' as const,
          reason: `the template was seeded on ${stored.seedDate}`,
        }
  }
  return { action: 'copy' as const, reason: 'the template is up to date' }
}

function hasStaleSeedDate(
  stored: TemplateFingerprint | null,
  current: TemplateFingerprint,
) {
  return Boolean(stored?.seedDate) && stored?.seedDate !== current.seedDate
}

type LaneProcess = {
  processId: number
  lane: string
  workingDirectory: string
}

function laneProcessesFromLsofOutput(output: string, worktreesRoots: string[]) {
  const roots = worktreesRoots.map((root) => root.replace(/\/+$/, ''))
  const processes: LaneProcess[] = []
  let processId: number | undefined
  for (const line of output.split('\n')) {
    const field = line[0]
    const value = line.slice(1)
    if (field === 'p') processId = Number(value)
    if (field !== 'n' || !processId) continue
    const root = roots.find((candidate) => value.startsWith(`${candidate}/`))
    if (root === undefined) continue
    const lane = value.slice(root.length + 1).split('/')[0]
    if (lane === undefined || lane === '') continue
    processes.push({ processId, lane, workingDirectory: value })
  }
  return processes
}

const SESSION_END_REASONS_THAT_CLEAN_UP_PROCESSES = new Set([
  'prompt_input_exit',
  'logout',
])

function sessionEndCleansUpProcesses(reason: string | undefined) {
  return SESSION_END_REASONS_THAT_CLEAN_UP_PROCESSES.has(reason ?? '')
}

/** Env key holding the URL a declared shared service is probed through. */
function serviceEnvKey(serviceName: string) {
  return `${serviceName.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_URL`
}

const SERVICE_SCHEME_PORTS: Record<string, number> = {
  postgres: 5432,
  postgresql: 5432,
  redis: 6379,
  rediss: 6380,
  mysql: 3306,
  amqp: 5672,
}

/** The TCP port to probe for a service URL, or null when none can be told. */
function serviceProbePort(url: string) {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.port) return Number(parsed.port)
  const scheme = parsed.protocol.replace(/:$/, '')
  return SERVICE_SCHEME_PORTS[scheme] ?? null
}

export type {
  LaneAllocation,
  LaneProcess,
  PortPlan,
  ResolvedDatabase,
  ResolvedEnvFile,
  ResolvedProvisioning,
  ResolvedRepository,
  TemplateFingerprint,
}
export {
  allocateCacheStoreIndex,
  assignPortPlan,
  basePortPlan,
  buildingTemplateDatabaseName,
  busyPorts,
  CACHE_STORE_INDEXES,
  cacheStoreBaseUrl,
  cacheStoreIndexFromUrl,
  compileDerivedPattern,
  databaseNameFromUrl,
  defaultDatabaseEnvKey,
  defaultDatabasePrefix,
  ENV_MARKER,
  envKeyForPort,
  fingerprintSources,
  hashOffset,
  hasStaleSeedDate,
  isFlushableCacheStoreUrl,
  isLaneOwnedDatabaseName,
  laneDatabaseFamily,
  laneDatabaseName,
  laneEnvValues,
  laneEnvValuesForFile,
  laneProcessesFromLsofOutput,
  laneResourcePool,
  laneSlug,
  mergedLaneEnvValues,
  PORT_OFFSET_RANGE,
  parseLaneAllocation,
  parseLaneAllocationFromFiles,
  parseTemplateFingerprint,
  planTemplateUsage,
  portsClaimedByEnv,
  portsClaimedByEnvFile,
  portsHeldBy,
  readEnvValues,
  replaceSlugTokens,
  repointLocalhostUrls,
  reservedPortsFromEnvFiles,
  reservedPortsFromLaneEnvFiles,
  resolvePortPlan,
  resolveProvisioning,
  seedRefusal,
  serviceEnvKey,
  serviceProbePort,
  sessionEndCleansUpProcesses,
  templateDatabaseName,
  todaysSeedDate,
  upsertEnvValues,
  widestPortBlock,
  withCacheStoreIndex,
  withDatabaseName,
  worktreePathsFromPorcelain,
}
