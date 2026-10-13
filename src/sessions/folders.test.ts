import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  claudeProjectsDirectory,
  listSessionFolders,
  removeExpiredSessionFolders,
  sessionFolder,
} from './folders.js'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, readdirSync: vi.fn(actual.readdirSync) }
})

const { readdirSync: realReaddirSync } =
  await vi.importActual<typeof import('node:fs')>('node:fs')

const FIRST = '11111111-1111-4111-8111-111111111111'
const SECOND = '22222222-2222-4222-8222-222222222222'
const EXPIRED = '33333333-3333-4333-8333-333333333333'

describe('session folders', () => {
  let scratch: string
  let main: string
  let projects: string

  beforeEach(() => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'seasoned-skills-sessions-')))
    main = repository(join(scratch, 'project'))
    projects = join(scratch, 'claude', 'projects')
  })

  afterEach(() => {
    vi.mocked(readdirSync).mockImplementation(realReaddirSync)
    for (const directory of [join(projects, '-locked'), join(main, '.sessions')]) {
      if (existsSync(directory)) chmodSync(directory, 0o755)
    }
    rmSync(scratch, { recursive: true, force: true })
  })

  function repository(path: string) {
    mkdirSync(path, { recursive: true })
    execFileSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: path })
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: path })
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: path })
    execFileSync('git', ['commit', '--allow-empty', '--quiet', '-m', 'root'], {
      cwd: path,
    })
    return path
  }

  /** Checkouts whose git directory lives outside them, so they have no main checkout. */
  function checkoutsWithoutAMainCheckout() {
    const superproject = repository(join(scratch, 'superproject'))
    execFileSync(
      'git',
      ['-c', 'protocol.file.allow=always', 'submodule', 'add', '--quiet', main, 'module'],
      { cwd: superproject },
    )
    const bare = join(scratch, 'bare.git')
    execFileSync('git', ['clone', '--quiet', '--bare', main, bare])
    const bareWorktree = join(scratch, 'bare-worktree')
    execFileSync('git', ['worktree', 'add', '--quiet', bareWorktree], { cwd: bare })
    const bareNamedGit = join(scratch, 'bare-named', '.git')
    execFileSync('git', ['clone', '--quiet', '--bare', main, bareNamedGit])
    const bareNamedGitWorktree = join(scratch, 'bare-named-worktree')
    execFileSync('git', ['worktree', 'add', '--quiet', bareNamedGitWorktree], {
      cwd: bareNamedGit,
    })
    const separate = join(scratch, 'separate')
    mkdirSync(separate)
    execFileSync(
      'git',
      ['init', '--quiet', '--separate-git-dir', join(scratch, 'separate-git'), separate],
      { cwd: scratch },
    )
    return [join(superproject, 'module'), bareWorktree, bareNamedGitWorktree, separate]
  }

  function linkedWorktree() {
    const worktree = join(scratch, 'project-worktrees', 'lane-a')
    execFileSync('git', ['worktree', 'add', '--quiet', '-b', 'lane-a', worktree], {
      cwd: main,
    })
    return worktree
  }

  function transcript(projectDirectory: string, sessionId: string, root = projects) {
    mkdirSync(join(root, projectDirectory), { recursive: true })
    const path = join(root, projectDirectory, `${sessionId}.jsonl`)
    writeFileSync(path, '{}\n')
    return path
  }

  /** A session folder as session-folder leaves it once it found the transcript. */
  function recordedFolder(sessionId: string, recordedProjects = projects) {
    const folder = join(main, '.sessions', sessionId)
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'ledger.md'), 'state\n')
    writeFileSync(join(folder, '.projects'), `${recordedProjects}\n`)
    return folder
  }

  function folder(sessionId: string) {
    return { sessionId, path: join(main, '.sessions', sessionId) }
  }

  describe('sessionFolder', () => {
    it("creates the session's folder in the main checkout, even from a linked worktree", () => {
      const created = sessionFolder(linkedWorktree(), FIRST, projects)

      expect(created.path).toBe(join(main, '.sessions', FIRST))
      expect(existsSync(created.path)).toBe(true)
      expect(sessionFolder(main, FIRST, projects).path).toBe(created.path)
    })

    it('records the projects directory once a project directory there holds the transcript', () => {
      const unrecorded = sessionFolder(main, FIRST, projects)
      expect(unrecorded.recorded).toBe(false)
      expect(existsSync(join(unrecorded.path, '.projects'))).toBe(false)

      transcript('-project-worktrees-lane-a', FIRST)
      const recorded = sessionFolder(main, FIRST, projects)

      expect(recorded.recorded).toBe(true)
      expect(readFileSync(join(recorded.path, '.projects'), 'utf8')).toBe(`${projects}\n`)
    })

    it('keeps its record when asked from a configuration that holds no transcript of it', () => {
      transcript('-project', FIRST)
      const created = sessionFolder(main, FIRST, projects)

      const elsewhere = sessionFolder(main, FIRST, join(scratch, 'other', 'projects'))

      expect(elsewhere.recorded).toBe(true)
      expect(readFileSync(join(created.path, '.projects'), 'utf8')).toBe(`${projects}\n`)
    })

    it('refuses a missing session id', () => {
      expect(() => sessionFolder(main, undefined, projects)).toThrow(
        'CLAUDE_CODE_SESSION_ID is not set',
      )
      expect(() => sessionFolder(main, '', projects)).toThrow(
        'CLAUDE_CODE_SESSION_ID is not set',
      )
      expect(existsSync(join(main, '.sessions'))).toBe(false)
    })

    it('refuses a session id that is not a plain session id', () => {
      for (const sessionId of ['..', `../${FIRST}`, `${FIRST}/nested`, 'notes']) {
        expect(() => sessionFolder(main, sessionId, projects)).toThrow(
          'is not a Claude Code session id',
        )
      }
      expect(existsSync(join(main, '.sessions'))).toBe(false)
      expect(existsSync(join(main, FIRST))).toBe(false)
    })

    it('refuses a checkout whose git directory lives outside it', () => {
      for (const checkout of checkoutsWithoutAMainCheckout()) {
        expect(() => sessionFolder(checkout, FIRST, projects)).toThrow(
          'has no main checkout to keep session folders in',
        )
      }
      expect(readdirSync(scratch).filter((name) => name === '.sessions')).toEqual([])
      expect(existsSync(join(scratch, 'bare-named', '.sessions'))).toBe(false)
      expect(
        existsSync(join(scratch, 'superproject', '.git', 'modules', '.sessions')),
      ).toBe(false)
    })
  })

  describe('claudeProjectsDirectory', () => {
    it("is the projects directory inside Claude Code's configuration directory", () => {
      expect(claudeProjectsDirectory({ CLAUDE_CONFIG_DIR: '/config' })).toBe(
        '/config/projects',
      )
      expect(claudeProjectsDirectory({})).toBe(join(homedir(), '.claude', 'projects'))
      expect(claudeProjectsDirectory({ CLAUDE_CONFIG_DIR: '' })).toBe(
        join(homedir(), '.claude', 'projects'),
      )
    })
  })

  describe('listSessionFolders', () => {
    it('expires a folder once no project directory holds its transcript', () => {
      transcript('-project', FIRST)
      unlinkSync(transcript('-project', EXPIRED))
      transcript('-removed-project', SECOND)
      rmSync(join(projects, '-removed-project'), { recursive: true })
      for (const sessionId of [FIRST, SECOND, EXPIRED]) recordedFolder(sessionId)

      const listing = listSessionFolders(linkedWorktree())

      expect(listing.sessionsDirectory).toBe(join(main, '.sessions'))
      expect(listing.kept).toEqual([folder(FIRST)])
      expect(listing.expired).toEqual([folder(SECOND), folder(EXPIRED)])
      expect(listing.undecided).toEqual([])
    })

    it('keeps a folder whose transcript moved to another project directory', () => {
      mkdirSync(join(projects, '-project-worktrees-lane-a'), { recursive: true })
      renameSync(
        transcript('-project', FIRST),
        join(projects, '-project-worktrees-lane-a', `${FIRST}.jsonl`),
      )
      const linked = join(scratch, 'linked-project')
      mkdirSync(linked)
      symlinkSync(linked, join(projects, '-linked'))
      renameSync(transcript('-project', SECOND), join(linked, `${SECOND}.jsonl`))
      recordedFolder(FIRST)
      recordedFolder(SECOND)

      expect(listSessionFolders(main).kept).toEqual([folder(FIRST), folder(SECOND)])
    })

    it('keeps a folder whose transcript moves while the sweep reads the projects directory', () => {
      const moving = transcript('-project', FIRST)
      recordedFolder(FIRST)
      const destination = join(projects, '-project-worktrees-lane-a')
      vi.mocked(readdirSync).mockImplementation(((
        ...read: Parameters<typeof readdirSync>
      ) => {
        if (read[0] === join(projects, '-project') && existsSync(moving)) {
          mkdirSync(destination)
          renameSync(moving, join(destination, `${FIRST}.jsonl`))
        }
        return realReaddirSync(...read)
      }) as typeof readdirSync)

      const listing = listSessionFolders(main)

      expect(listing.expired).toEqual([])
      expect(listing.kept).toEqual([folder(FIRST)])
    })

    it('passes over stray files and dangling links in the projects directory', () => {
      unlinkSync(transcript('-project', EXPIRED))
      writeFileSync(join(projects, 'stray-file.jsonl'), '{}\n')
      symlinkSync(join(scratch, 'nowhere'), join(projects, '-dangling'))
      recordedFolder(EXPIRED)

      expect(listSessionFolders(main).expired).toEqual([folder(EXPIRED)])
    })

    it('keeps, with the reason, a folder it cannot judge', () => {
      transcript('-locked', SECOND)
      chmodSync(join(projects, '-locked'), 0o000)
      recordedFolder(FIRST)
      const unrecorded = join(main, '.sessions', SECOND)
      mkdirSync(unrecorded)
      recordedFolder(EXPIRED, join(scratch, 'unmounted', 'projects'))

      const listing = listSessionFolders(main)

      expect(listing.expired).toEqual([])
      expect(listing.undecided).toEqual([
        { ...folder(FIRST), reason: expect.stringContaining('cannot be fully read') },
        { ...folder(SECOND), reason: 'it records no projects directory' },
        { ...folder(EXPIRED), reason: expect.stringContaining('cannot be fully read') },
      ])
    })

    it('leaves alone every entry that is not a session folder', () => {
      mkdirSync(join(main, '.sessions', 'shared-notes'), { recursive: true })
      writeFileSync(join(main, '.sessions', 'README.md'), 'notes\n')
      writeFileSync(join(main, '.sessions', EXPIRED), 'a file named like a session\n')

      expect(listSessionFolders(main)).toEqual({
        sessionsDirectory: join(main, '.sessions'),
        expired: [],
        kept: [],
        undecided: [],
      })
    })

    it('fails when the sessions directory itself cannot be read', () => {
      recordedFolder(FIRST)
      chmodSync(join(main, '.sessions'), 0o000)

      expect(() => listSessionFolders(main)).toThrow('EACCES')
    })

    it('refuses a checkout whose git directory lives outside it', () => {
      for (const checkout of checkoutsWithoutAMainCheckout()) {
        expect(() => listSessionFolders(checkout)).toThrow(
          'has no main checkout to keep session folders in',
        )
      }
    })
  })

  describe('removeExpiredSessionFolders', () => {
    it('removes exactly the expired folders', () => {
      transcript('-project', FIRST)
      unlinkSync(transcript('-project', EXPIRED))
      const kept = recordedFolder(FIRST)
      const expired = recordedFolder(EXPIRED)
      const unrecorded = join(main, '.sessions', SECOND)
      mkdirSync(unrecorded)
      mkdirSync(join(main, '.sessions', 'shared-notes'))

      const { removed, failed } = removeExpiredSessionFolders(main)

      expect(removed).toEqual([folder(EXPIRED)])
      expect(failed).toEqual([])
      expect(existsSync(expired)).toBe(false)
      expect(
        [kept, unrecorded, join(main, '.sessions', 'shared-notes')].every(existsSync),
      ).toBe(true)
    })

    it('reports a folder it could not remove', () => {
      unlinkSync(transcript('-project', FIRST))
      const expired = recordedFolder(FIRST)
      chmodSync(join(main, '.sessions'), 0o555)

      const { removed, failed } = removeExpiredSessionFolders(main)

      expect(removed).toEqual([])
      expect(failed).toEqual([{ folder: folder(FIRST), reason: expect.any(String) }])
      expect(existsSync(expired)).toBe(true)
    })
  })
})
