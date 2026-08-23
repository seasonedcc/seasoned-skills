import { describe, expect, it } from 'vitest'
import type { SeasonedSkillsConfig } from '../config/types.js'
import { deriveChecks, renderReport, runChecks } from './doctor.js'

const base = {
  projectName: 'consumer',
  contentDir: 'workflow-content',
  mergeStrategy: 'merge-commit',
  outOfScopeFindings: 'bank',
  release: { target: 'published-package', packages: ['consumer'] },
  gates: { lint: 'lint', typecheck: 'typecheck', unit: 'test', full: ['test'] },
  calibrationFile: 'calibration.md',
} as unknown as SeasonedSkillsConfig

describe('doctor', () => {
  it('derives the core checklist from any configuration', () => {
    const binaries = deriveChecks(base).map((check) => check.binary)
    expect(binaries).toEqual(['git', 'gh', 'jq', 'python3'])
  })

  it('adds agent-browser and ffmpeg only where a web surface exists', () => {
    const web = {
      ...base,
      webSurface: { coverageRegister: 'coverage.md', excusedSurfaces: [] },
    } as unknown as SeasonedSkillsConfig
    const binaries = deriveChecks(web).map((check) => check.binary)
    expect(binaries).toContain('agent-browser')
    expect(binaries).toContain('ffmpeg')
  })

  it('derives service and cache-store checks from the provisioning table', () => {
    const provisioned = {
      ...base,
      provisioning: { services: ['postgres'], cacheStoreIndex: true },
    } as unknown as SeasonedSkillsConfig
    const binaries = deriveChecks(provisioned).map((check) => check.binary)
    expect(binaries).toContain('docker')
    expect(binaries).toContain('redis-cli')
  })

  it('derives the service check from a custom start command', () => {
    const provisioned = {
      ...base,
      provisioning: { services: ['postgres'], serviceStartCommand: 'podman compose up' },
    } as unknown as SeasonedSkillsConfig
    const binaries = deriveChecks(provisioned).map((check) => check.binary)
    expect(binaries).toContain('podman')
    expect(binaries).not.toContain('redis-cli')
  })

  it('reports a missing binary with its reason and install pointer', () => {
    const findings = runChecks([
      {
        binary: 'definitely-not-installed-anywhere',
        reason: 'a test needs it',
        hint: 'install it somehow',
      },
    ])
    expect(findings[0]?.ok).toBe(false)
    const report = renderReport(findings)
    expect(report).toContain('✗ definitely-not-installed-anywhere')
    expect(report).toContain('a test needs it')
    expect(report).toContain('install it somehow')
    expect(report).toContain('advisory')
  })

  it('finds a binary that exists and reads its version', () => {
    const findings = runChecks(
      deriveChecks(base).filter((check) => check.binary === 'git'),
    )
    expect(findings[0]?.ok).toBe(true)
    expect(findings[0]?.version).toContain('git version')
  })
})
