import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const hooks = fileURLToPath(new URL('../../runtime/hooks/', import.meta.url))

const commandLine = fileURLToPath(new URL('../../src/cli/index.ts', import.meta.url))

const typescriptSourceLoader = fileURLToPath(
  new URL('./typescript-source-loader.mjs', import.meta.url),
)

function runHook(script: string, command: string) {
  const result = spawnSync(join(hooks, script), {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8',
    timeout: 10_000,
  })
  return { exitCode: result.status, stderr: result.stderr }
}

const guard = (command: string) => runHook('ledger-write-guard.sh', command)
const stashHook = (command: string) => runHook('block-git-stash.sh', command)

const lines = (...text: string[]) => text.join('\n')

const finding = lines(
  "pnpm exec seasoned-skills ledger finding --as sqlite-research --source 'node -e on Node 22.22' <<'ENTRY'",
  'node:sqlite prints an ExperimentalWarning on every run on Node 22; Node 24.21 prints none.',
  'ENTRY',
)

const progress = (text: string, writer = 'orchestrator') =>
  lines(
    `pnpm exec seasoned-skills ledger progress --as ${writer} <<'ENTRY'`,
    text,
    'ENTRY',
  )

const unquotedProgress = progress('Next: $(gh pr merge 12)').replace(
  "<<'ENTRY'",
  '<<ENTRY',
)

describe('the ledger write guard', () => {
  const refusedWith = (command: string, reason: string) => {
    const { exitCode, stderr } = guard(command)
    expect(exitCode).toBe(2)
    expect(stderr).toContain(reason)
    expect(stderr).toContain(
      "pnpm exec seasoned-skills ledger finding --as <writer> --source '<where>' <<'ENTRY'",
    )
  }

  const passes = (command: string) => {
    expect(guard(command)).toEqual({ exitCode: 0, stderr: '' })
  }

  describe('lets through', () => {
    it("a write whose text arrives through <<'ENTRY' and ends the command", () => {
      passes(finding)
      passes(`${finding}\n`)
    })

    it('a write preceded by a change of directory', () => {
      passes(
        lines(
          "cd /work/project && pnpm exec seasoned-skills ledger decision --as orchestrator --by person --replaces 47 <<'ENTRY'",
          'Every agent in the session writes to the same record.',
          'ENTRY',
        ),
      )
    })

    it('a write through npx or through the binary itself', () => {
      passes(progress('Pushed 4e1a2c0.').replace('pnpm exec', 'npx'))
      passes(
        progress('Pushed 4e1a2c0.').replace(
          'pnpm exec seasoned-skills',
          'node bin/seasoned-skills.js',
        ),
      )
    })

    it('a write behind a wrapper, or through the command line source', () => {
      passes(`timeout 30 ${finding}`)
      passes(
        finding.replace(
          'pnpm exec seasoned-skills',
          'node --experimental-transform-types src/cli/index.ts',
        ),
      )
    })

    it('an entry whose text the shell would expand anywhere else', () => {
      passes(
        progress(
          lines(
            'Next: $(git push origin main) and `gh pr merge 12`',
            "it's #418 again; && || | ; ENTRY's neighbor",
            '<<EOF',
          ),
        ),
      )
    })

    it('a write after arithmetic, a subshell, or a parameter expansion', () => {
      passes(lines('for (( i = 0; i < 3; i++ )); do echo "$i"; done', finding))
      passes(lines('((cd lane && git status); (git log -1))', finding))
      passes(`echo "\${x:-'}'}" && ${finding}`)
    })

    it('a single-quoted source holding a $', () => {
      passes(finding.replace("'node -e on Node 22.22'", "'git log printed $SHA'"))
    })

    it('a commit message or a pull request body that only mentions a write', () => {
      passes(
        lines(
          `git commit -m "$(cat <<'EOF'`,
          'Teach agents to run: pnpm exec seasoned-skills ledger decision --as orchestrator --by person',
          'EOF',
          ')"',
        ),
      )
      passes(
        'gh pr create --title "Ledger" --body "echo x | pnpm exec seasoned-skills ledger progress --as orchestrator is refused"',
      )
      passes('echo "pnpm exec seasoned-skills ledger finding --as reviewer"')
      passes(
        lines(
          "gh pr comment 12 --body-file - <<'EOF'",
          'Refused: $(echo x | pnpm exec seasoned-skills ledger progress --as orchestrator)',
          'EOF',
        ),
      )
      passes(
        lines(
          'cat <<EOF',
          'Refused: \\$(echo x | pnpm exec seasoned-skills ledger progress --as orchestrator)',
          'EOF',
        ),
      )
    })

    it('help on a write command', () => {
      passes('pnpm exec seasoned-skills ledger finding --help')
      passes('pnpm exec seasoned-skills ledger progress -h')
      passes('pnpm exec seasoned-skills ledger decision --as orchestrator --help')
    })

    it('the reads, and every other command', () => {
      passes('pnpm exec seasoned-skills ledger')
      passes('pnpm exec seasoned-skills ledger search busy timeout "#418"')
      passes(
        'pnpm exec seasoned-skills ledger show 47 --session 1b2c3d4e-0000-0000-0000-000000000000',
      )
      passes('pnpm exec seasoned-skills ledger print > ledger.txt')
      passes(lines('# check what is in force', 'pnpm exec seasoned-skills ledger'))
      passes('git status # what changed')
      passes(lines("cat <<'ENTRY'", 'pnpm exec seasoned-skills ledger progress', 'ENTRY'))
    })
  })

  describe('refuses', () => {
    it('a second ledger write in the same command', () => {
      const reason = 'more than one ledger write'
      refusedWith(`${progress('one')}\n${progress('two')}`, reason)
      refusedWith(
        `pnpm exec seasoned-skills ledger progress --as orchestrator && ${progress('two')}`,
        reason,
      )
    })

    it('anything after the write on its line', () => {
      refusedWith(
        progress('Pushed.').replace("<<'ENTRY'", "<<'ENTRY' && git push"),
        'something follows the ledger write',
      )
      refusedWith(
        progress('Pushed.').replace("<<'ENTRY'", "<<'ENTRY' | tee note.txt"),
        'something follows the ledger write',
      )
    })

    it('anything after the closing ENTRY line', () => {
      refusedWith(
        `${progress('Pushed.')}\ngit push`,
        'something follows the ledger write',
      )
    })

    it('an entry holding a line that is exactly ENTRY, which closes it early', () => {
      refusedWith(
        progress(lines('Next steps:', 'ENTRY', 'gh pr merge 12 --squash')),
        'that line closed the heredoc early',
      )
    })

    it('a write inside a command substitution', () => {
      refusedWith(
        `result=$(${progress('Pushed.')}\n)`,
        'something follows the ledger write',
      )
    })

    it("text that does not arrive through <<'ENTRY'", () => {
      const reason = "the entry's text must arrive through <<'ENTRY'"
      refusedWith(
        'echo "Pushed $(git rev-parse HEAD)" | pnpm exec seasoned-skills ledger progress --as orchestrator',
        reason,
      )
      refusedWith(`echo "Pushed $(git rev-parse HEAD)" | ${progress('Pushed.')}`, reason)
      refusedWith(progress('Pushed.').replace("<<'ENTRY'", '<<ENTRY'), reason)
      refusedWith(progress('Pushed.').replace("<<'ENTRY'", '<<"ENTRY"'), reason)
      refusedWith(progress('Pushed.').replace("<<'ENTRY'", "<<-'ENTRY'"), reason)
      refusedWith(progress('Pushed.').replace("<<'ENTRY'", "<<'NOTE'"), reason)
      refusedWith('pnpm exec seasoned-skills ledger progress --as orchestrator', reason)
      refusedWith(
        'pnpm exec seasoned-skills ledger progress --as orchestrator < note.txt',
        reason,
      )
      refusedWith(
        "pnpm exec seasoned-skills ledger progress --as orchestrator <<< 'Pushed.'",
        reason,
      )
      refusedWith(
        progress('Pushed.').replace("<<'ENTRY'", "<<'ENTRY' < note.txt"),
        reason,
      )
      refusedWith(
        progress('Pushed.').replace("<<'ENTRY'", "< note.txt <<'ENTRY'"),
        reason,
      )
      refusedWith(unquotedProgress.replace('--as orchestrator', '--help'), reason)
      refusedWith(
        'echo "Pushed $(git rev-parse HEAD)" | pnpm exec seasoned-skills ledger progress -h',
        reason,
      )
    })

    it("text that does not arrive through <<'ENTRY', however the write is spelled", () => {
      const reason = "the entry's text must arrive through <<'ENTRY'"
      const write = 'pnpm exec seasoned-skills ledger progress --as orchestrator'
      refusedWith(`NOTES=1 ${write}`, reason)
      refusedWith(`if ${write} < note.txt; then echo recorded; fi`, reason)
      refusedWith(`! ${write}`, reason)
      refusedWith(
        write.replace('seasoned-skills ledger', 'seasoned-skills -- ledger'),
        reason,
      )
      refusedWith(
        write.replace(
          'ledger progress',
          'ledger --session 1b2c3d4e-0000-0000-0000-000000000000 progress',
        ),
        reason,
      )
      refusedWith(write.replace('ledger progress', 'ledger \\\n  progress'), reason)
      refusedWith(lines('cat <<-EOF', '\tnotes', '\tEOF', unquotedProgress), reason)
    })

    it("text that does not arrive through <<'ENTRY', in an unquoted heredoc's substitution", () => {
      refusedWith(
        lines(
          'cat <<EOF',
          'Notes: $(echo "Pushed $(git rev-parse HEAD)" | pnpm exec seasoned-skills ledger progress --as orchestrator)',
          'EOF',
        ),
        "the entry's text must arrive through <<'ENTRY'",
      )
    })

    it("text that does not arrive through <<'ENTRY', after a double-quoted plain $", () => {
      const reason = "the entry's text must arrive through <<'ENTRY'"
      refusedWith(`grep -q "ready$" log && ${unquotedProgress}`, reason)
      refusedWith(`grep -q "ready$'" log; ${unquotedProgress}`, reason)
      refusedWith(
        'grep -q "ready$" log && echo Pushed $(git rev-parse HEAD) | pnpm exec seasoned-skills ledger progress --as orchestrator && echo "done"',
        reason,
      )
    })

    it("text that does not arrive through <<'ENTRY', after arithmetic or a parameter expansion", () => {
      const reason = "the entry's text must arrive through <<'ENTRY'"
      refusedWith(`(( shift = 1 << 3 ))\n${unquotedProgress}`, reason)
      refusedWith(
        lines(
          '(( x = 1 << 3 ))',
          'echo "$(date)" | pnpm exec seasoned-skills ledger progress --as orchestrator',
        ),
        reason,
      )
      refusedWith(`: \${x:-'}'}; ${unquotedProgress}`, reason)
      refusedWith(`echo "\${name:-it's}" && ${unquotedProgress}`, reason)
      refusedWith(`notes=$((cd /work && ${unquotedProgress}\n) )`, reason)
      refusedWith(`echo ${'$(('.repeat(40)}\n${unquotedProgress}`, reason)
      refusedWith(`echo $(( 1 << 3 ))\n${unquotedProgress}`, reason)
      refusedWith(`echo \${x:-\\}<<A}\n${unquotedProgress}`, reason)
      refusedWith(`echo \${x:-"}"<<A}\n${unquotedProgress}`, reason)
      refusedWith(`echo \${x:-\`echo }\`<<A}\n${unquotedProgress}`, reason)
    })

    it("text that does not arrive through <<'ENTRY', whatever runs the binary", () => {
      const reason = "the entry's text must arrive through <<'ENTRY'"
      const write = 'pnpm exec seasoned-skills ledger progress --as orchestrator'
      refusedWith(`timeout 30 ${unquotedProgress}`, reason)
      refusedWith(`corepack ${unquotedProgress}`, reason)
      refusedWith(unquotedProgress.replace('pnpm', '$PNPM'), reason)
      refusedWith(`echo "$(date)" | xargs ${write}`, reason)
      refusedWith(`timeout 10 ${write} < note.txt`, reason)
      refusedWith(
        unquotedProgress.replace(
          'pnpm exec seasoned-skills',
          'node --experimental-transform-types src/cli/index.ts',
        ),
        reason,
      )
      refusedWith(
        unquotedProgress.replace('pnpm exec seasoned-skills', 'node dist/cli/index.js'),
        reason,
      )
      refusedWith(
        unquotedProgress.replace(
          'pnpm exec seasoned-skills',
          'node bin/seasoned-skills.js',
        ),
        reason,
      )
      refusedWith(
        lines(
          "pnpm dlx seasoned-skills@1.2.3 ledger finding --as reviewer --source 'gh pr view 12' <<ENTRY",
          'Next: $(gh pr merge 12)',
          'ENTRY',
        ),
        reason,
      )
    })

    it("a write whose -h or --help is an option's value, not a request for help", () => {
      const reason = "the entry's text must arrive through <<'ENTRY'"
      refusedWith(
        'pnpm exec seasoned-skills ledger finding --as -h --source "ran $(touch x)"',
        reason,
      )
      refusedWith(
        lines(
          '{ pnpm exec seasoned-skills ledger finding --as r --source -h; } <<EOF',
          'Ran: $(touch x)',
          'EOF',
        ),
        reason,
      )
      refusedWith(
        'pnpm exec seasoned-skills ledger decision --as orchestrator --by --help --replaces -h',
        reason,
      )
      refusedWith(
        'pnpm exec seasoned-skills ledger --session -h progress --as orchestrator',
        reason,
      )
    })

    it('an entry that never closes', () => {
      refusedWith(
        lines(
          "pnpm exec seasoned-skills ledger progress --as orchestrator <<'ENTRY'",
          'Pushed.',
        ),
        'never closes',
      )
      refusedWith(
        lines(
          "notes=`pnpm exec seasoned-skills ledger progress --as orchestrator <<'ENTRY'",
          'Pushed.',
          'ENTRY`',
          'gh pr merge 12',
          'ENTRY',
        ),
        'never closes',
      )
    })

    it('a source holding a backtick or a $ outside single quotes', () => {
      const reason = '--source holds a backtick or a $ outside single quotes'
      refusedWith(
        finding.replace("'node -e on Node 22.22'", '"$(git log -1 --format=%h) printed"'),
        reason,
      )
      refusedWith(finding.replace("'node -e on Node 22.22'", '"`date`"'), reason)
      refusedWith(finding.replace("'node -e on Node 22.22'", '$HOME/notes'), reason)
      refusedWith(finding.replace("'node -e on Node 22.22'", '\\$HOME/notes'), reason)
      refusedWith(
        finding.replace("--source 'node -e on Node 22.22'", '--source="$PWD"'),
        reason,
      )
    })

    it('a ledger command with an unquoted word starting with #', () => {
      const refusedAsComment = (command: string) => {
        const { exitCode, stderr } = guard(command)
        expect(exitCode).toBe(2)
        expect(stderr).toContain('unquoted word starting with #')
        expect(stderr).toContain(
          'Write entry numbers bare: --replaces 47, ledger show 47.',
        )
      }
      refusedAsComment(
        lines(
          "pnpm exec seasoned-skills ledger decision --as orchestrator --by person --replaces #47 <<'ENTRY'",
          'git push origin main',
          'ENTRY',
        ),
      )
      refusedAsComment('pnpm exec seasoned-skills ledger show #47')
      refusedAsComment('pnpm exec seasoned-skills ledger search busy timeout #418')
    })
  })
})

describe('the stash hook', () => {
  const refused = (command: string) => expect(stashHook(command).exitCode).toBe(2)
  const allowed = (command: string) =>
    expect(stashHook(command)).toEqual({ exitCode: 0, stderr: '' })

  it('still refuses git stash, and lets other git commands through', () => {
    refused('git stash')
    refused('cd lane && git stash pop')
    allowed('git status')
  })

  it('refuses a git stash that shell punctuation ends or encloses', () => {
    refused('git stash; git pull')
    refused('git stash&&git pull')
    refused('git stash|cat')
    refused('git stash>stash.log')
    refused('echo $(git stash)')
    refused('(git stash)')
    refused('echo `git stash`')
    refused('true|git stash')
  })

  it('lets through words that merely start with stash', () => {
    allowed('git checkout stashes')
    allowed('git log --grep stashed')
  })

  it("records an entry that mentions git stash, since a ledger entry's text never runs", () => {
    allowed(progress('Never run git stash here: lanes share the stack.'))
  })

  it('still checks the line holding the entry, and every line after it', () => {
    refused(progress('Pushed.').replace("<<'ENTRY'", "<<'ENTRY' && git stash"))
    refused(`${progress('Pushed.')}\ngit stash`)
    refused(progress(lines('Pushed.', 'ENTRY', 'git stash')))
    refused(
      lines(
        "notes=`pnpm exec seasoned-skills ledger progress --as orchestrator <<'ENTRY'",
        'Pushed.',
        'ENTRY`',
        'git stash',
        'ENTRY',
      ),
    )
  })

  it('sees a git stash the shell runs past arithmetic, a parameter expansion, or a plain $', () => {
    refused(
      lines(
        "(( pnpm exec seasoned-skills ledger progress <<'ENTRY' ))",
        'git stash',
        'ENTRY',
      ),
    )
    refused(
      lines(
        `: \${x:-'}'} A'; pnpm exec seasoned-skills ledger progress --as orchestrator <<'ENTRY'`,
        "'; git stash #",
        'ENTRY',
      ),
    )
    refused(
      lines(
        `grep -q "x$" /dev/null; cat <<'EOF' >/dev/null`,
        `""; pnpm exec seasoned-skills ledger progress --as orchestrator <<'ENTRY'`,
        'EOF',
        'git stash',
        'ENTRY',
      ),
    )
  })

  it("reads every heredoc but a ledger entry's", () => {
    refused(lines("cat <<'ENTRY'", 'git stash', 'ENTRY'))
    refused(lines("cat > notes.sh <<'EOF'", 'git stash pop', 'EOF'))
    refused(
      lines("pnpm exec seasoned-skills ledger show 3 <<'ENTRY'", 'git stash', 'ENTRY'),
    )
  })

  it('refuses a git stash in a command too long for a pipe to hold', () => {
    refused(lines('git stash', `echo ${'x'.repeat(200_000)}`))
  })

  it('reads the whole command when the command reader cannot read it', () => {
    refused(`git stash\necho ${'$('.repeat(1000)}`)
  })
})

describe('the compaction hook', () => {
  let root: string
  let project: string
  let standIns: string
  let record: string

  const compact = (environment: Record<string, string>) => {
    const { CLAUDE_PROJECT_DIR: _, ...inherited } = process.env
    const result = spawnSync(join(hooks, 'ledger-after-compaction.sh'), {
      input: '{"session_id":"1b2c3d4e-0000-0000-0000-000000000000","source":"compact"}',
      encoding: 'utf8',
      env: {
        ...inherited,
        PATH: `${standIns}:${process.env.PATH}`,
        RECORD: record,
        ...environment,
      },
    })
    return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr }
  }

  const standInPnpm = (body: string) =>
    writeFileSync(
      join(standIns, 'pnpm'),
      lines(
        '#!/bin/sh',
        'printf "%s" "$*" > "$RECORD/arguments"',
        'pwd -P > "$RECORD/directory"',
        'printf "%s" "$COREPACK_ENABLE_DOWNLOAD_PROMPT" > "$RECORD/corepack"',
        'cat > "$RECORD/input"',
        body,
      ),
      { mode: 0o755 },
    )

  const recorded = (name: string) => readFileSync(join(record, name), 'utf8')

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'seasoned-skills-compaction-'))
    project = join(root, 'project')
    standIns = join(root, 'stand-ins')
    record = join(root, 'record')
    for (const directory of [project, standIns, record]) mkdirSync(directory)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it("pipes its payload to the ledger's hook mode from the project, and prints what it prints", () => {
    standInPnpm("echo 'In force (1 decision, newest first)'")
    expect(compact({ CLAUDE_PROJECT_DIR: project })).toEqual({
      exitCode: 0,
      stdout: 'In force (1 decision, newest first)\n',
      stderr: '',
    })
    expect(recorded('arguments')).toBe('exec seasoned-skills ledger --hook')
    expect(recorded('directory').trim()).toBe(
      spawnSync('pwd', ['-P'], { cwd: project, encoding: 'utf8' }).stdout.trim(),
    )
    expect(recorded('corepack')).toBe('0')
    expect(recorded('input')).toContain(
      '"session_id":"1b2c3d4e-0000-0000-0000-000000000000"',
    )
  })

  it('exits 0 when the ledger command fails', () => {
    standInPnpm('echo "error: unknown command" >&2; exit 1')
    expect(compact({ CLAUDE_PROJECT_DIR: project })).toEqual({
      exitCode: 0,
      stdout: '',
      stderr: '',
    })
  })

  it('prints nothing of a failed command, such as pnpm not finding the package', () => {
    standInPnpm(
      lines(
        'echo undefined',
        `echo ' ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command "seasoned-skills" not found'`,
        'exit 254',
      ),
    )
    expect(compact({ CLAUDE_PROJECT_DIR: project })).toEqual({
      exitCode: 0,
      stdout: '',
      stderr: '',
    })
  })

  it('exits 0 without running anything when the project directory is unset or missing', () => {
    standInPnpm('echo ran')
    expect(compact({})).toEqual({ exitCode: 0, stdout: '', stderr: '' })
    expect(compact({ CLAUDE_PROJECT_DIR: '' }).exitCode).toBe(0)
    expect(compact({ CLAUDE_PROJECT_DIR: join(root, 'missing') }).exitCode).toBe(0)
    expect(() => recorded('arguments')).toThrow()
  })
})

describe('the compaction hook, run against the real ledger', () => {
  const session = '1b2c3d4e-0000-4000-8000-000000000000'
  const decision =
    "Never merge without the person's word: not `gh pr merge`, not $(git push origin main)."
  let root: string
  let project: string
  let environment: NodeJS.ProcessEnv

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'seasoned-skills-compaction-ledger-'))
    project = join(root, 'project')
    mkdirSync(join(project, 'node_modules', '.bin'), { recursive: true })
    spawnSync('git', ['init', '--quiet'], { cwd: project })
    writeFileSync(join(project, 'package.json'), '{ "private": true }\n')
    writeFileSync(
      join(project, 'node_modules', '.bin', 'seasoned-skills'),
      lines(
        '#!/bin/sh',
        'exec "$NODE_BINARY" --experimental-transform-types --no-warnings --import "$SOURCE_LOADER" "$COMMAND_LINE" "$@"',
      ),
      { mode: 0o755 },
    )
    const { CLAUDE_PROJECT_DIR: _, ...inherited } = process.env
    environment = {
      ...inherited,
      CLAUDE_CONFIG_DIR: join(root, 'claude-config'),
      NODE_BINARY: process.execPath,
      SOURCE_LOADER: typescriptSourceLoader,
      COMMAND_LINE: commandLine,
    }
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const compact = (sessionId: string) => {
    const result = spawnSync(join(hooks, 'ledger-after-compaction.sh'), {
      input: JSON.stringify({ session_id: sessionId, source: 'compact' }),
      encoding: 'utf8',
      env: { ...environment, CLAUDE_PROJECT_DIR: project },
    })
    return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr }
  }

  it('puts a decision back word for word, from the session the payload names', {
    timeout: 30_000,
  }, () => {
    const written = spawnSync(
      'pnpm',
      'exec seasoned-skills ledger decision --as orchestrator --by person'.split(' '),
      {
        cwd: project,
        input: `${decision}\n`,
        encoding: 'utf8',
        env: { ...environment, CLAUDE_CODE_SESSION_ID: session },
      },
    )
    expect(written.stdout, written.stderr).toMatch(/^#1 decision, /)
    expect(existsSync(join(project, '.sessions', session, 'ledger.db'))).toBe(true)
    const { exitCode, stdout, stderr } = compact(session)
    expect(stdout).toMatch(/^In force: 1 decision, newest first\n/)
    expect(stdout).toContain(decision)
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' })
  })

  it('prints nothing for a session with no record, and creates none', {
    timeout: 30_000,
  }, () => {
    expect(compact(session)).toEqual({ exitCode: 0, stdout: '', stderr: '' })
    expect(existsSync(join(project, '.sessions'))).toBe(false)
  })
})
