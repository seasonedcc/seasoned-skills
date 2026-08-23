import { describe, expect, it } from 'vitest'
import {
  enumerateSurfaces,
  routeId,
  seedCoverage,
  seedCoverageFailures,
} from './seed-coverage.js'

const routes = [
  { file: 'routes/home.tsx' },
  {
    file: 'routes/projects/layout.tsx',
    children: [
      { file: 'routes/projects/index.ts', index: true },
      { path: 'board', file: 'routes/projects/board.tsx' },
      {
        path: 'settings',
        file: 'routes/projects/settings/layout.tsx',
        children: [
          { path: 'notifications', file: 'routes/projects/settings/notifications.tsx' },
        ],
      },
    ],
  },
  { path: 'internal/tools', file: 'routes/internal/tools.tsx' },
]

describe('surface enumeration', () => {
  it('derives ids from module paths without extensions', () => {
    expect(routeId('routes/projects/board.tsx')).toBe('routes/projects/board')
    expect(routeId('routes/projects/index.ts')).toBe('routes/projects/index')
  })

  it('keeps dotted flat-route ids intact and stays idempotent', () => {
    expect(routeId('routes/concerts.trending.tsx')).toBe('routes/concerts.trending')
    expect(routeId('routes/concerts.trending')).toBe('routes/concerts.trending')
  })

  it('strips a leading ./ from the module path', () => {
    expect(routeId('./routes/x.tsx')).toBe('routes/x')
  })

  it('lists leaf surfaces and skips layouts', () => {
    expect(enumerateSurfaces(routes)).toEqual([
      'routes/home',
      'routes/internal/tools',
      'routes/projects/board',
      'routes/projects/index',
      'routes/projects/settings/notifications',
    ])
  })

  it('treats an entry with an empty children list as a layout', () => {
    expect(
      enumerateSurfaces([{ file: 'routes/projects/layout.tsx', children: [] }]),
    ).toEqual([])
  })
})

describe('seed coverage derivation', () => {
  it('reports every surface no claim covers', () => {
    const report = seedCoverage({
      routes,
      claims: ['routes/home', 'routes/projects/board'],
      excludedPrefixes: ['routes/internal/'],
    })
    expect(report.unclaimed).toEqual([
      'routes/projects/index',
      'routes/projects/settings/notifications',
    ])
    expect(report.unknownClaims).toEqual([])
    expect(report.staleExcludedPrefixes).toEqual([])
  })

  it('normalizes claims carrying extensions', () => {
    const report = seedCoverage({
      routes: [{ file: 'routes/home.tsx' }],
      claims: ['routes/home.tsx'],
    })
    expect(report.unclaimed).toEqual([])
  })

  it('reports claims pointing at surfaces the routes no longer declare', () => {
    const report = seedCoverage({
      routes: [{ file: 'routes/home.tsx' }],
      claims: ['routes/home', 'routes/retired/page'],
    })
    expect(report.unknownClaims).toEqual(['routes/retired/page'])
  })

  it('excludes at path boundaries, never by raw string prefix', () => {
    const report = seedCoverage({
      routes: [
        { file: 'routes/internal.tsx' },
        { file: 'routes/internal/tools.tsx' },
        { file: 'routes/internals-dashboard.tsx' },
      ],
      claims: [],
      excludedPrefixes: ['routes/internal'],
    })
    expect(report.unclaimed).toEqual(['routes/internals-dashboard'])
    expect(report.staleExcludedPrefixes).toEqual([])
  })

  it('reports an excluded prefix matching no route as stale', () => {
    const report = seedCoverage({
      routes: [{ file: 'routes/home.tsx' }],
      claims: ['routes/home'],
      excludedPrefixes: ['routes/internol'],
    })
    expect(report.staleExcludedPrefixes).toEqual(['routes/internol'])
    const failures = seedCoverageFailures(report)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('routes/internol')
    expect(failures[0]).toContain('matches no route')
  })

  it('holds an empty route config to an empty manifest', () => {
    const report = seedCoverage({ routes: [], claims: [] })
    expect(report.surfaces).toEqual([])
    expect(seedCoverageFailures(report)).toEqual([])
  })

  it('phrases one failure per defect with the fix named', () => {
    const failures = seedCoverageFailures(
      seedCoverage({
        routes: [{ file: 'routes/home.tsx' }],
        claims: ['routes/retired/page'],
      }),
    )
    expect(failures).toHaveLength(2)
    expect(failures[0]).toContain('routes/home')
    expect(failures[0]).toContain('declare it unseedable')
    expect(failures[1]).toContain('routes/retired/page')
    expect(failures[1]).toContain('no longer declares')
  })
})
