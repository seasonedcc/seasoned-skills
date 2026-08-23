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
    file: 'routes/care/layout.tsx',
    children: [
      { file: 'routes/care/index.ts', index: true },
      { path: 'plan', file: 'routes/care/plan.tsx' },
      {
        path: 'settings',
        file: 'routes/care/settings/layout.tsx',
        children: [{ path: 'personal-data', file: 'routes/care/settings/personal.tsx' }],
      },
    ],
  },
  { path: 'internal/tools', file: 'routes/internal/tools.tsx' },
]

describe('surface enumeration', () => {
  it('derives ids from module paths without extensions', () => {
    expect(routeId('routes/care/plan.tsx')).toBe('routes/care/plan')
    expect(routeId('routes/care/index.ts')).toBe('routes/care/index')
  })

  it('lists leaf surfaces and skips layouts', () => {
    expect(enumerateSurfaces(routes)).toEqual([
      'routes/care/index',
      'routes/care/plan',
      'routes/care/settings/personal',
      'routes/home',
      'routes/internal/tools',
    ])
  })
})

describe('seed coverage derivation', () => {
  it('reports every surface no claim covers', () => {
    const report = seedCoverage({
      routes,
      claims: ['routes/home', 'routes/care/plan'],
      excludedPrefixes: ['routes/internal/'],
    })
    expect(report.unclaimed).toEqual([
      'routes/care/index',
      'routes/care/settings/personal',
    ])
    expect(report.unknownClaims).toEqual([])
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
