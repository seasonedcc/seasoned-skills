import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
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
const LATE = '44444444-4444-4444-8444-444444444444'

describe('session folders', () => {
  let scratch: string
  let main: string
  let projects: string

  beforeEach(() => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'seasoned-skills-sessions-')))
    main = join(scratch, 'project')
    mkdirSync(main)
    execFileSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: main })
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: main })
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: main })
    execFileSync('git', ['commit', '--allow-empty', '--quiet', '-m', 'root'], {
      cwd: main,
    })
    projects = join(scratch, 'claude', 'projects')
  })

  afterEach(() => {
    vi.mocked(readdirSync).mockImplementation(realReaddirSync)
    vi.mocked(readdirSync).mockClear()
    for (const directory of [projects, join(projects, '-elsewhere')]) {
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

  function transcript(projectFolder: string, sessionId: string, root = projects) {
    mkdirSync(join(root, projectFolder), { recursive: true })
    writeFileSync(join(root, projectFolder, `${sessionId}.jsonl`), '{}\n')
  }

  function folderOf(sessionId: string, recordedProjects?: string) {
    const folder = join(main, '.sessions', sessionId)
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'ledger.md'), 'state\n')
    if (recordedProjects !== undefined) {
      writeFileSync(join(folder, '.projects-directory'), `${recordedProjects}\n`)
    }
    return folder
  }

  function judged(sessionId: string, recordedProjects = projects) {
    return {
      sessionId,
      path: join(main, '.sessions', sessionId),
      projectsDirectory: recordedProjects,
    }
  }

  describe('sessionFolder', () => {
    it("creates the session's folder in the main checkout, even from a linked worktree", () => {
      const folder = sessionFolder(linkedWorktree(), FIRST, projects)

      expect(folder).toBe(join(main, '.sessions', FIRST))
      expect(existsSync(folder)).toBe(true)
      expect(sessionFolder(main, FIRST, projects)).toBe(folder)
    })

    it('records the projects directory that keeps the session transcript', () => {
      const folder = sessionFolder(main, FIRST, projects)
      const marker = join(folder, '.projects-directory')
      expect(readFileSync(marker, 'utf8')).toBe(`${projects}\n`)

      const longAgo = new Date('2020-01-01T00:00:00Z')
      utimesSync(marker, longAgo, longAgo)
      sessionFolder(main, FIRST, projects)
      expect(statSync(marker).mtime).toEqual(longAgo)

      const moved = join(scratch, 'moved', 'projects')
      sessionFolder(main, FIRST, moved)
      expect(readFileSync(marker, 'utf8')).toBe(`${moved}\n`)
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
    it('lists as expired only the folders whose transcript no project directory keeps', () => {
      transcript('-project', FIRST)
      transcript('-elsewhere', SECOND)
      folderOf(FIRST)
      folderOf(SECOND)
      folderOf(EXPIRED)

      const listing = listSessionFolders(linkedWorktree(), projects)

      expect(listing.sessionsDirectory).toBe(join(main, '.sessions'))
      expect(listing.expired).toEqual([judged(EXPIRED)])
      expect(listing.kept).toEqual([judged(FIRST), judged(SECOND)])
      expect(listing.undecided).toEqual([])
    })

    it("judges each folder against the projects directory it recorded, not the sweep's", () => {
      const otherProjects = join(scratch, 'other-account', 'projects')
      transcript('-project', FIRST, otherProjects)
      folderOf(FIRST, otherProjects)
      folderOf(EXPIRED, otherProjects)
      transcript('-project', SECOND)

      const listing = listSessionFolders(main, projects)

      expect(listing.kept).toEqual([judged(FIRST, otherProjects)])
      expect(listing.expired).toEqual([judged(EXPIRED, otherProjects)])
    })

    it('keeps, undecided, a folder whose recorded projects directory cannot be read', () => {
      transcript('-project', FIRST)
      const gone = join(scratch, 'gone', 'projects')
      folderOf(EXPIRED, gone)
      folderOf(SECOND, 'not/an/absolute/path')

      const listing = listSessionFolders(main, projects)

      expect(listing.expired).toEqual([])
      expect(listing.undecided).toEqual([
        {
          ...judged(SECOND, 'not/an/absolute/path'),
          reason: expect.stringContaining('records no absolute projects directory'),
        },
        {
          ...judged(EXPIRED, gone),
          reason: expect.stringContaining(
            `cannot read Claude Code's session transcripts in ${gone}`,
          ),
        },
      ])
    })

    it('reads each recorded projects directory once', () => {
      const otherProjects = join(scratch, 'other-account', 'projects')
      transcript('-project', FIRST, otherProjects)
      folderOf(FIRST, otherProjects)
      folderOf(SECOND, otherProjects)
      folderOf(EXPIRED, otherProjects)

      listSessionFolders(main, projects)

      const reads = vi
        .mocked(readdirSync)
        .mock.calls.filter(([path]) => path === otherProjects)
      expect(reads).toHaveLength(1)
    })

    it('never counts as expired a folder created while the transcripts are being read', () => {
      transcript('-project', FIRST)
      folderOf(FIRST)
      vi.mocked(readdirSync).mockImplementation(((path, options) => {
        const entries = realReaddirSync(path, options as { withFileTypes: true })
        if (
          path === join(projects, '-project') &&
          !existsSync(join(main, '.sessions', LATE))
        ) {
          transcript('-project', LATE)
          folderOf(LATE)
        }
        return entries
      }) as typeof readdirSync)

      const listing = listSessionFolders(main, projects)

      expect(listing.expired).toEqual([])
      expect(existsSync(join(main, '.sessions', LATE))).toBe(true)
    })

    it('leaves alone every entry that is not a session folder', () => {
      transcript('-project', FIRST)
      mkdirSync(join(main, '.sessions', 'shared-notes'), { recursive: true })
      writeFileSync(join(main, '.sessions', 'README.md'), 'notes\n')
      writeFileSync(join(main, '.sessions', EXPIRED), 'a file named like a session\n')

      const listing = listSessionFolders(main, projects)

      expect(listing.expired).toEqual([])
      expect(listing.kept).toEqual([])
    })

    it('lists nothing, and reads no transcripts, when no session has a folder yet', () => {
      expect(listSessionFolders(main, projects)).toEqual({
        sessionsDirectory: join(main, '.sessions'),
        expired: [],
        kept: [],
        undecided: [],
      })
      expect(vi.mocked(readdirSync).mock.calls.map(([path]) => path)).not.toContain(
        projects,
      )
    })

    it('keeps, undecided, every unmarked folder when the projects directory does not exist', () => {
      folderOf(EXPIRED)

      const listing = listSessionFolders(main, projects)

      expect(listing.expired).toEqual([])
      expect(listing.undecided).toEqual([
        {
          ...judged(EXPIRED),
          reason: expect.stringContaining(
            `cannot read Claude Code's session transcripts in ${projects}`,
          ),
        },
      ])
    })

    it('reads the transcripts of a project directory reached through a link', () => {
      transcript('-project', FIRST)
      const linked = join(scratch, 'linked-project')
      mkdirSync(linked)
      writeFileSync(join(linked, `${SECOND}.jsonl`), '{}\n')
      symlinkSync(linked, join(projects, '-linked'))
      folderOf(SECOND)

      const listing = listSessionFolders(main, projects)

      expect(listing.expired).toEqual([])
      expect(listing.kept).toEqual([judged(SECOND)])
    })

    it('passes over a link in the projects directory that leads to no directory', () => {
      transcript('-project', FIRST)
      symlinkSync(join(scratch, 'nowhere'), join(projects, '-dangling'))
      symlinkSync(join(projects, '-project', `${FIRST}.jsonl`), join(projects, '-file'))
      folderOf(FIRST)
      folderOf(EXPIRED)

      const listing = listSessionFolders(main, projects)

      expect(listing.kept).toEqual([judged(FIRST)])
      expect(listing.expired).toEqual([judged(EXPIRED)])
      expect(listing.undecided).toEqual([])
    })

    it('keeps everything undecided when a project directory inside it cannot be read', () => {
      transcript('-project', FIRST)
      transcript('-elsewhere', SECOND)
      chmodSync(join(projects, '-elsewhere'), 0o000)
      folderOf(SECOND)

      const listing = listSessionFolders(main, projects)

      expect(listing.expired).toEqual([])
      expect(listing.undecided.map((folder) => folder.sessionId)).toEqual([SECOND])
    })

    it('refuses a checkout whose git directory lives outside it', () => {
      for (const checkout of checkoutsWithoutAMainCheckout()) {
        expect(() => listSessionFolders(checkout, projects)).toThrow(
          'has no main checkout to keep session folders in',
        )
      }
    })
  })

  describe('removeExpiredSessionFolders', () => {
    it('removes exactly the expired folders', () => {
      transcript('-project', FIRST)
      transcript('-elsewhere', SECOND)
      const first = folderOf(FIRST)
      const second = folderOf(SECOND)
      const expired = folderOf(EXPIRED)
      const undecided = folderOf(LATE, join(scratch, 'gone', 'projects'))
      mkdirSync(join(main, '.sessions', 'shared-notes'))

      const { removed, failed } = removeExpiredSessionFolders(main, projects)

      expect(removed).toEqual([judged(EXPIRED)])
      expect(failed).toEqual([])
      expect(existsSync(expired)).toBe(false)
      expect(
        [first, second, undecided, join(main, '.sessions', 'shared-notes')].every(
          existsSync,
        ),
      ).toBe(true)
    })

    it('removes nothing when the transcripts cannot be read', () => {
      const expired = folderOf(EXPIRED)

      expect(removeExpiredSessionFolders(main, projects).removed).toEqual([])
      mkdirSync(projects, { recursive: true })
      chmodSync(projects, 0o000)
      expect(removeExpiredSessionFolders(main, projects).removed).toEqual([])

      expect(existsSync(join(expired, 'ledger.md'))).toBe(true)
    })
  })
})
