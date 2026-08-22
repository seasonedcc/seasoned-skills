import { describe, expect, it } from 'vitest'
import {
  assignPortPlan,
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
  todaysSeedDate,
  upsertEnvValues,
  withDatabaseName,
  worktreePathFromHookInput,
  worktreePathsFromPorcelain,
} from './common'

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

describe('hashOffset', () => {
  it('is deterministic and within range', () => {
    for (const slug of ['task_a', 'task_b', 'another_lane', 'x']) {
      const offset = hashOffset(slug)
      expect(offset).toBe(hashOffset(slug))
      expect(offset).toBeGreaterThanOrEqual(0)
      expect(offset).toBeLessThan(400)
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
})

describe('assignPortPlan', () => {
  it('matches the base plan when nothing is reserved', () => {
    expect(assignPortPlan('task_a')).toEqual(basePortPlan('task_a'))
  })

  it('avoids ports a colliding lane already reserved', () => {
    expect(hashOffset('main_bank')).toBe(hashOffset('equipment_e4'))
    expect(basePortPlan('main_bank')).toEqual(basePortPlan('equipment_e4'))

    const first = assignPortPlan('main_bank')
    const second = assignPortPlan('equipment_e4', Object.values(first))

    const firstPorts = new Set(Object.values(first))
    for (const port of Object.values(second)) {
      expect(firstPorts.has(port)).toBe(false)
    }
    expect(new Set(Object.values(second)).size).toBe(
      Object.values(second).length
    )
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
      worktreePathsFromPorcelain(listing, '/repos/app-worktrees/task-a')
    ).toEqual(['/repos/app', '/repos/app-worktrees/task-b'])
  })
})

describe('reservedPortsFromEnvFiles', () => {
  const devEnv = (port: number) =>
    [
      'SESSION_SECRET=s',
      ENV_MARKER,
      `PORT=${port}`,
      `HMR_PORT=${port + 100}`,
      `MAILDEV_PORT=${port + 200}`,
      `MAILDEV_WEB_PORT=${port + 300}`,
    ].join('\n')
  const testEnv = (port: number) =>
    [
      ENV_MARKER,
      `PORT=${port}`,
      `MAILDEV_PORT=${port + 200}`,
      `MAILDEV_WEB_PORT=${port + 300}`,
    ].join('\n')

  it('reserves managed ports across every marked env file', () => {
    const reserved = reservedPortsFromEnvFiles([
      devEnv(4101),
      testEnv(5101),
      devEnv(4202),
      testEnv(5202),
    ])

    expect(reserved.has(4101)).toBe(true)
    expect(reserved.has(4201)).toBe(true)
    expect(reserved.has(4202)).toBe(true)
    expect(reserved.has(4302)).toBe(true)
    expect(reserved.has(5101)).toBe(true)
    expect(reserved.has(5301)).toBe(true)
    expect(reserved.has(5201)).toBe(false)
    expect(reserved.size).toBe(14)
  })

  it('ignores missing and unmarked env files', () => {
    const reserved = reservedPortsFromEnvFiles([
      null,
      undefined,
      'PORT=6101\nMAILDEV_PORT=6301',
      devEnv(4101),
    ])

    expect([...reserved].sort((first, second) => first - second)).toEqual([
      4101, 4201, 4301, 4401,
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
})

describe('managedPortsFromEnv', () => {
  it('extracts the managed ports present in env values', () => {
    expect(
      managedPortsFromEnv({
        PORT: '4427',
        HMR_PORT: '25027',
        MAILDEV_PORT: '11427',
        MAILDEV_WEB_PORT: '12427',
        SESSION_SECRET: 'secret',
      })
    ).toEqual([4427, 25027, 11427, 12427])
  })

  it('ignores missing port keys, as in a .env.test block', () => {
    expect(
      managedPortsFromEnv({
        PORT: '5427',
        MAILDEV_PORT: '13427',
        MAILDEV_WEB_PORT: '14427',
      })
    ).toEqual([5427, 13427, 14427])
  })
})

describe('worktreePathFromHookInput', () => {
  it('prefers an explicit worktree_path', () => {
    expect(
      worktreePathFromHookInput(
        { worktree_path: '/tmp/lanes/task-a', name: 'task-a' },
        '/repo/app-worktrees'
      )
    ).toBe('/tmp/lanes/task-a')
  })

  it('derives the path from worktree_id', () => {
    expect(
      worktreePathFromHookInput(
        { worktree_id: 'task-a' },
        '/repo/app-worktrees'
      )
    ).toBe('/repo/app-worktrees/task-a')
  })

  it('derives the path from the name key sent by current Claude Code', () => {
    expect(
      worktreePathFromHookInput(
        { hook_event_name: 'WorktreeCreate', name: 'task-a' },
        '/repo/app-worktrees'
      )
    ).toBe('/repo/app-worktrees/task-a')
  })

  it('returns null when no path or lane name is present', () => {
    expect(worktreePathFromHookInput({}, '/repo/app-worktrees')).toBeNull()
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

describe('upsertEnvValues', () => {
  const original = 'DATABASE_URL=postgres://localhost/app\nSESSION_SECRET=s3\n'

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

describe('fingerprintSources', () => {
  const sources: [string, string][] = [
    ['app/db/migrations/a.ts', 'create table a'],
    ['app/db/migrations/b.ts', 'create table b'],
  ]

  it('does not depend on the order the sources are collected in', () => {
    expect(fingerprintSources(sources)).toBe(
      fingerprintSources([...sources].reverse())
    )
  })

  it('changes when a file changes', () => {
    expect(fingerprintSources(sources)).not.toBe(
      fingerprintSources([
        sources[0],
        ['app/db/migrations/b.ts', 'drop table b'],
      ])
    )
  })

  it('changes when a file is renamed', () => {
    expect(fingerprintSources(sources)).not.toBe(
      fingerprintSources([
        sources[0],
        ['app/db/migrations/c.ts', 'create table b'],
      ])
    )
  })

  it('keeps the boundary between a path and its contents unambiguous', () => {
    expect(fingerprintSources([['a', 'b\nc']])).not.toBe(
      fingerprintSources([['a\nb', 'c']])
    )
  })
})

describe('todaysSeedDate', () => {
  it('formats the São Paulo calendar day', () => {
    expect(todaysSeedDate(new Date('2026-07-25T12:00:00Z'))).toBe('2026-07-25')
  })

  it('still reports the previous day right after midnight UTC', () => {
    expect(todaysSeedDate(new Date('2026-07-25T02:00:00Z'))).toBe('2026-07-24')
  })
})

describe('parseTemplateFingerprint', () => {
  it('reads a stored fingerprint', () => {
    expect(
      parseTemplateFingerprint(
        '{"migrationsHash":"m","seedHash":"s","seedDate":"2026-07-25"}'
      )
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
    expect(
      planTemplateUsage({ ...current, seedHash: 'other' }, current).action
    ).toBe('rebuild')
  })

  it('migrates the copy when only the migrations changed', () => {
    expect(
      planTemplateUsage({ ...current, migrationsHash: 'older' }, current).action
    ).toBe('migrate')
  })

  it('copies a template seeded on another day', () => {
    expect(
      planTemplateUsage({ ...current, seedDate: '2026-07-24' }, current).action
    ).toBe('copy')
  })

  it('rebuilds a template seeded on another day when a fresh seed is asked for', () => {
    expect(
      planTemplateUsage({ ...current, seedDate: '2026-07-24' }, current, {
        freshSeed: true,
      }).action
    ).toBe('rebuild')
  })

  it('copies an up-to-date template', () => {
    expect(planTemplateUsage(current, current).action).toBe('copy')
  })

  it('copies an up-to-date migrations-only template', () => {
    const migrationsOnly = { migrationsHash: 'm' }
    expect(planTemplateUsage(migrationsOnly, migrationsOnly).action).toBe(
      'copy'
    )
  })
})

describe('hasStaleSeedDate', () => {
  const current = { migrationsHash: 'm', seedHash: 's', seedDate: '2026-07-25' }

  it('flags a template seeded on another day', () => {
    expect(
      hasStaleSeedDate({ ...current, seedDate: '2026-07-24' }, current)
    ).toBe(true)
  })

  it('ignores templates without a seed date', () => {
    expect(
      hasStaleSeedDate({ migrationsHash: 'm' }, { migrationsHash: 'm' })
    ).toBe(false)
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
    expect(laneProcessesFromLsofOutput(output, root)).toEqual([
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

  it('ignores sibling directories sharing the root as a prefix', () => {
    const output = 'p123\nfcwd\nn/Users/dev/app-worktrees-archive/task-a\n'
    expect(laneProcessesFromLsofOutput(output, root)).toEqual([])
  })

  it('returns nothing when lsof matched no processes', () => {
    expect(laneProcessesFromLsofOutput('', root)).toEqual([])
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
