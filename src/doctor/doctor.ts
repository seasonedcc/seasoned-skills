import { spawnSync } from 'node:child_process'
import type { SeasonedSkillsConfig } from '../config/types.js'

/**
 * Doctor: the machine-prerequisite checklist, derived from the configuration
 * — every enabled layer and skill declares the binaries it depends on — then
 * checked for presence and version, with install pointers for what is
 * missing. It is advisory everywhere: it never blocks an install or a sync;
 * enforcement lives in the gates that need the tools, which fail loudly on
 * their own.
 */
export interface DoctorCheck {
  binary: string
  reason: string
  hint: string
}

export interface DoctorFinding {
  check: DoctorCheck
  ok: boolean
  version?: string
}

export function deriveChecks(config: SeasonedSkillsConfig): DoctorCheck[] {
  const checks: DoctorCheck[] = [
    {
      binary: 'git',
      reason:
        'every workflow operation — worktrees, branches, the managed gitignore — runs through git',
      hint: 'https://git-scm.com/downloads',
    },
    {
      binary: 'gh',
      reason:
        'the review skills and self-improvement lessons act on pull requests and issues',
      hint: 'brew install gh (https://cli.github.com)',
    },
    {
      binary: 'jq',
      reason: 'the status-line script parses session state with jq',
      hint: 'brew install jq',
    },
    {
      binary: 'python3',
      reason: 'the subagent watchdog and meeting-request verification run on Python 3',
      hint: 'https://www.python.org/downloads',
    },
  ]
  if (config.webSurface) {
    checks.push({
      binary: 'agent-browser',
      reason: 'browser verification and the browser sweep drive the agent-browser CLI',
      hint: 'npm install -g agent-browser',
    })
  }
  return checks
}

export function runChecks(checks: DoctorCheck[]): DoctorFinding[] {
  return checks.map((check) => {
    const result = spawnSync(check.binary, ['--version'], { encoding: 'utf8' })
    if (result.error || result.status !== 0) return { check, ok: false }
    const version = `${result.stdout}${result.stderr}`.split('\n')[0]?.trim()
    return version ? { check, ok: true, version } : { check, ok: true }
  })
}

export function renderReport(findings: DoctorFinding[]): string {
  const lines = findings.map((finding) =>
    finding.ok
      ? `✓ ${finding.check.binary} — ${finding.version ?? 'present'}`
      : `✗ ${finding.check.binary} — missing. Needed because ${finding.check.reason}. Install: ${finding.check.hint}`,
  )
  const missing = findings.filter((finding) => !finding.ok).length
  lines.push(
    missing === 0
      ? 'Everything the configured workflow depends on is present.'
      : `${missing} missing. Doctor is advisory — nothing is blocked, but the gates that need these tools will fail until they are installed.`,
  )
  return lines.join('\n')
}
