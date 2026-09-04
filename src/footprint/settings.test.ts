import { describe, expect, it } from 'vitest'
import { guardedCommand, mergeManagedSettings } from './settings.js'

describe('mergeManagedSettings', () => {
  it('enforces the runtime keys and leaves foreign keys untouched', () => {
    const merged = mergeManagedSettings({
      model: 'claude-3-haiku',
      somethingProjectOwned: { keep: true },
    })
    expect(merged.model).toBe('fable[1m]')
    expect(merged.effortLevel).toBe('high')
    expect(merged.alwaysThinkingEnabled).toBe(true)
    expect(merged.autoCompactEnabled).toBe(false)
    expect(merged.autoMemoryEnabled).toBe(false)
    expect(merged.skillListingBudgetFraction).toBe(0.02)
    expect(merged.somethingProjectOwned).toEqual({ keep: true })
  })

  it('manages only the permission default, keeping personal lists intact', () => {
    const merged = mergeManagedSettings({
      permissions: { defaultMode: 'plan', allow: ['Bash(ls:*)'] },
    })
    expect(merged.permissions).toEqual({
      defaultMode: 'auto',
      allow: ['Bash(ls:*)'],
    })
  })

  it('wires the status line and the three hooks with absence guards', () => {
    const merged = mergeManagedSettings({})
    expect(merged.statusLine).toEqual({
      type: 'command',
      command: guardedCommand('.claude/statusline.sh'),
    })
    const hooks = merged.hooks as Record<string, unknown[]>
    expect(hooks.PreToolUse).toHaveLength(2)
    expect(hooks.SessionEnd).toHaveLength(1)
    expect(guardedCommand('.claude/hooks/block-git-stash.sh')).toBe(
      '[ -x "$CLAUDE_PROJECT_DIR"/.claude/hooks/block-git-stash.sh ] && exec "$CLAUDE_PROJECT_DIR"/.claude/hooks/block-git-stash.sh; exit 0',
    )
  })

  it("replaces a stale managed hook entry but keeps the project's own hooks", () => {
    const merged = mergeManagedSettings({
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [
              { type: 'command', command: 'old .claude/hooks/block-git-stash.sh call' },
            ],
          },
          {
            matcher: 'Bash',
            hooks: [
              { type: 'command', command: 'python3 .claude/hooks/project-own-hook.py' },
            ],
          },
        ],
      },
    })
    const preToolUse = (merged.hooks as Record<string, unknown[]>).PreToolUse
    const commands = JSON.stringify(preToolUse)
    expect(commands).toContain('project-own-hook.py')
    expect(commands).not.toContain('old .claude/hooks/block-git-stash.sh call')
    // one managed stash blocker, one managed isolation guard, one project hook
    expect(preToolUse).toHaveLength(3)
  })

  it('is idempotent', () => {
    const once = mergeManagedSettings({ permissions: { allow: ['X'] } })
    const twice = mergeManagedSettings(once)
    expect(twice).toEqual(once)
  })
})
