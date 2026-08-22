import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { environmentSchema as appEnvironmentSchema } from '../../app/env.server'
import {
  E2E_WORKER_COUNT,
  ENV_MARKER,
  PORT_BASES,
  type PortPlan,
  assignPortPlan,
  basePortPlan,
  bucketName,
  databaseNameFromUrl,
  databaseNames,
  hashOffset,
  isWorktreeDatabaseName,
  laneSlug,
  missingEnvKeys,
  portsClaimedByEnvFile,
  portsHeldBy,
  readEnvValues,
  repointLocalhostUrls,
  reservedPortsFromEnvFiles,
  resolvePortPlan,
  upsertEnvValues,
  withDatabaseName,
  worktreePathsFromPorcelain,
} from './common'

const manyLaneSlugs = Array.from({ length: 500 }, (_, index) =>
  laneSlug(`lane-${index}`)
)

const heldPorts = (plan: PortPlan) =>
  Object.entries(plan).flatMap(([key, port]) =>
    portsHeldBy(key as keyof PortPlan, port)
  )

const devEnvFile = (port: number) =>
  [
    'SESSION_SECRET=s',
    ENV_MARKER,
    `PORT=${port}`,
    `HMR_PORT=${port + 100}`,
    `MAILDEV_PORT=${port + 200}`,
    `MAILDEV_WEB_PORT=${port + 300}`,
  ].join('\n')

const testEnvFile = (port: number) =>
  [
    ENV_MARKER,
    `PORT=${port}`,
    `MAILDEV_PORT=${port + 200}`,
    `MAILDEV_WEB_PORT=${port + 300}`,
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
})

describe('databaseNames', () => {
  it('derives guarded development and test database names', () => {
    expect(databaseNames('task_a')).toEqual({
      development: 'app_wt_task_a_development',
      test: 'app_wt_task_a_test',
    })
  })

  it('stays within the Postgres identifier limit for the longest slug', () => {
    const names = databaseNames(laneSlug('x'.repeat(80)))
    expect(names.development.length).toBeLessThanOrEqual(63)
    expect(names.test.length).toBeLessThanOrEqual(63)
  })
})

describe('bucketName', () => {
  it('derives a per-lane bucket name with hyphens from the slug', () => {
    expect(bucketName('file_storage')).toBe('app-wt-file-storage')
  })

  it('produces a bucket-safe name for a multi-word slug', () => {
    expect(bucketName(laneSlug('Fix Login/Flow'))).toBe(
      'app-wt-fix-login-flow'
    )
  })
})

describe('isWorktreeDatabaseName', () => {
  it('accepts per-worktree database names', () => {
    expect(isWorktreeDatabaseName('app_wt_task_a_development')).toBe(true)
  })

  it('rejects the main databases and injection attempts', () => {
    expect(isWorktreeDatabaseName('app_development')).toBe(false)
    expect(isWorktreeDatabaseName('app_test')).toBe(false)
    expect(isWorktreeDatabaseName('app_wt_a"; drop table users')).toBe(false)
  })
})

describe('E2E_WORKER_COUNT', () => {
  it('matches the number of workers Playwright actually runs', () => {
    const config = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../playwright.config.ts'
      ),
      'utf8'
    )

    expect(config).toMatch(
      new RegExp(`^\\s*workers: ${E2E_WORKER_COUNT},$`, 'm')
    )
  })
})

describe('portsHeldBy', () => {
  it('holds one port for a single listener', () => {
    expect(portsHeldBy('port', 7420)).toEqual([7420])
    expect(portsHeldBy('maildevWebPort', 16420)).toEqual([16420])
  })

  it('holds a port per Playwright worker for the E2E server', () => {
    expect(portsHeldBy('testPort', 8420)).toEqual([8420, 8421, 8422, 8423])
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

  it('steps in whole E2E blocks, so no two lanes land mid-block', () => {
    for (const slug of manyLaneSlugs) {
      expect(hashOffset(slug) % E2E_WORKER_COUNT).toBe(0)
    }
  })
})

describe('basePortPlan', () => {
  it('derives distinct ports deterministically', () => {
    const plan = basePortPlan('task_a')
    expect(basePortPlan('task_a')).toEqual(plan)
    expect(new Set(Object.values(plan)).size).toBe(
      Object.keys(PORT_BASES).length
    )
  })

  it('offsets every port from its base by the same amount', () => {
    const plan = basePortPlan('task_a')
    const offset = hashOffset('task_a')
    for (const [key, base] of Object.entries(PORT_BASES)) {
      expect(plan[key as keyof typeof PORT_BASES]).toBe(base + offset)
    }
  })

  it('never puts two lanes one to three ports apart on the E2E server', () => {
    const testPorts = [
      ...new Set(manyLaneSlugs.map((slug) => basePortPlan(slug).testPort)),
    ].sort((first, second) => first - second)
    const gaps = testPorts
      .slice(1)
      .map((port, index) => port - testPorts[index])

    expect(testPorts.length).toBeGreaterThan(1)
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(E2E_WORKER_COUNT)
  })

  it('keeps every port a lane holds inside its own base family', () => {
    const bases = Object.values(PORT_BASES).sort(
      (first, second) => first - second
    )
    const closestFamily = Math.min(
      ...bases.slice(1).map((base, index) => base - bases[index])
    )

    for (const slug of manyLaneSlugs) {
      for (const [key, port] of Object.entries(basePortPlan(slug))) {
        const planKey = key as keyof PortPlan
        const highest = Math.max(...portsHeldBy(planKey, port))
        expect(highest - PORT_BASES[planKey]).toBeLessThan(closestFamily)
      }
    }
  })
})

describe('assignPortPlan', () => {
  it('matches the base plan when nothing is reserved', () => {
    expect(assignPortPlan('task_a')).toEqual(basePortPlan('task_a'))
  })

  it('avoids every port a colliding lane already holds', () => {
    // main_bank and equipment_e4 hash to the same base ports (the real collision).
    expect(hashOffset('main_bank')).toBe(hashOffset('equipment_e4'))
    expect(basePortPlan('main_bank')).toEqual(basePortPlan('equipment_e4'))

    const first = assignPortPlan('main_bank')
    const second = assignPortPlan('equipment_e4', heldPorts(first))

    const firstPorts = new Set(heldPorts(first))
    for (const port of heldPorts(second)) {
      expect(firstPorts.has(port)).toBe(false)
    }
    expect(second.testPort).toBe(first.testPort + E2E_WORKER_COUNT)
  })

  it('moves the whole E2E block clear of a port reserved inside it', () => {
    const base = basePortPlan('task_a')

    const plan = assignPortPlan('task_a', [base.testPort + 2])

    expect(portsHeldBy('testPort', plan.testPort)).not.toContain(
      base.testPort + 2
    )
    expect(plan.testPort).toBe(base.testPort + 3)
  })

  it('steps a single-listener port past a reserved port one at a time', () => {
    const base = basePortPlan('task_a')

    expect(assignPortPlan('task_a', [base.port]).port).toBe(base.port + 1)
    expect(assignPortPlan('task_a', [base.maildevPort]).maildevPort).toBe(
      base.maildevPort + 1
    )
  })

  it("keeps a lane out of a sibling worktree's E2E block", () => {
    const base = basePortPlan('task_a')
    const sibling = reservedPortsFromEnvFiles([
      { envFile: '.env.test', contents: testEnvFile(base.testPort + 1) },
    ])

    const plan = assignPortPlan('task_a', sibling)

    for (const port of heldPorts(plan)) expect(sibling.has(port)).toBe(false)
    expect(plan.testPort).toBe(base.testPort + 1 + E2E_WORKER_COUNT)
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
    expect(
      worktreePathsFromPorcelain(
        listing,
        '/repos/app-worktrees/task-a'
      )
    ).toEqual(['/repos/app', '/repos/app-worktrees/task-b'])
  })
})

describe('reservedPortsFromEnvFiles', () => {
  it('reserves managed ports across every marked env file', () => {
    const reserved = reservedPortsFromEnvFiles([
      { envFile: '.env', contents: devEnvFile(7101) },
      { envFile: '.env.test', contents: testEnvFile(8101) },
      { envFile: '.env', contents: devEnvFile(7202) },
      { envFile: '.env.test', contents: testEnvFile(8202) },
    ])

    expect(reserved.has(7101)).toBe(true)
    expect(reserved.has(7201)).toBe(true)
    expect(reserved.has(7202)).toBe(true)
    expect(reserved.has(7302)).toBe(true)
    expect(reserved.has(8101)).toBe(true)
    expect(reserved.has(8301)).toBe(true)
    expect(reserved.has(8201)).toBe(false)
    expect(reserved.size).toBe(20)
  })

  it("reserves the whole E2E block behind a sibling lane's test port", () => {
    const reserved = reservedPortsFromEnvFiles([
      { envFile: '.env.test', contents: testEnvFile(8420) },
    ])

    expect([...reserved].sort((first, second) => first - second)).toEqual([
      8420, 8421, 8422, 8423, 8620, 8720,
    ])
  })

  it('reserves only the port itself for a dev server', () => {
    const reserved = reservedPortsFromEnvFiles([
      { envFile: '.env', contents: devEnvFile(7420) },
    ])

    expect([...reserved].sort((first, second) => first - second)).toEqual([
      7420, 7520, 7620, 7720,
    ])
  })

  it('ignores missing and unmarked env files', () => {
    const reserved = reservedPortsFromEnvFiles([
      { envFile: '.env', contents: null },
      { envFile: '.env.test', contents: undefined },
      { envFile: '.env.test', contents: 'PORT=9101\nMAILDEV_PORT=9301' },
      { envFile: '.env', contents: devEnvFile(7101) },
    ])

    expect([...reserved].sort((first, second) => first - second)).toEqual([
      7101, 7201, 7301, 7401,
    ])
  })
})

describe('resolvePortPlan', () => {
  it('keeps the base plan when no ports are reserved or busy', async () => {
    const plan = await resolvePortPlan('task_a', [], () => true)
    expect(plan).toEqual(basePortPlan('task_a'))
  })

  it('reassigns around a fixed set of busy ports until it converges', async () => {
    const base = basePortPlan('task_a')
    const busy = new Set([base.port, base.port + 1])

    const plan = await resolvePortPlan('task_a', [], (port) => !busy.has(port))

    for (const port of Object.values(plan)) {
      expect(busy.has(port)).toBe(false)
    }
    expect(plan.port).toBe(base.port + 2)
  })

  it('moves the E2E block off a busy port only a worker would bind', async () => {
    const base = basePortPlan('task_a')
    const busy = new Set([base.testPort + 3])

    const plan = await resolvePortPlan('task_a', [], (port) => !busy.has(port))

    for (const port of heldPorts(plan)) expect(busy.has(port)).toBe(false)
    expect(plan.testPort).toBe(base.testPort + E2E_WORKER_COUNT)
  })
})

describe('portsClaimedByEnvFile', () => {
  it('claims one port per managed key in .env', () => {
    expect(
      portsClaimedByEnvFile('.env', {
        PORT: '7427',
        HMR_PORT: '27027',
        MAILDEV_PORT: '15427',
        MAILDEV_WEB_PORT: '16427',
        SESSION_SECRET: 'secret',
      })
    ).toEqual([7427, 27027, 15427, 16427])
  })

  it("claims a whole E2E block for .env.test's PORT", () => {
    expect(
      portsClaimedByEnvFile('.env.test', {
        PORT: '8427',
        MAILDEV_PORT: '17427',
        MAILDEV_WEB_PORT: '18427',
      })
    ).toEqual([8427, 8428, 8429, 8430, 17427, 18427])
  })

  it('ignores keys the file does not carry', () => {
    expect(portsClaimedByEnvFile('.env', { PORT: '7427' })).toEqual([7427])
    expect(portsClaimedByEnvFile('.env.test', { HMR_PORT: '27027' })).toEqual(
      []
    )
    expect(portsClaimedByEnvFile('.env', { PORT: 'nonsense' })).toEqual([])
  })
})

describe('withDatabaseName', () => {
  it('replaces the database while preserving credentials and query', () => {
    expect(
      withDatabaseName(
        'postgresql://dev@localhost:5432/app_development?sslmode=disable',
        'app_wt_task_a_development'
      )
    ).toBe(
      'postgresql://dev@localhost:5432/app_wt_task_a_development?sslmode=disable'
    )
  })

  it('handles urls without a user', () => {
    expect(
      withDatabaseName(
        'postgresql://localhost:5432/app_test?sslmode=disable',
        'app_wt_task_a_test'
      )
    ).toBe('postgresql://localhost:5432/app_wt_task_a_test?sslmode=disable')
  })
})

describe('databaseNameFromUrl', () => {
  it('extracts the database name', () => {
    expect(
      databaseNameFromUrl(
        'postgresql://localhost:5432/app_test?sslmode=disable'
      )
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

describe('missingEnvKeys', () => {
  const schema = z.object({
    SESSION_SECRET: z.string().min(1),
    PUBLIC_APP_URL: z.string().url(),
    DATABASE_URL: z.string().optional(),
    NEW_RELIC_ENABLED: z.preprocess(Boolean, z.boolean()),
  })

  it('returns no keys when the values satisfy every schema', () => {
    expect(
      missingEnvKeys(
        { SESSION_SECRET: 's', PUBLIC_APP_URL: 'https://app.test' },
        [schema]
      )
    ).toEqual([])
  })

  it('names the required keys a candidate env omits, unioned and sorted', () => {
    const other = z.object({ SESSION_SECRET: z.string().min(1) })
    expect(missingEnvKeys({ DATABASE_URL: 'x' }, [schema, other])).toEqual([
      'PUBLIC_APP_URL',
      'SESSION_SECRET',
    ])
  })

  it('flags a required key the real app schema declares', () => {
    const missing = missingEnvKeys({}, [appEnvironmentSchema])
    expect(missing).toContain('PUBLIC_APP_URL')
    expect(missing).toContain('SESSION_SECRET')
    expect(missing).not.toContain('NEW_RELIC_ENABLED')
    expect(missing).not.toContain('NEW_RELIC_APP_NAME')
  })
})

describe('repointLocalhostUrls', () => {
  it('repoints the main app port inside localhost URLs to the lane port', () => {
    const contents = [
      'SESSION_SECRET=s',
      'QUICKBOOKS_AUTHORIZE_URL=http://localhost:7002/oauth?redirect=http://localhost:7002/done',
      'PORT=7123',
    ].join('\n')

    expect(repointLocalhostUrls(contents, 7002, 7123)).toBe(
      [
        'SESSION_SECRET=s',
        'QUICKBOOKS_AUTHORIZE_URL=http://localhost:7123/oauth?redirect=http://localhost:7123/done',
        'PORT=7123',
      ].join('\n')
    )
  })

  it('repoints 127.0.0.1 URLs as well', () => {
    expect(
      repointLocalhostUrls('CALLBACK=http://127.0.0.1:8002/done', 8002, 8321)
    ).toBe('CALLBACK=http://127.0.0.1:8321/done')
  })

  it('leaves production hosts, other ports, and longer ports untouched', () => {
    const contents = [
      'PRODUCTION_URL=https://app.example.com:7002/callback',
      'SUBSTRING_HOST=http://mylocalhost:7002/x',
      'LONGER_PORT=http://localhost:70020/x',
      'OTHER_PORT=http://localhost:26700/socket',
    ].join('\n')

    expect(repointLocalhostUrls(contents, 7002, 7123)).toBe(contents)
  })

  it('returns the contents unchanged when the port is unset or already correct', () => {
    const contents = 'CALLBACK=http://localhost:7002/x'

    expect(repointLocalhostUrls(contents, 7002, 7002)).toBe(contents)
    expect(repointLocalhostUrls(contents, Number.NaN, 7123)).toBe(contents)
  })
})

describe('upsertEnvValues', () => {
  const original =
    'DATABASE_URL=postgres://localhost/app\nSESSION_SECRET=s3\n'

  it('replaces managed keys and appends a marker block', () => {
    const result = upsertEnvValues(original, {
      DATABASE_URL: 'postgres://localhost/app_wt_a_development',
      PORT: '4123',
    })
    expect(result).toContain(ENV_MARKER)
    expect(result).toContain('SESSION_SECRET=s3')
    expect(result).toContain(
      'DATABASE_URL=postgres://localhost/app_wt_a_development'
    )
    expect(result).toContain('PORT=4123')
    expect(result).not.toContain(
      'DATABASE_URL=postgres://localhost/app\n'
    )
  })

  it('is idempotent when re-applied with new values', () => {
    const values = { DATABASE_URL: 'postgres://localhost/x', PORT: '4123' }
    const once = upsertEnvValues(original, values)
    const twice = upsertEnvValues(once, values)
    expect(twice).toBe(once)
    expect(twice.split(ENV_MARKER)).toHaveLength(2)
  })
})
