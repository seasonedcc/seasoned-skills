import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SeasonedSkillsConfig } from '../config/types.js'
import { checkTarget, deriveChecks, renderReport, runChecks } from './doctor.js'

const base = {
  projectName: 'consumer',
  contentDir: 'workflow-content',
  mergeStrategy: 'merge-commit',
  outOfScopeFindings: 'bank',
  release: { target: 'published-package', packages: ['consumer'] },
  gates: { lint: 'lint', typecheck: 'typecheck', unit: 'test', full: ['test'] },
  calibrationFile: 'calibration.md',
} as unknown as SeasonedSkillsConfig

const WHISPER_VOICE_ACTIVITY_MODEL = join(
  homedir(),
  '.cache',
  'whisper-cpp',
  'ggml-silero-v5.1.2.bin',
)
const NARRATION_WEIGHTS = '.claude/skills/demo-videos/scripts/models'

describe('doctor', () => {
  it('derives the core checklist from any configuration', () => {
    expect(deriveChecks(base).map(checkTarget)).toEqual([
      'git',
      'gh',
      'jq',
      'python3',
      'whisper-cli',
      join(homedir(), '.cache', 'whisper-cpp', 'ggml-large-v3.bin'),
      WHISPER_VOICE_ACTIVITY_MODEL,
      'uv',
      'ffmpeg',
      NARRATION_WEIGHTS,
    ])
  })

  it('checks the pinned voice-activity model beside the decode model', () => {
    const check = deriveChecks(base).find(
      (candidate) => checkTarget(candidate) === WHISPER_VOICE_ACTIVITY_MODEL,
    )
    expect(check).toEqual({
      file: WHISPER_VOICE_ACTIVITY_MODEL,
      reason: expect.stringContaining('voice-activity detection'),
      hint: expect.stringContaining('download-vad-model.sh'),
    })
  })

  it('checks the narration weights where the demo-videos setup caches them', () => {
    const check = deriveChecks(base).find(
      (candidate) => checkTarget(candidate) === NARRATION_WEIGHTS,
    )
    expect(check).toEqual({
      file: NARRATION_WEIGHTS,
      reason: expect.stringContaining('weights the package never ships'),
      hint: expect.stringContaining('setup.sh'),
    })
  })

  it('adds agent-browser only where a web surface exists', () => {
    const web = {
      ...base,
      webSurface: { coverageRegister: 'coverage.md', excusedSurfaces: [] },
    } as unknown as SeasonedSkillsConfig
    expect(deriveChecks(web).map(checkTarget)).toContain('agent-browser')
    expect(deriveChecks(base).map(checkTarget)).not.toContain('agent-browser')
  })

  it('derives service and cache-store checks from the provisioning table', () => {
    const provisioned = {
      ...base,
      provisioning: {
        services: ['postgres'],
        repositories: [{ path: '.' }, { path: '../engine', cacheStoreIndex: true }],
      },
    } as unknown as SeasonedSkillsConfig
    const binaries = deriveChecks(provisioned).map(checkTarget)
    expect(binaries).toContain('docker')
    expect(binaries).toContain('redis-cli')
  })

  it('derives the service check from a custom start command', () => {
    const provisioned = {
      ...base,
      provisioning: { services: ['postgres'], serviceStartCommand: 'podman compose up' },
    } as unknown as SeasonedSkillsConfig
    const binaries = deriveChecks(provisioned).map(checkTarget)
    expect(binaries).toContain('podman')
    expect(binaries).not.toContain('redis-cli')
  })

  it('carries the machine prerequisites the project declares', () => {
    const declaring = {
      ...base,
      machinePrerequisites: [
        {
          binary: 'pandoc',
          reason: 'the handbook renders with pandoc',
          hint: 'brew install pandoc',
        },
      ],
    } as unknown as SeasonedSkillsConfig
    const checks = deriveChecks(declaring)
    expect(checks.map(checkTarget)).toContain('pandoc')
    expect(checks.at(-1)).toEqual({
      binary: 'pandoc',
      reason: 'the handbook renders with pandoc',
      hint: 'brew install pandoc',
    })
  })

  it('checks a pinned model file by presence rather than by version', () => {
    const root = mkdtempSync(join(tmpdir(), 'seasoned-skills-doctor-'))
    try {
      const present = join(root, 'model.bin')
      writeFileSync(present, '')
      const check = { file: present, reason: 'a test needs it', hint: 'download it' }
      expect(runChecks([check])[0]).toEqual({ check, ok: true })
      const absent = { file: join(root, 'absent.bin'), reason: 'r', hint: 'h' }
      expect(runChecks([absent])[0]).toEqual({ check: absent, ok: false })
      expect(renderReport(runChecks([absent]))).toContain(`✗ ${absent.file}`)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('asks a tool for its version the way that tool spells the flag', () => {
    const findings = runChecks([
      { binary: 'git', reason: 'r', hint: 'h', versionFlag: '--bogus-flag' },
    ])
    expect(findings[0]?.ok).toBe(false)
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
      deriveChecks(base).filter((check) => checkTarget(check) === 'git'),
    )
    expect(findings[0]?.ok).toBe(true)
    expect(findings[0]?.version).toContain('git version')
  })
})
