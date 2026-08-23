import { createHash } from 'node:crypto'

const WORKTREE_DATABASE_PREFIX = 'app_wt_'
const TEMPLATE_DATABASE_PREFIX = 'app_template_'
const WORKTREES_DIRECTORY_NAME = 'app-worktrees'
const APP_ENV_FILE = 'apps/web/.env'
const APP_TEST_ENV_FILE = 'apps/web/.env.test'
const ENV_MARKER =
  '# --- managed by scripts/worktree (per-worktree isolation) ---'

const PORT_BASES = {
  port: 4100,
  hmrPort: 24700,
  maildevPort: 11100,
  maildevWebPort: 12100,
  testPort: 5100,
  testMaildevPort: 13100,
  testMaildevWebPort: 14100,
}

type PortPlan = Record<keyof typeof PORT_BASES, number>

function laneSlug(lane: string) {
  return lane
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 28)
    .replace(/_+$/, '')
}

function databaseNames(slug: string) {
  return {
    development: `${WORKTREE_DATABASE_PREFIX}${slug}_development`,
    test: `${WORKTREE_DATABASE_PREFIX}${slug}_test`,
  }
}

function isWorktreeDatabaseName(name: string) {
  return name.startsWith(WORKTREE_DATABASE_PREFIX) && /^[a-z0-9_]+$/.test(name)
}

const TEMPLATE_DATABASE_NAMES = {
  development: `${TEMPLATE_DATABASE_PREFIX}development`,
  test: `${TEMPLATE_DATABASE_PREFIX}test`,
}

const BUILDING_DATABASE_NAMES = {
  development: `${TEMPLATE_DATABASE_PREFIX}building_development`,
  test: `${TEMPLATE_DATABASE_PREFIX}building_test`,
}

type TemplateKind = keyof typeof TEMPLATE_DATABASE_NAMES

type TemplateFingerprint = {
  migrationsHash: string
  seedHash?: string
  seedDate?: string
}

const SEED_TIMEZONE = 'America/Sao_Paulo'

function fingerprintSources(sources: Iterable<[string, string]>) {
  const hash = createHash('sha256')
  const sorted = [...sources].sort(([left], [right]) =>
    left.localeCompare(right)
  )
  for (const [path, contents] of sorted) {
    hash.update(`${path}\0${contents.length}\0${contents}`)
  }
  return hash.digest('hex')
}

function todaysSeedDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SEED_TIMEZONE }).format(
    now
  )
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
  { freshSeed = false } = {}
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
  current: TemplateFingerprint
) {
  return Boolean(stored?.seedDate) && stored?.seedDate !== current.seedDate
}

function hashOffset(slug: string, modulo = 400) {
  let hash = 2166136261
  for (const character of slug) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash) % modulo
}

function basePortPlan(slug: string) {
  const offset = hashOffset(slug)
  return Object.fromEntries(
    Object.entries(PORT_BASES).map(([key, base]) => [key, base + offset])
  ) as PortPlan
}

const MANAGED_PORT_ENV_KEYS = [
  'PORT',
  'HMR_PORT',
  'MAILDEV_PORT',
  'MAILDEV_WEB_PORT',
] as const

function managedPortsFromEnv(values: Record<string, string>) {
  return MANAGED_PORT_ENV_KEYS.map((key) => Number(values[key])).filter(
    (port) => Number.isInteger(port) && port > 0
  )
}

function assignPortPlan(slug: string, reservedPorts: Iterable<number> = []) {
  const taken = new Set<number>(reservedPorts)
  const resolved = {} as PortPlan
  for (const [key, base] of Object.entries(basePortPlan(slug))) {
    let port = base
    while (taken.has(port)) port += 1
    taken.add(port)
    resolved[key as keyof PortPlan] = port
  }
  return resolved
}

function worktreePathsFromPorcelain(listing: string, excludePath: string) {
  const paths: string[] = []
  for (const line of listing.split('\n')) {
    const match = line.match(/^worktree (.+)$/)
    if (!match || match[1] === excludePath) continue
    paths.push(match[1])
  }
  return paths
}

function worktreePathFromHookInput(
  input: Record<string, string | undefined>,
  worktreesRoot: string
) {
  if (input.worktree_path) return input.worktree_path
  const lane = input.worktree_id || input.name
  return lane ? `${worktreesRoot}/${lane}` : null
}

function reservedPortsFromEnvFiles(
  envFileContents: Iterable<string | null | undefined>
) {
  const reserved = new Set<number>()
  for (const contents of envFileContents) {
    if (!contents?.includes(ENV_MARKER)) continue
    for (const port of managedPortsFromEnv(readEnvValues(contents))) {
      reserved.add(port)
    }
  }
  return reserved
}

async function busyPorts(
  plan: PortPlan,
  isPortFree: (port: number) => boolean | Promise<boolean>
) {
  const busy: number[] = []
  for (const port of Object.values(plan)) {
    if (!(await isPortFree(port))) busy.push(port)
  }
  return busy
}

async function resolvePortPlan(
  slug: string,
  reservedPorts: Iterable<number>,
  isPortFree: (port: number) => boolean | Promise<boolean>
) {
  const reserved = new Set<number>(reservedPorts)
  let plan = assignPortPlan(slug, reserved)
  let busy = await busyPorts(plan, isPortFree)
  while (busy.length > 0) {
    for (const port of busy) reserved.add(port)
    plan = assignPortPlan(slug, reserved)
    busy = await busyPorts(plan, isPortFree)
  }
  return plan
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
    if (match) values[match[1]] = match[2]
  }
  return values
}

function upsertEnvValues(contents: string, values: Record<string, string>) {
  const managedKeys = new Set(Object.keys(values))
  const keptLines = contents.split('\n').filter((line) => {
    if (line.trim() === ENV_MARKER) return false
    const match = line.match(/^([A-Z0-9_]+)=/)
    return !(match && managedKeys.has(match[1]))
  })
  while (keptLines.at(-1) === '') keptLines.pop()
  const managedLines = Object.entries(values).map(
    ([key, value]) => `${key}=${value}`
  )
  return [...keptLines, '', ENV_MARKER, ...managedLines, ''].join('\n')
}

type LaneProcess = {
  processId: number
  lane: string
  workingDirectory: string
}

function laneProcessesFromLsofOutput(output: string, worktreesRoot: string) {
  const root = worktreesRoot.replace(/\/+$/, '')
  const processes: LaneProcess[] = []
  let processId: number | undefined
  for (const line of output.split('\n')) {
    const field = line[0]
    const value = line.slice(1)
    if (field === 'p') processId = Number(value)
    if (field === 'n' && processId && value.startsWith(`${root}/`)) {
      const lane = value.slice(root.length + 1).split('/')[0]
      processes.push({ processId, lane, workingDirectory: value })
    }
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

export type { PortPlan, TemplateFingerprint, TemplateKind }
export {
  APP_ENV_FILE,
  APP_TEST_ENV_FILE,
  assignPortPlan,
  BUILDING_DATABASE_NAMES,
  basePortPlan,
  databaseNameFromUrl,
  databaseNames,
  ENV_MARKER,
  fingerprintSources,
  hashOffset,
  hasStaleSeedDate,
  isWorktreeDatabaseName,
  laneProcessesFromLsofOutput,
  laneSlug,
  managedPortsFromEnv,
  PORT_BASES,
  parseTemplateFingerprint,
  planTemplateUsage,
  readEnvValues,
  reservedPortsFromEnvFiles,
  resolvePortPlan,
  sessionEndCleansUpProcesses,
  TEMPLATE_DATABASE_NAMES,
  TEMPLATE_DATABASE_PREFIX,
  todaysSeedDate,
  upsertEnvValues,
  WORKTREE_DATABASE_PREFIX,
  WORKTREES_DIRECTORY_NAME,
  withDatabaseName,
  worktreePathFromHookInput,
  worktreePathsFromPorcelain,
}
