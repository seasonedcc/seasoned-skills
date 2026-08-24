import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SeasonedSkillsConfig } from '../config/types.js'

/**
 * Doctor: the machine-prerequisite checklist, derived from the configuration
 * — every enabled layer and skill declares the binaries it depends on, and
 * project content declares its extras as project facts — then checked for
 * presence and version, with install pointers for what is missing. It is
 * advisory everywhere: it never blocks an install or a sync; enforcement lives
 * in the gates that need the tools, which fail loudly on their own.
 */
export interface BinaryCheck {
  binary: string
  reason: string
  hint: string
  /** The flag that prints the version, for a tool that does not answer `--version`. */
  versionFlag?: string
}

/** A prerequisite that is a file on this machine rather than a binary on the PATH. */
export interface FileCheck {
  file: string
  reason: string
  hint: string
}

export type DoctorCheck = BinaryCheck | FileCheck

export interface DoctorFinding {
  check: DoctorCheck
  ok: boolean
  version?: string
}

/** What a check is about, for the report and for anything listing the checklist. */
export function checkTarget(check: DoctorCheck): string {
  return 'file' in check ? check.file : check.binary
}

const WHISPER_MODEL = join(homedir(), '.cache', 'whisper-cpp', 'ggml-large-v3.bin')
const WHISPER_VOICE_ACTIVITY_MODEL = join(
  homedir(),
  '.cache',
  'whisper-cpp',
  'ggml-silero-v5.1.2.bin',
)
const NARRATION_WEIGHTS = '.claude/skills/demo-videos/scripts/models'

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
    {
      binary: 'whisper-cli',
      reason: 'meeting transcription decodes every recording with whisper.cpp',
      hint: 'brew install whisper-cpp',
    },
    {
      file: WHISPER_MODEL,
      reason:
        'meeting transcription is pinned to the ggml-large-v3 model, so every machine hears the same words',
      hint: "fetch ggml-large-v3 with whisper.cpp's models/download-ggml-model.sh and keep it at this path",
    },
    {
      file: WHISPER_VOICE_ACTIVITY_MODEL,
      reason:
        'a degenerate decode is re-run behind voice-activity detection, pinned to the silero-v5.1.2 model',
      hint: "fetch ggml-silero-v5.1.2 with whisper.cpp's models/download-vad-model.sh and keep it at this path",
    },
    {
      binary: 'uv',
      reason: "the demo-video narrator's virtualenv and dependencies are built with uv",
      hint: 'https://docs.astral.sh/uv/getting-started/installation/',
    },
    {
      binary: 'ffmpeg',
      reason:
        'the demo-video rig retimes narration and assembles its recordings with ffmpeg',
      hint: 'brew install ffmpeg',
      versionFlag: '-version',
    },
    {
      file: NARRATION_WEIGHTS,
      reason:
        "the demo-video narrator speaks from model weights the package never ships — the skill's own setup step caches them beside its generated scripts",
      hint: 'run .claude/skills/demo-videos/scripts/setup.sh once on this machine',
    },
  ]
  if (config.webSurface) {
    checks.push({
      binary: 'agent-browser',
      reason: 'browser verification and the browser sweep drive the agent-browser CLI',
      hint: 'npm install -g agent-browser',
    })
  }
  if (config.provisioning?.services?.length) {
    const [starter] = (config.provisioning.serviceStartCommand ?? 'docker compose up -d')
      .trim()
      .split(/\s+/)
    if (starter) {
      checks.push({
        binary: starter,
        reason: `provisioning starts absent shared services with \`${starter}\``,
        hint: 'install it, or declare provisioning.serviceStartCommand',
      })
    }
  }
  if (
    config.provisioning?.repositories?.some((repository) => repository.cacheStoreIndex)
  ) {
    checks.push({
      binary: 'redis-cli',
      reason: 'provisioning flushes recycled lane cache-store indexes with redis-cli',
      hint: 'brew install redis',
    })
  }
  checks.push(...(config.machinePrerequisites ?? []))
  return checks
}

export function runChecks(checks: DoctorCheck[]): DoctorFinding[] {
  return checks.map((check) => {
    if ('file' in check) return { check, ok: existsSync(check.file) }
    const result = spawnSync(check.binary, [check.versionFlag ?? '--version'], {
      encoding: 'utf8',
    })
    if (result.error || result.status !== 0) return { check, ok: false }
    const version = `${result.stdout}${result.stderr}`.split('\n')[0]?.trim()
    return version ? { check, ok: true, version } : { check, ok: true }
  })
}

export function renderReport(findings: DoctorFinding[]): string {
  const lines = findings.map((finding) =>
    finding.ok
      ? `✓ ${checkTarget(finding.check)} — ${finding.version ?? 'present'}`
      : `✗ ${checkTarget(finding.check)} — missing. Needed because ${finding.check.reason}. Install: ${finding.check.hint}`,
  )
  const missing = findings.filter((finding) => !finding.ok).length
  lines.push(
    missing === 0
      ? 'Everything the configured workflow depends on is present.'
      : `${missing} missing. Doctor is advisory — nothing is blocked, but the gates that need these tools will fail until they are installed.`,
  )
  return lines.join('\n')
}
