import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * The settings footprint manager. The committed .claude/settings.json is
 * project-owned; the manager enforces exactly the workflow's keys — the
 * runtime assumptions, the skill-listing budget, the permission default (the
 * one permissions key it manages), the status line, and the shipped hooks'
 * wiring — and leaves every other key, including the project's own hook
 * registrations, untouched. Every managed key that points at a generated
 * path carries an absence guard, so a fresh clone that has not run the
 * install yet still works.
 */

/** Package-versioned runtime assumptions: tuning one is a release. */
export const MANAGED_RUNTIME_VALUES = {
  model: 'claude-fable-5[1m]',
  effortLevel: 'high',
  alwaysThinkingEnabled: true,
  autoCompactEnabled: false,
  autoMemoryEnabled: false,
  skillListingBudgetFraction: 0.02,
} as const

interface ManagedHook {
  event: string
  matcher?: string
  script: string
  timeout: number
}

const MANAGED_HOOKS: ManagedHook[] = [
  {
    event: 'PreToolUse',
    matcher: 'Bash',
    script: '.claude/hooks/block-git-stash.sh',
    timeout: 10,
  },
  {
    event: 'PreToolUse',
    matcher: 'Agent',
    script: '.claude/hooks/isolation-guard.sh',
    timeout: 10,
  },
  { event: 'SessionEnd', script: '.claude/hooks/session-end-sweep.sh', timeout: 60 },
]

const STATUS_LINE_SCRIPT = '.claude/statusline.sh'

/** Wraps a generated script so its absence never breaks the session. */
export function guardedCommand(script: string): string {
  const path = `"$CLAUDE_PROJECT_DIR"/${script}`
  return `[ -x ${path} ] && exec ${path}; exit 0`
}

type SettingsObject = Record<string, unknown>

export function mergeManagedSettings(existing: SettingsObject): SettingsObject {
  const settings: SettingsObject = {
    $schema: 'https://json.schemastore.org/claude-code-settings.json',
    ...existing,
    ...MANAGED_RUNTIME_VALUES,
  }

  const permissions = isObject(settings.permissions) ? { ...settings.permissions } : {}
  permissions.defaultMode = 'auto'
  settings.permissions = permissions

  settings.statusLine = {
    type: 'command',
    command: guardedCommand(STATUS_LINE_SCRIPT),
  }

  const hooks = isObject(settings.hooks) ? { ...settings.hooks } : {}
  for (const managed of MANAGED_HOOKS) {
    const groups = Array.isArray(hooks[managed.event])
      ? (hooks[managed.event] as unknown[])
      : []
    const kept = groups.filter((group) => !groupReferencesScript(group, managed.script))
    kept.push({
      ...(managed.matcher !== undefined && { matcher: managed.matcher }),
      hooks: [
        {
          type: 'command',
          command: guardedCommand(managed.script),
          timeout: managed.timeout,
        },
      ],
    })
    hooks[managed.event] = kept
  }
  settings.hooks = hooks

  return settings
}

export function applyManagedSettings(projectRoot: string): { path: string } {
  const path = join(projectRoot, '.claude', 'settings.json')
  let existing: SettingsObject = {}
  if (existsSync(path)) {
    const raw = readFileSync(path, 'utf8')
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error(`${path} is not valid JSON — fix it before running sync`)
    }
    if (!isObject(parsed)) {
      throw new Error(`${path} must contain a JSON object`)
    }
    existing = parsed
  }
  const merged = mergeManagedSettings(existing)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`)
  return { path }
}

function groupReferencesScript(group: unknown, script: string): boolean {
  if (!isObject(group) || !Array.isArray(group.hooks)) return false
  return group.hooks.some(
    (hook) =>
      isObject(hook) && typeof hook.command === 'string' && hook.command.includes(script),
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
