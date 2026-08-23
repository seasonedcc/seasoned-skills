import { describe, expect, it } from 'vitest'
import {
  allocateCacheStoreIndex,
  assignPortPlan,
  basePortPlan,
  buildingTemplateDatabaseName,
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
  type LaneAllocation,
  laneDatabaseFamily,
  laneDatabaseName,
  laneEnvValues,
  laneEnvValuesForFile,
  laneProcessesFromLsofOutput,
  laneSlug,
  type PortPlan,
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
  withCacheStoreIndex,
  withDatabaseName,
  worktreePathsFromPorcelain,
} from './common.js'

const PORT_BASES = {
  port: 4100,
  hmrPort: 24700,
  maildevPort: 11100,
  maildevWebPort: 12100,
  testPort: 5100,
  testMaildevPort: 13100,
  testMaildevWebPort: 14100,
}

/** The test server heads a four-port block, one per E2E worker. */
const E2E_WORKER_COUNT = 4
const PORT_BLOCKS = { testPort: E2E_WORKER_COUNT }

const manyLaneSlugs = Array.from({ length: 500 }, (_, index) => laneSlug(`lane-${index}`))

const heldPorts = (plan: PortPlan) =>
  Object.entries(plan).flatMap(([name, port]) => portsHeldBy(name, port, PORT_BLOCKS))

const laneEnv = (port: number, { marked = true } = {}) =>
  [
    'SESSION_SECRET=s',
    ...(marked ? [ENV_MARKER] : []),
    `PORT=${port}`,
    `HMR_PORT=${port + 100}`,
    `MAILDEV_PORT=${port + 200}`,
    `MAILDEV_WEB_PORT=${port + 300}`,
    `TEST_PORT=${port + 1000}`,
    `TEST_MAILDEV_PORT=${port + 1200}`,
    `TEST_MAILDEV_WEB_PORT=${port + 1300}`,
  ].join('\n')

describe('laneSlug', () => {
  it('lowercases and replaces separators with underscores', () => {
    expect(laneSlug('Fix Login/Flow')).toBe('fix_login_flow')
  })

  it('trims leading and trailing separators', () => {
    expect(laneSlug('--task-a--')).toBe('task_a')
  })

  it('caps the length without leaving a trailing underscore', () => {
    expect(laneSlug('a'.repeat(40))).toHaveLength(28)
    expect(laneSlug(`${'a'.repeat(27)}-b`).endsWith('_')).toBe(false)
  })

  it('never produces consecutive underscores, which template names rely on', () => {
    expect(laneSlug('a--b__c  d')).toBe('a_b_c_d')
  })
})

describe('defaultDatabasePrefix', () => {
  it('derives a prefix from the project directory name', () => {
    expect(defaultDatabasePrefix('My-App')).toBe('my_app_wt_')
  })

  it('fails loud on a name with nothing usable in it', () => {
    expect(() => defaultDatabasePrefix('---')).toThrow(/databasePrefix/)
  })
})

describe('laneDatabaseName', () => {
  it('derives guarded lane database names', () => {
    expect(laneDatabaseName('app_wt_', 'task_a', 'development')).toBe(
      'app_wt_task_a_development',
    )
    expect(laneDatabaseName('app_wt_', 'task_a', 'test')).toBe('app_wt_task_a_test')
  })

  it('stays within the Postgres identifier limit for the longest slug', () => {
    const name = laneDatabaseName('app_wt_', laneSlug('x'.repeat(80)), 'development')
    expect(name.length).toBeLessThanOrEqual(63)
  })

  it('refuses a name past the identifier limit instead of truncating it', () => {
    expect(() =>
      laneDatabaseName(
        'a_very_long_project_prefix_wt_',
        laneSlug('x'.repeat(80)),
        'development',
      ),
    ).toThrow(/63/)
  })
})

describe('isLaneOwnedDatabaseName', () => {
  it('accepts per-lane database names', () => {
    expect(isLaneOwnedDatabaseName('app_wt_', 'app_wt_task_a_development')).toBe(true)
  })

  it('rejects the main databases and injection attempts', () => {
    expect(isLaneOwnedDatabaseName('app_wt_', 'app_development')).toBe(false)
    expect(isLaneOwnedDatabaseName('app_wt_', 'app_test')).toBe(false)
    expect(isLaneOwnedDatabaseName('app_wt_', 'app_wt_a"; drop table users')).toBe(false)
  })
})

describe('template database names', () => {
  it('derives template and building names from the prefix', () => {
    expect(templateDatabaseName('app_wt_', 'development')).toBe(
      'app_wt_template__development',
    )
    expect(buildingTemplateDatabaseName('app_wt_', 'development')).toBe(
      'app_wt_template_building__development',
    )
  })

  it('can never collide with a lane database, even for a lane named template', () => {
    for (const lane of ['template', 'template building', 'template-building']) {
      for (const resource of ['development', 'test', 'building_development']) {
        const laneName = laneDatabaseName('app_wt_', laneSlug(lane), resource)
        expect(laneName).not.toBe(templateDatabaseName('app_wt_', resource))
        expect(laneName).not.toBe(buildingTemplateDatabaseName('app_wt_', resource))
      }
    }
  })
})

describe('env key derivation', () => {
  it('maps camelCase port names to screaming snake case', () => {
    expect(envKeyForPort('port')).toBe('PORT')
    expect(envKeyForPort('hmrPort')).toBe('HMR_PORT')
    expect(envKeyForPort('maildevWebPort')).toBe('MAILDEV_WEB_PORT')
    expect(envKeyForPort('testPort')).toBe('TEST_PORT')
  })

  it('derives database env keys from the resource name', () => {
    expect(defaultDatabaseEnvKey('development')).toBe('DEVELOPMENT_DATABASE_URL')
    expect(defaultDatabaseEnvKey('message')).toBe('MESSAGE_DATABASE_URL')
  })
})

describe('hashOffset', () => {
  it('is deterministic and within range', () => {
    for (const slug of ['task_a', 'task_b', 'another_lane', 'x']) {
      const offset = hashOffset(slug)
      expect(offset).toBe(hashOffset(slug))
      expect(offset).toBeGreaterThanOrEqual(0)
      expect(offset).toBeLessThan(400)
    }
  })

  it('steps in whole blocks, so no two lanes land mid-block', () => {
    for (const slug of manyLaneSlugs) {
      expect(hashOffset(slug, E2E_WORKER_COUNT) % E2E_WORKER_COUNT).toBe(0)
      expect(hashOffset(slug, E2E_WORKER_COUNT)).toBeLessThan(400)
    }
  })
})

describe('portsHeldBy', () => {
  it('holds one port for a single listener', () => {
    expect(portsHeldBy('port', 4120, PORT_BLOCKS)).toEqual([4120])
    expect(portsHeldBy('maildevWebPort', 12120, PORT_BLOCKS)).toEqual([12120])
  })

  it('holds a port per worker for a blocked port', () => {
    expect(portsHeldBy('testPort', 5120, PORT_BLOCKS)).toEqual([5120, 5121, 5122, 5123])
  })
})

describe('basePortPlan', () => {
  it('derives distinct ports deterministically', () => {
    const plan = basePortPlan('task_a', PORT_BASES)
    expect(basePortPlan('task_a', PORT_BASES)).toEqual(plan)
    expect(new Set(Object.values(plan)).size).toBe(Object.keys(PORT_BASES).length)
  })

  it('offsets every port from its base by the same amount', () => {
    const plan = basePortPlan('task_a', PORT_BASES)
    const offset = hashOffset('task_a')
    for (const [key, base] of Object.entries(PORT_BASES)) {
      expect(plan[key]).toBe(base + offset)
    }
  })

  it('never puts two lanes one to three ports apart on a blocked port', () => {
    const testPorts = [
      ...new Set(
        manyLaneSlugs.map((slug) => {
          const port = basePortPlan(slug, PORT_BASES, PORT_BLOCKS).testPort
          expect(port).toBeDefined()
          return port as number
        }),
      ),
    ].sort((first, second) => first - second)
    const gaps = testPorts
      .slice(1)
      .map((port, index) => port - (testPorts[index] as number))

    expect(testPorts.length).toBeGreaterThan(1)
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(E2E_WORKER_COUNT)
  })

  it('keeps every port a lane holds inside its own base family', () => {
    const bases = Object.values(PORT_BASES).sort((first, second) => first - second)
    const closestFamily = Math.min(
      ...bases.slice(1).map((base, index) => base - (bases[index] as number)),
    )

    for (const slug of manyLaneSlugs) {
      for (const [key, port] of Object.entries(
        basePortPlan(slug, PORT_BASES, PORT_BLOCKS),
      )) {
        const highest = Math.max(...portsHeldBy(key, port, PORT_BLOCKS))
        expect(highest - PORT_BASES[key as keyof typeof PORT_BASES]).toBeLessThan(
          closestFamily,
        )
      }
    }
  })
})

describe('assignPortPlan', () => {
  it('matches the base plan when nothing is reserved', () => {
    expect(assignPortPlan('task_a', PORT_BASES, PORT_BLOCKS)).toEqual(
      basePortPlan('task_a', PORT_BASES, PORT_BLOCKS),
    )
  })

  it('avoids every port a colliding lane already holds', () => {
    // main_bank and equipment_e4 hash to the same base ports (a real collision).
    expect(hashOffset('main_bank')).toBe(hashOffset('equipment_e4'))
    expect(basePortPlan('main_bank', PORT_BASES, PORT_BLOCKS)).toEqual(
      basePortPlan('equipment_e4', PORT_BASES, PORT_BLOCKS),
    )

    const first = assignPortPlan('main_bank', PORT_BASES, PORT_BLOCKS)
    const second = assignPortPlan(
      'equipment_e4',
      PORT_BASES,
      PORT_BLOCKS,
      heldPorts(first),
    )

    const firstPorts = new Set(heldPorts(first))
    for (const port of heldPorts(second)) {
      expect(firstPorts.has(port)).toBe(false)
    }
    expect(new Set(Object.values(second)).size).toBe(Object.values(second).length)
    expect(second.testPort).toBe((first.testPort as number) + E2E_WORKER_COUNT)
  })

  it('moves the whole block clear of a port reserved inside it', () => {
    const base = basePortPlan('task_a', PORT_BASES, PORT_BLOCKS)

    const plan = assignPortPlan('task_a', PORT_BASES, PORT_BLOCKS, [
      (base.testPort as number) + 2,
    ])

    expect(portsHeldBy('testPort', plan.testPort as number, PORT_BLOCKS)).not.toContain(
      (base.testPort as number) + 2,
    )
    expect(plan.testPort).toBe((base.testPort as number) + 3)
  })

  it('steps a single-listener port past a reserved port one at a time', () => {
    const base = basePortPlan('task_a', PORT_BASES, PORT_BLOCKS)

    expect(
      assignPortPlan('task_a', PORT_BASES, PORT_BLOCKS, [base.port as number]).port,
    ).toBe((base.port as number) + 1)
    expect(
      assignPortPlan('task_a', PORT_BASES, PORT_BLOCKS, [base.maildevPort as number])
        .maildevPort,
    ).toBe((base.maildevPort as number) + 1)
  })

  it("keeps a lane out of a sibling worktree's block", () => {
    const base = basePortPlan('task_a', PORT_BASES, PORT_BLOCKS)
    const sibling = reservedPortsFromEnvFiles(
      [[ENV_MARKER, `TEST_PORT=${(base.testPort as number) + 1}`].join('\n')],
      PORT_BASES,
      PORT_BLOCKS,
    )

    const plan = assignPortPlan('task_a', PORT_BASES, PORT_BLOCKS, sibling)

    for (const port of heldPorts(plan)) expect(sibling.has(port)).toBe(false)
    expect(plan.testPort).toBe((base.testPort as number) + 1 + E2E_WORKER_COUNT)
  })
})

describe('worktreePathsFromPorcelain', () => {
  const listing = [
    'worktree /repos/app',
    'HEAD aaaa',
    'branch refs/heads/main',
    '',
    'worktree /repos/app-worktrees/task-a',
    'HEAD bbbb',
    'branch refs/heads/worktree/task-a',
    '',
    'worktree /repos/app-worktrees/task-b',
    'HEAD cccc',
    'branch refs/heads/worktree/task-b',
    '',
  ].join('\n')

  it('lists every worktree except the current one', () => {
    expect(worktreePathsFromPorcelain(listing, '/repos/app-worktrees/task-a')).toEqual([
      '/repos/app',
      '/repos/app-worktrees/task-b',
    ])
  })
})

describe('reservedPortsFromEnvFiles', () => {
  it('reserves managed ports across every marked env file, blocks included', () => {
    const reserved = reservedPortsFromEnvFiles(
      [laneEnv(4101), laneEnv(4202)],
      PORT_BASES,
      PORT_BLOCKS,
    )

    expect(reserved.has(4101)).toBe(true)
    expect(reserved.has(4201)).toBe(true)
    expect(reserved.has(4202)).toBe(true)
    expect(reserved.has(4302)).toBe(true)
    expect(reserved.has(5101)).toBe(true)
    expect(reserved.has(5104)).toBe(true)
    expect(reserved.has(5105)).toBe(false)
    expect(reserved.has(5301)).toBe(true)
    expect(reserved.size).toBe(20)
  })

  it("reserves the whole block behind a sibling lane's test port", () => {
    const reserved = reservedPortsFromEnvFiles(
      [[ENV_MARKER, 'TEST_PORT=5420'].join('\n')],
      PORT_BASES,
      PORT_BLOCKS,
    )

    expect([...reserved].sort((first, second) => first - second)).toEqual([
      5420, 5421, 5422, 5423,
    ])
  })

  it('reserves only the port itself for a single-listener port', () => {
    const reserved = reservedPortsFromEnvFiles(
      [[ENV_MARKER, 'PORT=4420', 'MAILDEV_PORT=11420'].join('\n')],
      PORT_BASES,
      PORT_BLOCKS,
    )

    expect([...reserved].sort((first, second) => first - second)).toEqual([4420, 11420])
  })

  it('ignores missing and unmarked env files', () => {
    const reserved = reservedPortsFromEnvFiles(
      [null, undefined, 'PORT=6101\nMAILDEV_PORT=6301', laneEnv(4101)],
      PORT_BASES,
      PORT_BLOCKS,
    )

    expect([...reserved].sort((first, second) => first - second)).toEqual([
      4101, 4201, 4301, 4401, 5101, 5102, 5103, 5104, 5301, 5401,
    ])
  })
})

describe('resolvePortPlan', () => {
  it('keeps the base plan when no ports are reserved or busy', async () => {
    const plan = await resolvePortPlan('task_a', PORT_BASES, PORT_BLOCKS, [], () => true)
    expect(plan).toEqual(basePortPlan('task_a', PORT_BASES, PORT_BLOCKS))
  })

  it('reassigns around a fixed set of busy ports until it converges', async () => {
    const base = basePortPlan('task_a', PORT_BASES, PORT_BLOCKS)
    const busy = new Set([base.port as number, (base.port as number) + 1])

    const plan = await resolvePortPlan(
      'task_a',
      PORT_BASES,
      PORT_BLOCKS,
      [],
      (port) => !busy.has(port),
    )

    for (const port of heldPorts(plan)) {
      expect(busy.has(port)).toBe(false)
    }
    expect(plan.port).toBe((base.port as number) + 2)
  })

  it('moves the block off a busy port only a worker would bind', async () => {
    const base = basePortPlan('task_a', PORT_BASES, PORT_BLOCKS)
    const busy = new Set([(base.testPort as number) + 3])

    const plan = await resolvePortPlan(
      'task_a',
      PORT_BASES,
      PORT_BLOCKS,
      [],
      (port) => !busy.has(port),
    )

    for (const port of heldPorts(plan)) expect(busy.has(port)).toBe(false)
    expect(plan.testPort).toBe((base.testPort as number) + E2E_WORKER_COUNT)
  })
})

describe('portsClaimedByEnv', () => {
  it('claims one port per managed single-listener key', () => {
    expect(
      portsClaimedByEnv(
        {
          PORT: '4427',
          HMR_PORT: '25027',
          MAILDEV_PORT: '11427',
          MAILDEV_WEB_PORT: '12427',
          SESSION_SECRET: 'secret',
        },
        PORT_BASES,
        PORT_BLOCKS,
      ).sort((first, second) => first - second),
    ).toEqual([4427, 11427, 12427, 25027])
  })

  it('claims a whole block for a blocked port', () => {
    expect(portsClaimedByEnv({ TEST_PORT: '5427' }, PORT_BASES, PORT_BLOCKS)).toEqual([
      5427, 5428, 5429, 5430,
    ])
  })

  it('ignores keys the env does not carry and nonsense values', () => {
    expect(portsClaimedByEnv({ PORT: '4427' }, PORT_BASES, PORT_BLOCKS)).toEqual([4427])
    expect(portsClaimedByEnv({ PORT: 'nonsense' }, PORT_BASES, PORT_BLOCKS)).toEqual([])
    expect(portsClaimedByEnv({ OTHER: '9000' }, PORT_BASES, PORT_BLOCKS)).toEqual([])
  })
})

describe('withDatabaseName', () => {
  it('replaces the database while preserving credentials and query', () => {
    expect(
      withDatabaseName(
        'postgresql://dev@localhost:5432/app_development?sslmode=disable',
        'app_wt_task_a_development',
      ),
    ).toBe('postgresql://dev@localhost:5432/app_wt_task_a_development?sslmode=disable')
  })

  it('handles urls without a user', () => {
    expect(
      withDatabaseName(
        'postgresql://localhost:5432/app_test?sslmode=disable',
        'app_wt_task_a_test',
      ),
    ).toBe('postgresql://localhost:5432/app_wt_task_a_test?sslmode=disable')
  })
})

describe('databaseNameFromUrl', () => {
  it('extracts the database name', () => {
    expect(
      databaseNameFromUrl('postgresql://localhost:5432/app_test?sslmode=disable'),
    ).toBe('app_test')
  })
})

describe('readEnvValues', () => {
  it('parses key-value lines and ignores comments', () => {
    expect(readEnvValues('FOO=bar\n# comment\nBAZ=qux=quux\n')).toEqual({
      FOO: 'bar',
      BAZ: 'qux=quux',
    })
  })
})

describe('upsertEnvValues', () => {
  const original = 'DATABASE_URL=postgres://localhost/app\nSESSION_SECRET=s3\n'

  it('replaces managed keys and appends a marker block', () => {
    const result = upsertEnvValues(original, {
      DATABASE_URL: 'postgres://localhost/app_wt_a_development',
      PORT: '4123',
    })
    expect(result).toContain(ENV_MARKER)
    expect(result).toContain('SESSION_SECRET=s3')
    expect(result).toContain('DATABASE_URL=postgres://localhost/app_wt_a_development')
    expect(result).toContain('PORT=4123')
    expect(result).not.toContain('DATABASE_URL=postgres://localhost/app\n')
  })

  it('is idempotent when re-applied with new values', () => {
    const values = { DATABASE_URL: 'postgres://localhost/x', PORT: '4123' }
    const once = upsertEnvValues(original, values)
    const twice = upsertEnvValues(once, values)
    expect(twice).toBe(once)
    expect(twice.split(ENV_MARKER)).toHaveLength(2)
  })
})

describe('repointLocalhostUrls', () => {
  it('repoints the main app port inside localhost URLs to the lane port', () => {
    const contents = [
      'SESSION_SECRET=s',
      'AUTHORIZE_URL=http://localhost:4002/oauth?redirect=http://localhost:4002/done',
      'PORT=4123',
    ].join('\n')

    expect(repointLocalhostUrls(contents, 4002, 4123)).toBe(
      [
        'SESSION_SECRET=s',
        'AUTHORIZE_URL=http://localhost:4123/oauth?redirect=http://localhost:4123/done',
        'PORT=4123',
      ].join('\n'),
    )
  })

  it('repoints 127.0.0.1 URLs as well', () => {
    expect(repointLocalhostUrls('CALLBACK=http://127.0.0.1:8002/done', 8002, 8321)).toBe(
      'CALLBACK=http://127.0.0.1:8321/done',
    )
  })

  it('leaves production hosts, other ports, and longer ports untouched', () => {
    const contents = [
      'PRODUCTION_URL=https://app.example.com:4002/callback',
      'SUBSTRING_HOST=http://mylocalhost:4002/x',
      'LONGER_PORT=http://localhost:40020/x',
      'OTHER_PORT=http://localhost:24700/socket',
    ].join('\n')

    expect(repointLocalhostUrls(contents, 4002, 4123)).toBe(contents)
  })

  it('returns the contents unchanged when the port is unset or already correct', () => {
    const contents = 'CALLBACK=http://localhost:4002/x'

    expect(repointLocalhostUrls(contents, 4002, 4002)).toBe(contents)
    expect(repointLocalhostUrls(contents, Number.NaN, 4123)).toBe(contents)
  })
})

const resolvedFixture = resolveProvisioning(
  {
    databases: [
      {
        name: 'development',
        envKey: 'DATABASE_URL',
        seeded: true,
        derivedPatterns: ['{base}_w*', '{base}_unit*'],
      },
      { name: 'test', derivedPatterns: ['test_{base}', '{base}_gw*'] },
    ],
    portBases: PORT_BASES,
    portBlocks: PORT_BLOCKS,
    cacheStoreIndex: true,
    repositories: [{ path: '.', migrateCommand: 'pnpm run db:migrate' }],
  },
  { databasePrefix: 'app_wt_' },
)

const allocationFixture: LaneAllocation = {
  ports: {
    port: 4187,
    hmrPort: 24787,
    maildevPort: 11187,
    maildevWebPort: 12187,
    testPort: 5187,
    testMaildevPort: 13187,
    testMaildevWebPort: 14187,
  },
  databaseUrls: {
    development: 'postgresql://localhost:5432/app_wt_task_a_development',
    test: 'postgresql://localhost:5432/app_wt_task_a_test',
  },
  cacheStoreUrl: 'redis://localhost:6379/3',
}

describe('laneEnvValues', () => {
  it('records the whole allocation under the configured keys', () => {
    expect(laneEnvValues(allocationFixture, resolvedFixture)).toEqual({
      DATABASE_URL: 'postgresql://localhost:5432/app_wt_task_a_development',
      TEST_DATABASE_URL: 'postgresql://localhost:5432/app_wt_task_a_test',
      PORT: '4187',
      HMR_PORT: '24787',
      MAILDEV_PORT: '11187',
      MAILDEV_WEB_PORT: '12187',
      TEST_PORT: '5187',
      TEST_MAILDEV_PORT: '13187',
      TEST_MAILDEV_WEB_PORT: '14187',
      REDIS_URL: 'redis://localhost:6379/3',
    })
  })

  it('writes the cache-store URL under every configured key', () => {
    const resolved = resolveProvisioning(
      {
        cacheStoreIndex: true,
        cacheStoreEnvKeys: ['REDIS_URL', 'CELERY_URL'],
      },
      { databasePrefix: 'app_wt_' },
    )
    const values = laneEnvValues(
      { ports: {}, databaseUrls: {}, cacheStoreUrl: 'redis://localhost:6379/5' },
      resolved,
    )
    expect(values).toEqual({
      REDIS_URL: 'redis://localhost:6379/5',
      CELERY_URL: 'redis://localhost:6379/5',
    })
  })

  it('refuses an allocation missing a declared resource', () => {
    expect(() => laneEnvValues({ ports: {}, databaseUrls: {} }, resolvedFixture)).toThrow(
      /no URL for database/,
    )
  })
})

describe('parseLaneAllocation', () => {
  const contents = upsertEnvValues(
    'SESSION_SECRET=s\n',
    laneEnvValues(allocationFixture, resolvedFixture),
  )

  it('round-trips the allocation through the managed block', () => {
    expect(parseLaneAllocation(contents, resolvedFixture)).toEqual(allocationFixture)
  })

  it('treats a file without the marker as unallocated', () => {
    expect(parseLaneAllocation('PORT=4187\n', resolvedFixture)).toBeNull()
    expect(parseLaneAllocation('', resolvedFixture)).toBeNull()
  })

  it('refuses a marker with a managed key missing', () => {
    const broken = contents
      .split('\n')
      .filter((line) => !line.startsWith('REDIS_URL='))
      .join('\n')
    expect(() => parseLaneAllocation(broken, resolvedFixture)).toThrow(/REDIS_URL/)
  })

  it('is the idempotency sentinel: a re-run parses back the same allocation', () => {
    const rewritten = upsertEnvValues(
      contents,
      laneEnvValues(allocationFixture, resolvedFixture),
    )
    expect(rewritten).toBe(contents)
    expect(parseLaneAllocation(rewritten, resolvedFixture)).toEqual(allocationFixture)
  })
})

describe('cache-store index', () => {
  it('strips and appends indexes on the base URL', () => {
    expect(cacheStoreBaseUrl('redis://localhost:6379/2')).toBe('redis://localhost:6379')
    expect(cacheStoreBaseUrl('redis://localhost:6379')).toBe('redis://localhost:6379')
    expect(withCacheStoreIndex('redis://localhost:6379/2', 5)).toBe(
      'redis://localhost:6379/5',
    )
    expect(withCacheStoreIndex('redis://localhost:6379', 5)).toBe(
      'redis://localhost:6379/5',
    )
  })

  it('reads an index back from a URL', () => {
    expect(cacheStoreIndexFromUrl('redis://localhost:6379/7')).toBe(7)
    expect(cacheStoreIndexFromUrl('redis://localhost:6379')).toBeNull()
  })

  it('allocates deterministically within 1..14', () => {
    const index = allocateCacheStoreIndex('task_a', [])
    expect(index).toBe(allocateCacheStoreIndex('task_a', []))
    expect(index).toBeGreaterThanOrEqual(1)
    expect(index).toBeLessThanOrEqual(14)
  })

  it('skips indexes sibling lanes claimed, wrapping around', () => {
    const preferred = allocateCacheStoreIndex('task_a', []) as number
    const next = allocateCacheStoreIndex('task_a', [preferred])
    expect(next).not.toBe(preferred)
    expect(next).toBeGreaterThanOrEqual(1)
    expect(next).toBeLessThanOrEqual(14)

    const allButOne = Array.from({ length: 14 }, (_, index) => index + 1).filter(
      (candidate) => candidate !== 14,
    )
    expect(allocateCacheStoreIndex('task_a', allButOne)).toBe(14)
  })

  it('returns null when every index is taken', () => {
    const all = Array.from({ length: 14 }, (_, index) => index + 1)
    expect(allocateCacheStoreIndex('task_a', all)).toBeNull()
  })

  it('never flushes an index-less URL or database zero', () => {
    expect(isFlushableCacheStoreUrl('redis://localhost:6379')).toBe(false)
    expect(isFlushableCacheStoreUrl('redis://localhost:6379/0')).toBe(false)
    expect(isFlushableCacheStoreUrl('redis://localhost:6379/3')).toBe(true)
  })
})

describe('seedRefusal', () => {
  it('refuses when the databases already existed', () => {
    expect(
      seedRefusal({ databasesAreNew: false, seedRequested: true, hasSeedCommand: true }),
    ).toBe('existing databases reused')
  })

  it('refuses when seeding was skipped', () => {
    expect(
      seedRefusal({ databasesAreNew: true, seedRequested: false, hasSeedCommand: true }),
    ).toBe('seeding was skipped')
  })

  it('refuses when no seed command is declared', () => {
    expect(
      seedRefusal({ databasesAreNew: true, seedRequested: true, hasSeedCommand: false }),
    ).toBe('no seed command is declared')
  })

  it('allows the seed only for databases created in the same run', () => {
    expect(
      seedRefusal({ databasesAreNew: true, seedRequested: true, hasSeedCommand: true }),
    ).toBeNull()
  })
})

describe('derived-database patterns', () => {
  const base = 'app_wt_task_a_test'

  it('matches derived names anchored on the lane database', () => {
    const matcher = compileDerivedPattern('{base}_w*', base)
    expect(matcher.test('app_wt_task_a_test_w1')).toBe(true)
    expect(matcher.test('app_wt_task_a_test_worker_2')).toBe(true)
    expect(matcher.test('app_wt_task_a_test')).toBe(false)
    expect(matcher.test('app_wt_task_b_test_w1')).toBe(false)
  })

  it('supports prefixed derived names', () => {
    const matcher = compileDerivedPattern('test_{base}', 'product_wt_lane_a_development')
    expect(matcher.test('test_product_wt_lane_a_development')).toBe(true)
    expect(matcher.test('product_wt_lane_a_development')).toBe(false)
  })

  it('collects the whole family and nothing else', () => {
    const existing = [
      'app_wt_task_a_development',
      'app_wt_task_a_development_w1',
      'app_wt_task_a_test',
      'app_wt_task_a_test_gw3',
      'test_app_wt_task_a_test',
      'app_wt_task_a_test_unit_users',
      'app_development',
      'postgres',
    ]
    const family = laneDatabaseFamily(existing, [
      {
        baseName: 'app_wt_task_a_development',
        derivedPatterns: ['{base}_w*', '{base}_unit*'],
      },
      { baseName: 'app_wt_task_a_test', derivedPatterns: ['test_{base}', '{base}_gw*'] },
    ])
    expect(family.sort()).toEqual([
      'app_wt_task_a_development',
      'app_wt_task_a_development_w1',
      'app_wt_task_a_test',
      'app_wt_task_a_test_gw3',
      'test_app_wt_task_a_test',
    ])
  })

  it('keeps a sibling lane whose slug extends this one out of the blast radius', () => {
    const family = laneDatabaseFamily(
      ['app_wt_lane_a_extra_development', 'app_wt_lane_a_extra_development_w1'],
      [
        {
          baseName: 'app_wt_lane_a_development',
          derivedPatterns: ['{base}_w*', '{base}*'],
        },
      ],
    )
    expect(family).toEqual([])
  })

  it('never matches injection-unsafe names', () => {
    const family = laneDatabaseFamily(
      ['app_wt_task_a_test"; drop table users'],
      [{ baseName: 'app_wt_task_a_test', derivedPatterns: ['{base}*'] }],
    )
    expect(family).toEqual([])
  })

  it('escapes regex metacharacters in patterns and base names', () => {
    const matcher = compileDerivedPattern('{base}.backup', 'app_wt_a_test')
    expect(matcher.test('app_wt_a_testxbackup')).toBe(false)
  })
})

describe('fingerprintSources', () => {
  const sources: [string, string][] = [
    ['db/migrations/a.ts', 'create table a'],
    ['db/migrations/b.ts', 'create table b'],
  ]

  it('does not depend on the order the sources are collected in', () => {
    expect(fingerprintSources(sources)).toBe(fingerprintSources([...sources].reverse()))
  })

  it('changes when a file changes', () => {
    expect(fingerprintSources(sources)).not.toBe(
      fingerprintSources([
        sources[0] as [string, string],
        ['db/migrations/b.ts', 'drop table b'],
      ]),
    )
  })

  it('changes when a file is renamed', () => {
    expect(fingerprintSources(sources)).not.toBe(
      fingerprintSources([
        sources[0] as [string, string],
        ['db/migrations/c.ts', 'create table b'],
      ]),
    )
  })

  it('keeps the boundary between a path and its contents unambiguous', () => {
    expect(fingerprintSources([['a', 'b\nc']])).not.toBe(
      fingerprintSources([['a\nb', 'c']]),
    )
  })
})

describe('todaysSeedDate', () => {
  it('formats the calendar day in the configured timezone', () => {
    expect(todaysSeedDate(new Date('2026-07-25T12:00:00Z'), 'America/Sao_Paulo')).toBe(
      '2026-07-25',
    )
  })

  it('still reports the previous day right after midnight UTC', () => {
    expect(todaysSeedDate(new Date('2026-07-25T02:00:00Z'), 'America/Sao_Paulo')).toBe(
      '2026-07-24',
    )
  })
})

describe('parseTemplateFingerprint', () => {
  it('reads a stored fingerprint', () => {
    expect(
      parseTemplateFingerprint(
        '{"migrationsHash":"m","seedHash":"s","seedDate":"2026-07-25"}',
      ),
    ).toEqual({ migrationsHash: 'm', seedHash: 's', seedDate: '2026-07-25' })
  })

  it('reads a migrations-only fingerprint', () => {
    expect(parseTemplateFingerprint('{"migrationsHash":"m"}')).toEqual({
      migrationsHash: 'm',
    })
  })

  it('treats a missing, unreadable or foreign comment as no fingerprint', () => {
    expect(parseTemplateFingerprint(null)).toBeNull()
    expect(parseTemplateFingerprint('')).toBeNull()
    expect(parseTemplateFingerprint('not json')).toBeNull()
    expect(parseTemplateFingerprint('"a string"')).toBeNull()
    expect(parseTemplateFingerprint('{"seedHash":"s"}')).toBeNull()
  })
})

describe('planTemplateUsage', () => {
  const current = {
    migrationsHash: 'm',
    seedHash: 's',
    seedDate: '2026-07-25',
  }

  it('rebuilds when there is no template', () => {
    expect(planTemplateUsage(null, current).action).toBe('rebuild')
  })

  it('rebuilds when the seed changed', () => {
    expect(planTemplateUsage({ ...current, seedHash: 'other' }, current).action).toBe(
      'rebuild',
    )
  })

  it('migrates the copy when only the migrations changed', () => {
    expect(
      planTemplateUsage({ ...current, migrationsHash: 'older' }, current).action,
    ).toBe('migrate')
  })

  it('copies a template seeded on another day', () => {
    expect(
      planTemplateUsage({ ...current, seedDate: '2026-07-24' }, current).action,
    ).toBe('copy')
  })

  it('rebuilds a template seeded on another day when a fresh seed is asked for', () => {
    expect(
      planTemplateUsage({ ...current, seedDate: '2026-07-24' }, current, {
        freshSeed: true,
      }).action,
    ).toBe('rebuild')
  })

  it('copies an up-to-date template', () => {
    expect(planTemplateUsage(current, current).action).toBe('copy')
  })

  it('copies an up-to-date migrations-only template', () => {
    const migrationsOnly = { migrationsHash: 'm' }
    expect(planTemplateUsage(migrationsOnly, migrationsOnly).action).toBe('copy')
  })
})

describe('hasStaleSeedDate', () => {
  const current = { migrationsHash: 'm', seedHash: 's', seedDate: '2026-07-25' }

  it('flags a template seeded on another day', () => {
    expect(hasStaleSeedDate({ ...current, seedDate: '2026-07-24' }, current)).toBe(true)
  })

  it('ignores templates without a seed date', () => {
    expect(hasStaleSeedDate({ migrationsHash: 'm' }, { migrationsHash: 'm' })).toBe(false)
    expect(hasStaleSeedDate(null, current)).toBe(false)
  })
})

describe('laneProcessesFromLsofOutput', () => {
  const root = '/Users/dev/app-worktrees'

  it('extracts processes whose working directory is inside a lane', () => {
    const output = [
      'p123',
      'fcwd',
      'n/Users/dev/app-worktrees/task-a/apps/web',
      'p456',
      'fcwd',
      'n/Users/dev/app',
      'p789',
      'fcwd',
      'n/Users/dev/app-worktrees/task-b',
      '',
    ].join('\n')
    expect(laneProcessesFromLsofOutput(output, [root])).toEqual([
      {
        processId: 123,
        lane: 'task-a',
        workingDirectory: '/Users/dev/app-worktrees/task-a/apps/web',
      },
      {
        processId: 789,
        lane: 'task-b',
        workingDirectory: '/Users/dev/app-worktrees/task-b',
      },
    ])
  })

  it('spans the worktrees roots of every declared repository', () => {
    const output = [
      'p11',
      'fcwd',
      'n/Users/dev/app-worktrees/task-a',
      'p22',
      'fcwd',
      'n/Users/dev/engine-worktrees/task-a/src',
      '',
    ].join('\n')
    expect(
      laneProcessesFromLsofOutput(output, [root, '/Users/dev/engine-worktrees']),
    ).toEqual([
      {
        processId: 11,
        lane: 'task-a',
        workingDirectory: '/Users/dev/app-worktrees/task-a',
      },
      {
        processId: 22,
        lane: 'task-a',
        workingDirectory: '/Users/dev/engine-worktrees/task-a/src',
      },
    ])
  })

  it('ignores sibling directories sharing the root as a prefix', () => {
    const output = 'p123\nfcwd\nn/Users/dev/app-worktrees-archive/task-a\n'
    expect(laneProcessesFromLsofOutput(output, [root])).toEqual([])
  })

  it('returns nothing when lsof matched no processes', () => {
    expect(laneProcessesFromLsofOutput('', [root])).toEqual([])
  })
})

describe('sessionEndCleansUpProcesses', () => {
  it('cleans up when the user quits at the prompt or logs out', () => {
    expect(sessionEndCleansUpProcesses('prompt_input_exit')).toBe(true)
    expect(sessionEndCleansUpProcesses('logout')).toBe(true)
  })

  it('keeps processes on every other or unknown reason', () => {
    expect(sessionEndCleansUpProcesses('clear')).toBe(false)
    expect(sessionEndCleansUpProcesses('resume')).toBe(false)
    expect(sessionEndCleansUpProcesses('other')).toBe(false)
    expect(sessionEndCleansUpProcesses(undefined)).toBe(false)
  })
})

describe('shared-service probing', () => {
  it('derives the env key a service is probed through', () => {
    expect(serviceEnvKey('database')).toBe('DATABASE_URL')
    expect(serviceEnvKey('redis')).toBe('REDIS_URL')
    expect(serviceEnvKey('cache-store')).toBe('CACHE_STORE_URL')
  })

  it('reads an explicit port from the URL', () => {
    expect(serviceProbePort('postgres://localhost:5433/app')).toBe(5433)
    expect(serviceProbePort('redis://localhost:6380')).toBe(6380)
  })

  it('falls back to the scheme default when the URL leaves the port implicit', () => {
    expect(serviceProbePort('postgres://localhost/app')).toBe(5432)
    expect(serviceProbePort('redis://localhost')).toBe(6379)
  })

  it('reports null when no port can be told', () => {
    expect(serviceProbePort('unix:///var/run/thing.sock')).toBeNull()
    expect(serviceProbePort('not a url')).toBeNull()
  })
})

describe('resolveProvisioning', () => {
  it('applies every default', () => {
    const resolved = resolveProvisioning(undefined, { databasePrefix: 'app_wt_' })
    expect(resolved.databasePrefix).toBe('app_wt_')
    expect(resolved.envFile).toBe('.env')
    expect(resolved.repositories).toEqual([{ path: '.' }])
    expect(resolved.databases).toEqual([])
    expect(resolved.portBases).toEqual({})
    expect(resolved.portBlocks).toEqual({})
    expect(resolved.templateCaching).toBe(false)
    expect(resolved.cacheStoreIndex).toBe(false)
    expect(resolved.cacheStoreEnvKeys).toEqual(['REDIS_URL'])
    expect(resolved.serviceStartCommand).toBe('docker compose up -d')
    expect(resolved.laneProcessCommands).toContain('node')
  })

  it('defaults database env keys and seeded flags', () => {
    const resolved = resolveProvisioning(
      {
        databases: [{ name: 'development' }],
        repositories: [{ path: '.', migrateCommand: 'make migrate' }],
      },
      { databasePrefix: 'app_wt_' },
    )
    expect(resolved.databases).toEqual([
      {
        name: 'development',
        envKey: 'DEVELOPMENT_DATABASE_URL',
        seeded: false,
        derivedPatterns: [],
      },
    ])
  })

  it('keeps a declared databasePrefix over the default', () => {
    const resolved = resolveProvisioning(
      { databasePrefix: 'legacy_wt_' },
      { databasePrefix: 'app_wt_' },
    )
    expect(resolved.databasePrefix).toBe('legacy_wt_')
  })

  it('rejects a prefix without a trailing underscore', () => {
    expect(() =>
      resolveProvisioning({ databasePrefix: 'appwt' }, { databasePrefix: 'app_wt_' }),
    ).toThrow(/end with an underscore/)
  })

  it('rejects a duplicate or malformed database resource', () => {
    expect(() =>
      resolveProvisioning(
        {
          databases: [{ name: 'development' }, { name: 'development' }],
          repositories: [{ path: '.', migrateCommand: 'make migrate' }],
        },
        { databasePrefix: 'app_wt_' },
      ),
    ).toThrow(/declared twice/)
    expect(() =>
      resolveProvisioning(
        {
          databases: [{ name: 'Weird-Name' }],
          repositories: [{ path: '.', migrateCommand: 'make migrate' }],
        },
        { databasePrefix: 'app_wt_' },
      ),
    ).toThrow(/lowercase slug/)
  })

  it('rejects port blocks that name no declared port or carry a bad span', () => {
    expect(() =>
      resolveProvisioning(
        { portBases: { port: 4100 }, portBlocks: { testPort: 4 } },
        { databasePrefix: 'app_wt_' },
      ),
    ).toThrow(/portBases does not declare/)
    expect(() =>
      resolveProvisioning(
        { portBases: { port: 4100 }, portBlocks: { port: 0 } },
        { databasePrefix: 'app_wt_' },
      ),
    ).toThrow(/positive integer/)
  })

  it('requires migration sources for template caching', () => {
    expect(() =>
      resolveProvisioning({ templateCaching: true }, { databasePrefix: 'app_wt_' }),
    ).toThrow(/migrationSources/)
  })

  it('requires a primary migrate command when the lane owns databases', () => {
    expect(() =>
      resolveProvisioning(
        { databases: [{ name: 'development' }] },
        { databasePrefix: 'app_wt_' },
      ),
    ).toThrow(/migrateCommand/)
  })
})

/**
 * Two env files reusing the SAME env key names for different allocations:
 * PORT is the dev server in `.env` and the test server (heading a worker
 * block) in the nested test-environment file, and each file carries
 * DATABASE_URL pointing at a different lane database.
 */
const twoFileResolved = resolveProvisioning(
  {
    databases: [
      { name: 'development', envKey: 'DATABASE_URL', seeded: true },
      { name: 'test', envKey: 'DATABASE_URL' },
    ],
    portBases: { port: 4100, maildevPort: 11100, testPort: 5100, testMaildevPort: 13100 },
    portBlocks: { testPort: E2E_WORKER_COUNT },
    cacheStoreIndex: true,
    repositories: [{ path: '.', migrateCommand: 'pnpm run db:migrate' }],
    envFiles: [
      {
        path: '.env',
        databases: ['development'],
        ports: { PORT: 'port', MAILDEV_PORT: 'maildevPort' },
        cacheStore: true,
        extra: { TELEMETRY_ENABLED: 'false' },
      },
      {
        path: 'apps/web/.env.test',
        databases: ['test'],
        ports: { PORT: 'testPort', MAILDEV_PORT: 'testMaildevPort' },
        extra: { STORAGE_BUCKET: 'uploads-{slug-dashed}', LANE: '{slug}' },
      },
    ],
  },
  { databasePrefix: 'app_wt_' },
)

const twoFileAllocation: LaneAllocation = {
  ports: { port: 4187, maildevPort: 11187, testPort: 5187, testMaildevPort: 13187 },
  databaseUrls: {
    development: 'postgresql://localhost:5432/app_wt_task_a_development',
    test: 'postgresql://localhost:5432/app_wt_task_a_test',
  },
  cacheStoreUrl: 'redis://localhost:6379/3',
}

describe('resolveProvisioning envFiles', () => {
  it('synthesizes one entry equivalent to the single-file behavior when absent', () => {
    expect(resolvedFixture.envFiles).toEqual([
      {
        path: '.env',
        databases: resolvedFixture.databases,
        ports: {
          PORT: 'port',
          HMR_PORT: 'hmrPort',
          MAILDEV_PORT: 'maildevPort',
          MAILDEV_WEB_PORT: 'maildevWebPort',
          TEST_PORT: 'testPort',
          TEST_MAILDEV_PORT: 'testMaildevPort',
          TEST_MAILDEV_WEB_PORT: 'testMaildevWebPort',
        },
        cacheStore: true,
        extra: {},
      },
    ])
  })

  it('synthesizes the entry at the configured envFile path', () => {
    const resolved = resolveProvisioning(
      { envFile: 'apps/web/.env' },
      { databasePrefix: 'app_wt_' },
    )
    expect(resolved.envFiles).toEqual([
      { path: 'apps/web/.env', databases: [], ports: {}, cacheStore: true, extra: {} },
    ])
  })

  it('resolves declared entries, applying every default', () => {
    const resolved = resolveProvisioning(
      {
        portBases: { port: 4100 },
        envFiles: [{ path: '.env', ports: { PORT: 'port' } }],
      },
      { databasePrefix: 'app_wt_' },
    )
    expect(resolved.envFiles).toEqual([
      {
        path: '.env',
        databases: [],
        ports: { PORT: 'port' },
        cacheStore: false,
        extra: {},
      },
    ])
  })

  it('resolves the two-file table, listing each file its own databases', () => {
    expect(twoFileResolved.envFiles.map((file) => file.path)).toEqual([
      '.env',
      'apps/web/.env.test',
    ])
    expect(
      twoFileResolved.envFiles.map((file) =>
        file.databases.map((database) => database.name),
      ),
    ).toEqual([['development'], ['test']])
  })

  it('rejects an empty list', () => {
    expect(() =>
      resolveProvisioning({ envFiles: [] }, { databasePrefix: 'app_wt_' }),
    ).toThrow(/at least one file/)
  })

  it('rejects a path declared twice', () => {
    expect(() =>
      resolveProvisioning(
        { envFiles: [{ path: '.env' }, { path: '.env' }] },
        { databasePrefix: 'app_wt_' },
      ),
    ).toThrow(/declares "\.env" twice/)
  })

  it('rejects a file naming an undeclared database', () => {
    expect(() =>
      resolveProvisioning(
        { envFiles: [{ path: '.env', databases: ['development'] }] },
        { databasePrefix: 'app_wt_' },
      ),
    ).toThrow(/no database resource declares it/)
  })

  it('rejects a declared database listed in no file', () => {
    expect(() =>
      resolveProvisioning(
        {
          databases: [{ name: 'development' }],
          repositories: [{ path: '.', migrateCommand: 'make migrate' }],
          envFiles: [{ path: '.env' }],
        },
        { databasePrefix: 'app_wt_' },
      ),
    ).toThrow(/listed in no envFiles entry/)
  })

  it('rejects a port entry naming an undeclared port', () => {
    expect(() =>
      resolveProvisioning(
        {
          portBases: { port: 4100 },
          envFiles: [{ path: '.env', ports: { PORT: 'port', TEST_PORT: 'testPort' } }],
        },
        { databasePrefix: 'app_wt_' },
      ),
    ).toThrow(/portBases does not declare it/)
  })

  it('rejects a declared port mapped in no file', () => {
    expect(() =>
      resolveProvisioning(
        {
          portBases: { port: 4100, testPort: 5100 },
          envFiles: [{ path: '.env', ports: { PORT: 'port' } }],
        },
        { databasePrefix: 'app_wt_' },
      ),
    ).toThrow(/mapped in no envFiles entry/)
  })

  it('rejects cacheStoreIndex with no file carrying the cache store', () => {
    expect(() =>
      resolveProvisioning(
        { cacheStoreIndex: true, envFiles: [{ path: '.env' }] },
        { databasePrefix: 'app_wt_' },
      ),
    ).toThrow(/carries cacheStore/)
  })

  it('rejects env keys that could not be parsed back', () => {
    expect(() =>
      resolveProvisioning(
        {
          portBases: { port: 4100 },
          envFiles: [{ path: '.env', ports: { appPort: 'port' } }],
        },
        { databasePrefix: 'app_wt_' },
      ),
    ).toThrow(/SCREAMING_SNAKE_CASE/)
    expect(() =>
      resolveProvisioning(
        {
          portBases: { port: 4100 },
          envFiles: [
            { path: '.env', ports: { PORT: 'port' }, extra: { 'weird-key': 'x' } },
          ],
        },
        { databasePrefix: 'app_wt_' },
      ),
    ).toThrow(/SCREAMING_SNAKE_CASE/)
  })

  it('rejects a file writing the same env key twice', () => {
    expect(() =>
      resolveProvisioning(
        {
          portBases: { port: 4100 },
          envFiles: [{ path: '.env', ports: { PORT: 'port' }, extra: { PORT: '9999' } }],
        },
        { databasePrefix: 'app_wt_' },
      ),
    ).toThrow(/writes env key "PORT" more than once/)
  })
})

describe('replaceSlugTokens', () => {
  it('replaces both tokens, dashing the slug where asked', () => {
    expect(replaceSlugTokens('uploads-{slug-dashed}-of-{slug}', 'task_a')).toBe(
      'uploads-task-a-of-task_a',
    )
  })

  it('leaves values without tokens alone', () => {
    expect(replaceSlugTokens('false', 'task_a')).toBe('false')
  })
})

describe('laneEnvValuesForFile', () => {
  const [devFile, testFile] = twoFileResolved.envFiles as [
    (typeof twoFileResolved.envFiles)[number],
    (typeof twoFileResolved.envFiles)[number],
  ]

  it("renders the dev file's slice: its database, its ports, cache, extras", () => {
    expect(
      laneEnvValuesForFile(twoFileAllocation, twoFileResolved, devFile, 'task_a'),
    ).toEqual({
      DATABASE_URL: 'postgresql://localhost:5432/app_wt_task_a_development',
      PORT: '4187',
      MAILDEV_PORT: '11187',
      REDIS_URL: 'redis://localhost:6379/3',
      TELEMETRY_ENABLED: 'false',
    })
  })

  it('remaps the same key names to the test allocations in the test file', () => {
    expect(
      laneEnvValuesForFile(twoFileAllocation, twoFileResolved, testFile, 'task_a'),
    ).toEqual({
      DATABASE_URL: 'postgresql://localhost:5432/app_wt_task_a_test',
      PORT: '5187',
      MAILDEV_PORT: '13187',
      STORAGE_BUCKET: 'uploads-task-a',
      LANE: 'task_a',
    })
  })

  it('refuses an allocation missing a port the file records', () => {
    expect(() =>
      laneEnvValuesForFile(
        { ...twoFileAllocation, ports: { port: 4187, maildevPort: 11187 } },
        twoFileResolved,
        testFile,
        'task_a',
      ),
    ).toThrow(/no port for "testPort"/)
  })
})

describe('parseLaneAllocationFromFiles', () => {
  const contentsByFile = twoFileResolved.envFiles.map((file) =>
    upsertEnvValues(
      'SESSION_SECRET=s\n',
      laneEnvValuesForFile(twoFileAllocation, twoFileResolved, file, 'task_a'),
    ),
  )

  it('round-trips the allocation across the files, keys remapped per file', () => {
    expect(parseLaneAllocationFromFiles(contentsByFile, twoFileResolved)).toEqual(
      twoFileAllocation,
    )
  })

  it('treats a lane whose FIRST file lacks the marker as unallocated', () => {
    expect(
      parseLaneAllocationFromFiles([null, contentsByFile[1]], twoFileResolved),
    ).toBeNull()
    expect(
      parseLaneAllocationFromFiles(['PORT=4187\n', contentsByFile[1]], twoFileResolved),
    ).toBeNull()
  })

  it('complains when a missing later file leaves a value recorded nowhere', () => {
    expect(() =>
      parseLaneAllocationFromFiles([contentsByFile[0], null], twoFileResolved),
    ).toThrow(/fix or delete the block and re-run/)
  })

  it('tolerates a missing later file whose values are recorded elsewhere', () => {
    const resolved = resolveProvisioning(
      {
        portBases: { port: 4100 },
        envFiles: [
          { path: '.env', ports: { PORT: 'port' } },
          { path: '.env.test', ports: { PORT: 'port' }, extra: { FOO: 'bar' } },
        ],
      },
      { databasePrefix: 'app_wt_' },
    )
    const first = [ENV_MARKER, 'PORT=4187'].join('\n')
    expect(parseLaneAllocationFromFiles([first, null], resolved)).toEqual({
      ports: { port: 4187 },
      databaseUrls: {},
    })
  })

  it('complains when two files disagree about a recorded value', () => {
    const resolved = resolveProvisioning(
      {
        portBases: { port: 4100 },
        envFiles: [
          { path: '.env', ports: { PORT: 'port' } },
          { path: '.env.test', ports: { PORT: 'port' } },
        ],
      },
      { databasePrefix: 'app_wt_' },
    )
    const first = [ENV_MARKER, 'PORT=4187'].join('\n')
    const second = [ENV_MARKER, 'PORT=4188'].join('\n')
    expect(() => parseLaneAllocationFromFiles([first, second], resolved)).toThrow(
      /disagree about the port "port"/,
    )
  })

  it('complains when a marked file misses one of its own keys', () => {
    const broken = (contentsByFile[1] as string)
      .split('\n')
      .filter((line) => !line.startsWith('DATABASE_URL='))
      .join('\n')
    expect(() =>
      parseLaneAllocationFromFiles([contentsByFile[0], broken], twoFileResolved),
    ).toThrow(/DATABASE_URL \(in apps\/web\/\.env\.test\)/)
  })
})

describe('portsClaimedByEnvFile', () => {
  const [devFile, testFile] = twoFileResolved.envFiles as [
    (typeof twoFileResolved.envFiles)[number],
    (typeof twoFileResolved.envFiles)[number],
  ]

  it("claims under the file's own mapping, whole blocks included", () => {
    expect(
      portsClaimedByEnvFile(
        { PORT: '5187', MAILDEV_PORT: '13187' },
        testFile,
        twoFileResolved.portBlocks,
      ).sort((first, second) => first - second),
    ).toEqual([5187, 5188, 5189, 5190, 13187])
  })

  it('claims single ports for the dev file under the same key names', () => {
    expect(
      portsClaimedByEnvFile(
        { PORT: '4187', MAILDEV_PORT: '11187' },
        devFile,
        twoFileResolved.portBlocks,
      ).sort((first, second) => first - second),
    ).toEqual([4187, 11187])
  })
})

describe('reservedPortsFromLaneEnvFiles', () => {
  const devContents = [ENV_MARKER, 'PORT=4187', 'MAILDEV_PORT=11187'].join('\n')
  const testContents = [ENV_MARKER, 'PORT=5187', 'MAILDEV_PORT=13187'].join('\n')

  it('unions every file of every lane; a colliding key contributes both values', () => {
    const reserved = reservedPortsFromLaneEnvFiles(
      [[devContents, testContents]],
      twoFileResolved,
    )
    expect([...reserved].sort((first, second) => first - second)).toEqual([
      4187, 5187, 5188, 5189, 5190, 11187, 13187,
    ])
  })

  it('skips files without the managed block, keeping the rest of the lane', () => {
    const reserved = reservedPortsFromLaneEnvFiles(
      [
        [devContents, 'PORT=9999\nMAILDEV_PORT=9899'],
        [null, testContents],
      ],
      twoFileResolved,
    )
    expect([...reserved].sort((first, second) => first - second)).toEqual([
      4187, 5187, 5188, 5189, 5190, 11187, 13187,
    ])
  })
})
