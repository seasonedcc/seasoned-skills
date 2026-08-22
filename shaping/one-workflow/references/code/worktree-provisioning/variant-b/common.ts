import type { z } from 'zod'

const WORKTREE_DATABASE_PREFIX = 'app_wt_'
const WORKTREE_BUCKET_PREFIX = 'app-wt-'
const WORKTREES_DIRECTORY_NAME = 'app-worktrees'
const ENV_MARKER =
  '# --- managed by scripts/worktree (per-worktree isolation) ---'

const PORT_BASES = {
  port: 7100,
  hmrPort: 26700,
  maildevPort: 15100,
  maildevWebPort: 16100,
  testPort: 8100,
  testMaildevPort: 17100,
  testMaildevWebPort: 18100,
}

type PortPlan = Record<keyof typeof PORT_BASES, number>

// An E2E run is four stacks, not one: `tests/worker-stack.ts` serves the
// product on the lane's test PORT plus the Playwright worker index, and
// `playwright.config.ts` runs four workers. So `testPort` is the head of a
// four-port block the lane binds in full, while every other port in a plan
// carries a single listener. Planning has to hand out and reserve whole
// blocks — a neighbour parked one or two ports up is a collision that only
// shows up once both lanes run their suites at the same time.
const E2E_WORKER_COUNT = 4

function portsHeldBy(key: keyof PortPlan, port: number) {
  if (key !== 'testPort') return [port]
  return Array.from({ length: E2E_WORKER_COUNT }, (_, worker) => port + worker)
}

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

function bucketName(slug: string) {
  return `${WORKTREE_BUCKET_PREFIX}${slug.replace(/_/g, '-')}`
}

// A hundred slots keep the widest plan under the thousand ports that separate
// one base from the next, so an offset never reaches the following family.
const LANE_SLOTS = 100

// One offset moves a lane's whole plan away from the bases, and it moves in
// whole E2E blocks: two lanes then either land on the same ports, which
// assignment resolves, or a full block apart. Landing one to three ports
// apart — the overlap no bump could see — is not a case the hash can produce.
function hashOffset(slug: string) {
  let hash = 2166136261
  for (const character of slug) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (Math.abs(hash) % LANE_SLOTS) * E2E_WORKER_COUNT
}

function basePortPlan(slug: string) {
  const offset = hashOffset(slug)
  return Object.fromEntries(
    Object.entries(PORT_BASES).map(([key, base]) => [key, base + offset])
  ) as PortPlan
}

type EnvFileName = '.env' | '.env.test'

// Which entry of the plan each managed key names, per env file, mirroring what
// setup writes: `.env`'s PORT is the lane's dev server, `.env.test`'s PORT is
// the head of its E2E block. Reading a lane's ports back — to reserve them for
// a new lane, or to sweep them at teardown — needs that distinction, since the
// two files spell the same key.
const ENV_FILE_PORT_KEYS: Record<
  EnvFileName,
  Record<string, keyof PortPlan>
> = {
  '.env': {
    PORT: 'port',
    HMR_PORT: 'hmrPort',
    MAILDEV_PORT: 'maildevPort',
    MAILDEV_WEB_PORT: 'maildevWebPort',
  },
  '.env.test': {
    PORT: 'testPort',
    MAILDEV_PORT: 'testMaildevPort',
    MAILDEV_WEB_PORT: 'testMaildevWebPort',
  },
}

const ENV_FILE_NAMES = Object.keys(ENV_FILE_PORT_KEYS) as EnvFileName[]

function portsClaimedByEnvFile(
  envFile: EnvFileName,
  values: Record<string, string>
) {
  return Object.entries(ENV_FILE_PORT_KEYS[envFile]).flatMap(
    ([envKey, planKey]) => {
      const port = Number(values[envKey])
      if (!Number.isInteger(port) || port <= 0) return []
      return portsHeldBy(planKey, port)
    }
  )
}

function assignPortPlan(slug: string, reservedPorts: Iterable<number> = []) {
  const taken = new Set<number>(reservedPorts)
  const resolved = {} as PortPlan
  for (const [key, base] of Object.entries(basePortPlan(slug))) {
    const planKey = key as keyof PortPlan
    let port = base
    while (portsHeldBy(planKey, port).some((held) => taken.has(held))) {
      port += 1
    }
    for (const held of portsHeldBy(planKey, port)) taken.add(held)
    resolved[planKey] = port
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

function reservedPortsFromEnvFiles(
  envFiles: Iterable<{
    envFile: EnvFileName
    contents: string | null | undefined
  }>
) {
  const reserved = new Set<number>()
  for (const { envFile, contents } of envFiles) {
    if (!contents || !contents.includes(ENV_MARKER)) continue
    for (const port of portsClaimedByEnvFile(
      envFile,
      readEnvValues(contents)
    )) {
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
  for (const [key, port] of Object.entries(plan)) {
    for (const held of portsHeldBy(key as keyof PortPlan, port)) {
      if (!(await isPortFree(held))) busy.push(held)
    }
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

function missingEnvKeys(values: Record<string, string>, schemas: z.ZodType[]) {
  const missing = new Set<string>()
  for (const schema of schemas) {
    const result = schema.safeParse(values)
    if (result.success) continue
    for (const issue of result.error.issues) {
      const [key] = issue.path
      if (typeof key === 'string') missing.add(key)
    }
  }
  return [...missing].sort()
}

function repointLocalhostUrls(
  contents: string,
  fromPort: number,
  toPort: number
) {
  if (!Number.isInteger(fromPort) || fromPort === toPort) return contents
  const localhostPort = new RegExp(
    `(?<![\\w.])((?:localhost|127\\.0\\.0\\.1):)${fromPort}\\b`,
    'g'
  )
  return contents
    .split('\n')
    .map((line) => {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (!match) return line
      return `${match[1]}=${match[2].replace(localhostPort, (_, host) => `${host}${toPort}`)}`
    })
    .join('\n')
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

export {
  assignPortPlan,
  basePortPlan,
  bucketName,
  databaseNameFromUrl,
  databaseNames,
  E2E_WORKER_COUNT,
  ENV_FILE_NAMES,
  ENV_MARKER,
  hashOffset,
  isWorktreeDatabaseName,
  laneSlug,
  missingEnvKeys,
  PORT_BASES,
  portsClaimedByEnvFile,
  portsHeldBy,
  readEnvValues,
  repointLocalhostUrls,
  reservedPortsFromEnvFiles,
  resolvePortPlan,
  upsertEnvValues,
  withDatabaseName,
  worktreePathsFromPorcelain,
  WORKTREE_BUCKET_PREFIX,
  WORKTREE_DATABASE_PREFIX,
  WORKTREES_DIRECTORY_NAME,
}
export type { PortPlan }
