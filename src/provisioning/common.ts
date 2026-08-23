import { createHash } from 'node:crypto'
import type {
  DatabaseResource,
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

type ResolvedProvisioning = {
  databases: ResolvedDatabase[]
  portBases: Record<string, number>
  portBlocks: Record<string, number>
  services: string[]
  /** At least one entry; the first is the primary repository. */
  repositories: RepositoryResource[]
  templateCaching: boolean
  cacheStoreIndex: boolean
  cacheStoreEnvKeys: string[]
  databasePrefix: string
  envFile: string
  migrationSources: string[]
  seedSources: string[]
  seedDateTimezone: string | undefined
  serviceStartCommand: string
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
  const databasePrefix = provisioning.databasePrefix ?? defaults.databasePrefix
  if (!/^[a-z][a-z0-9_]*_$/.test(databasePrefix)) {
    throw new Error(
      `databasePrefix "${databasePrefix}" must be lowercase alphanumeric/underscore and end with an underscore`,
    )
  }
  const databases = (provisioning.databases ?? []).map(resolveDatabase)
  const seen = new Set<string>()
  for (const database of databases) {
    if (seen.has(database.name)) {
      throw new Error(`database resource "${database.name}" is declared twice`)
    }
    seen.add(database.name)
  }
  const portBases = provisioning.portBases ?? {}
  const portBlocks = provisioning.portBlocks ?? {}
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
  const repositories = provisioning.repositories?.length
    ? provisioning.repositories
    : [{ path: '.' }]
  const templateCaching = provisioning.templateCaching ?? false
  const migrationSources = provisioning.migrationSources ?? []
  if (templateCaching && migrationSources.length === 0) {
    throw new Error('templateCaching requires migrationSources to fingerprint')
  }
  const primary = repositories[0]
  if (databases.length > 0 && primary && !primary.migrateCommand) {
    throw new Error(
      'the primary repository must declare migrateCommand when the lane owns databases',
    )
  }
  return {
    databases,
    portBases,
    portBlocks,
    services: provisioning.services ?? [],
    repositories,
    templateCaching,
    cacheStoreIndex: provisioning.cacheStoreIndex ?? false,
    cacheStoreEnvKeys: provisioning.cacheStoreEnvKeys ?? DEFAULT_CACHE_STORE_ENV_KEYS,
    databasePrefix,
    envFile: provisioning.envFile ?? DEFAULT_ENV_FILE,
    migrationSources,
    seedSources: provisioning.seedSources ?? [],
    seedDateTimezone: provisioning.seedDateTimezone,
    serviceStartCommand:
      provisioning.serviceStartCommand ?? DEFAULT_SERVICE_START_COMMAND,
    laneProcessCommands:
      provisioning.laneProcessCommands ?? DEFAULT_LANE_PROCESS_COMMANDS,
  }
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
 * The values the managed block records — the lane's whole allocation. The
 * block is what makes re-runs idempotent: parse it back and the lane keeps
 * its ports, databases, and cache-store index.
 */
function laneEnvValues(allocation: LaneAllocation, resolved: ResolvedProvisioning) {
  const values: Record<string, string> = {}
  for (const database of resolved.databases) {
    const url = allocation.databaseUrls[database.name]
    if (url === undefined) {
      throw new Error(`allocation carries no URL for database "${database.name}"`)
    }
    values[database.envKey] = url
  }
  for (const name of Object.keys(resolved.portBases)) {
    const port = allocation.ports[name]
    if (port === undefined) {
      throw new Error(`allocation carries no port for "${name}"`)
    }
    values[envKeyForPort(name)] = String(port)
  }
  if (resolved.cacheStoreIndex) {
    if (allocation.cacheStoreUrl === undefined) {
      throw new Error('allocation carries no cache-store URL')
    }
    for (const key of resolved.cacheStoreEnvKeys) {
      values[key] = allocation.cacheStoreUrl
    }
  }
  return values
}

/**
 * Read a lane's allocation back from its env file. No marker means no
 * allocation (a fresh lane). A marker with a missing key is a hand-edit the
 * implementation refuses to guess about.
 */
function parseLaneAllocation(
  contents: string,
  resolved: ResolvedProvisioning,
): LaneAllocation | null {
  if (!contents.includes(ENV_MARKER)) return null
  const values = readEnvValues(contents)
  const complain = (what: string): never => {
    throw new Error(
      `the managed env block is present but ${what} is missing; fix or delete the block and re-run`,
    )
  }
  const ports: PortPlan = {}
  for (const name of Object.keys(resolved.portBases)) {
    const port = Number(values[envKeyForPort(name)])
    if (!Number.isInteger(port) || port <= 0) complain(envKeyForPort(name))
    ports[name] = port
  }
  const databaseUrls: Record<string, string> = {}
  for (const database of resolved.databases) {
    const url = values[database.envKey]
    if (!url) complain(database.envKey)
    else databaseUrls[database.name] = url
  }
  const allocation: LaneAllocation = { ports, databaseUrls }
  if (resolved.cacheStoreIndex) {
    const key = resolved.cacheStoreEnvKeys[0]
    const url = key === undefined ? undefined : values[key]
    if (!url) complain(key ?? 'the cache-store env key')
    else allocation.cacheStoreUrl = url
  }
  return allocation
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
  ResolvedProvisioning,
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
  laneProcessesFromLsofOutput,
  laneSlug,
  PORT_OFFSET_RANGE,
  parseLaneAllocation,
  parseTemplateFingerprint,
  planTemplateUsage,
  portsClaimedByEnv,
  portsHeldBy,
  readEnvValues,
  repointLocalhostUrls,
  reservedPortsFromEnvFiles,
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
