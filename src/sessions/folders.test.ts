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
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  claudeProjectsDirectory,
  listSessionFolders,
  removeExpiredSessionFolders,
  sessionFolder,
} from './folders.js'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readdirSync: vi.fn(actual.readdirSync),
    statSync: vi.fn(actual.statSync),
  }
})

const { statSync: realStatSync } =
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
    vi.mocked(statSync).mockImplementation(realStatSync)
    for (const directory of [
      projects,
      join(projects, '-elsewhere'),
      join(projects, '-locked'),
      join(main, '.sessions'),
      join(main, '.sessions', FIRST),
    ]) {
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
    const path = join(root, projectFolder, `${sessionId}.jsonl`)
    writeFileSync(path, '{}\n')
    return path
  }

  /** How a record names a projects directory: its device and inode, or none for a missing one. */
  function identityOf(projectsDirectory: string) {
    try {
      const { dev, ino } = realStatSync(projectsDirectory, { bigint: true })
      return `device ${dev} inode ${ino}`
    } catch {
      return 'device 0 inode 0'
    }
  }

  function folderOf(sessionId: string, recordedTranscript?: string) {
    const folder = join(main, '.sessions', sessionId)
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'ledger.md'), 'state\n')
    if (recordedTranscript !== undefined) {
      writeFileSync(
        join(folder, '.transcript'),
        `${recordedTranscript}\n${identityOf(dirname(dirname(recordedTranscript)))}\n`,
      )
    }
    return folder
  }

  function folder(sessionId: string) {
    return { sessionId, path: join(main, '.sessions', sessionId) }
  }

  function ids(folders: { sessionId: string }[]) {
    return folders.map((each) => each.sessionId)
  }

  describe('sessionFolder', () => {
    it("creates the session's folder in the main checkout, even from a linked worktree", () => {
      transcript('-project', FIRST)
      const created = sessionFolder(linkedWorktree(), FIRST, projects)

      expect(created.path).toBe(join(main, '.sessions', FIRST))
      expect(existsSync(created.path)).toBe(true)
      expect(sessionFolder(main, FIRST, projects).path).toBe(created.path)
    })

    it("records the path of the session's own transcript, searched across every project", () => {
      transcript('-project', SECOND)
      const own = transcript('-elsewhere', FIRST)

      const created = sessionFolder(main, FIRST, projects)

      expect(created.transcript).toBe(own)
      expect(readFileSync(join(created.path, '.transcript'), 'utf8')).toBe(
        `${own}\n${identityOf(projects)}\n`,
      )
    })

    it('records the projects directory anew when another one now sits at its path', () => {
      const own = transcript('-project', FIRST)
      const created = sessionFolder(main, FIRST, projects)
      const before = identityOf(projects)
      renameSync(projects, join(scratch, 'claude', 'projects-before'))
      transcript('-project', FIRST)

      sessionFolder(main, FIRST, projects)

      expect(identityOf(projects)).not.toBe(before)
      expect(readFileSync(join(created.path, '.transcript'), 'utf8')).toBe(
        `${own}\n${identityOf(projects)}\n`,
      )
    })

    it('finds the transcript through a linked project directory', () => {
      const linked = join(scratch, 'linked-project')
      mkdirSync(linked)
      writeFileSync(join(linked, `${FIRST}.jsonl`), '{}\n')
      mkdirSync(projects, { recursive: true })
      symlinkSync(linked, join(projects, '-linked'))

      expect(sessionFolder(main, FIRST, projects).transcript).toBe(
        join(projects, '-linked', `${FIRST}.jsonl`),
      )
    })

    it('rewrites the record only when the transcript found is another one', () => {
      const own = transcript('-project', FIRST)
      const created = sessionFolder(main, FIRST, projects)
      const record = join(created.path, '.transcript')
      const longAgo = new Date('2020-01-01T00:00:00Z')
      utimesSync(record, longAgo, longAgo)

      sessionFolder(main, FIRST, projects)
      expect(statSync(record).mtime).toEqual(longAgo)

      const emptyProjects = join(scratch, 'experimental', 'projects')
      mkdirSync(emptyProjects, { recursive: true })
      expect(sessionFolder(main, FIRST, emptyProjects).transcript).toBe(own)
      expect(readFileSync(record, 'utf8')).toBe(`${own}\n${identityOf(projects)}\n`)

      unlinkSync(own)
      const moved = transcript('-moved', FIRST)
      sessionFolder(main, FIRST, projects)
      expect(readFileSync(record, 'utf8')).toBe(`${moved}\n${identityOf(projects)}\n`)
    })

    it('records nothing when no transcript can be found', () => {
      transcript('-elsewhere', FIRST)
      chmodSync(join(projects, '-elsewhere'), 0o000)

      const created = sessionFolder(main, FIRST, projects)
      const elsewhere = sessionFolder(main, FIRST, join(scratch, 'missing', 'projects'))

      expect(created.transcript).toBeUndefined()
      expect(elsewhere.transcript).toBeUndefined()
      expect(existsSync(created.path)).toBe(true)
      expect(existsSync(join(created.path, '.transcript'))).toBe(false)
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
      const kept = transcript('-project', FIRST)
      const removedByClaudeCode = transcript('-project', EXPIRED)
      const inRemovedProject = transcript('-elsewhere', SECOND)
      folderOf(FIRST, kept)
      folderOf(EXPIRED, removedByClaudeCode)
      folderOf(SECOND, inRemovedProject)
      unlinkSync(removedByClaudeCode)
      rmSync(join(projects, '-elsewhere'), { recursive: true })
      symlinkSync(join(scratch, 'nowhere'), join(projects, '-dangling'))

      const listing = listSessionFolders(linkedWorktree())

      expect(listing.sessionsDirectory).toBe(join(main, '.sessions'))
      expect(listing.kept).toEqual([folder(FIRST)])
      expect(listing.expired).toEqual([folder(SECOND), folder(EXPIRED)])
      expect(listing.unrecorded).toEqual([])
      expect(listing.undecided).toEqual([])
    })

    it('keeps a folder whose transcript moved to another project directory', () => {
      const recorded = transcript('-project', FIRST)
      const recordedBeforeTheLink = transcript('-project', SECOND)
      folderOf(FIRST, recorded)
      folderOf(SECOND, recordedBeforeTheLink)
      mkdirSync(join(projects, '-project-worktrees-lane-a'))
      renameSync(recorded, join(projects, '-project-worktrees-lane-a', `${FIRST}.jsonl`))
      const linked = join(scratch, 'linked-project')
      mkdirSync(linked)
      symlinkSync(linked, join(projects, '-linked'))
      renameSync(recordedBeforeTheLink, join(linked, `${SECOND}.jsonl`))

      const listing = listSessionFolders(main)

      expect(listing.kept).toEqual([folder(FIRST), folder(SECOND)])
      expect(listing.expired).toEqual([])
      expect(listing.undecided).toEqual([])
    })

    it('looks again before expiring a folder, so a transcript moved mid-sweep keeps it', () => {
      const recorded = transcript('-project', FIRST)
      folderOf(FIRST, recorded)
      const moved = join(projects, '-project-worktrees-lane-a', `${FIRST}.jsonl`)
      vi.mocked(statSync).mockImplementation(((path, options) => {
        if (path === join(projects, '-project') && existsSync(recorded)) {
          mkdirSync(dirname(moved))
          renameSync(recorded, moved)
        }
        return realStatSync(path, options)
      }) as typeof statSync)

      const listing = listSessionFolders(main)

      expect(listing.kept).toEqual([folder(FIRST)])
      expect(listing.expired).toEqual([])
    })

    it('reads a projects directory once for all its folders, and once more before expiring any', () => {
      folderOf(FIRST, transcript('-project', FIRST))
      folderOf(SECOND, transcript('-project', SECOND))
      const projectsReads = () =>
        vi.mocked(readdirSync).mock.calls.filter(([path]) => path === projects).length

      vi.mocked(readdirSync).mockClear()
      listSessionFolders(main)
      expect(projectsReads()).toBe(1)

      const gone = transcript('-project', EXPIRED)
      folderOf(EXPIRED, gone)
      unlinkSync(gone)
      vi.mocked(readdirSync).mockClear()
      listSessionFolders(main)
      expect(projectsReads()).toBe(2)
    })

    it('keeps, undecided, a folder whose projects directory was replaced by another at the same path', () => {
      const projectsBefore = join(scratch, 'config-a', 'projects')
      transcript('-project', FIRST, projectsBefore)
      sessionFolder(main, FIRST, projectsBefore)
      renameSync(join(scratch, 'config-a'), join(scratch, 'config-b'))
      transcript('-other', SECOND, projectsBefore)

      const listing = listSessionFolders(main)
      const { removed } = removeExpiredSessionFolders(main)

      expect(listing.expired).toEqual([])
      expect(listing.undecided).toEqual([
        {
          ...folder(FIRST),
          reason: expect.stringContaining(
            `the projects directory at ${projectsBefore} is not the one this folder recorded`,
          ),
        },
      ])
      expect(removed).toEqual([])
      expect(existsSync(join(main, '.sessions', FIRST))).toBe(true)
    })

    it('keeps, undecided, a folder whose record holds no readable identity of its projects directory', () => {
      const withoutIdentity = folderOf(FIRST)
      writeFileSync(
        join(withoutIdentity, '.transcript'),
        `${transcript('-project', FIRST)}\n`,
      )
      const withGarbledIdentity = folderOf(SECOND)
      writeFileSync(
        join(withGarbledIdentity, '.transcript'),
        `${transcript('-project', SECOND)}\ndevice twelve inode 7\n`,
      )
      const withTrailingLines = folderOf(EXPIRED)
      writeFileSync(
        join(withTrailingLines, '.transcript'),
        `${transcript('-project', EXPIRED)}\n${identityOf(projects)}\nmore\n`,
      )

      const listing = listSessionFolders(main)

      expect(listing.kept).toEqual([])
      expect(ids(listing.undecided)).toEqual([FIRST, SECOND, EXPIRED])
      for (const undecided of listing.undecided) {
        expect(undecided.reason).toContain("its projects directory's identity")
      }
    })

    it('keeps a folder with no record, whatever the transcripts say', () => {
      folderOf(EXPIRED)

      const listing = listSessionFolders(main)

      expect(listing.unrecorded).toEqual([folder(EXPIRED)])
      expect(listing.expired).toEqual([])
      expect(listing.undecided).toEqual([])
    })

    it('keeps, undecided, a folder whose projects directory is missing or unreadable', () => {
      const unmounted = join(
        scratch,
        'unmounted',
        'projects',
        '-project',
        `${FIRST}.jsonl`,
      )
      folderOf(FIRST, unmounted)
      const locked = transcript('-project', SECOND)
      folderOf(SECOND, locked)
      unlinkSync(locked)
      chmodSync(projects, 0o100)

      const listing = listSessionFolders(main)

      expect(listing.expired).toEqual([])
      expect(listing.undecided).toEqual([
        {
          ...folder(FIRST),
          reason: expect.stringContaining(join(scratch, 'unmounted', 'projects')),
        },
        { ...folder(SECOND), reason: expect.stringContaining(projects) },
      ])
    })

    it('keeps, undecided, a folder whose transcript may sit where it cannot be checked', () => {
      const gone = transcript('-project', FIRST)
      folderOf(FIRST, gone)
      unlinkSync(gone)
      folderOf(SECOND, transcript('-project', SECOND))
      transcript('-locked', LATE)
      chmodSync(join(projects, '-locked'), 0o000)
      const looping = join(scratch, 'looping', 'projects', '-project', `${EXPIRED}.jsonl`)
      mkdirSync(dirname(looping), { recursive: true })
      symlinkSync(looping, looping)
      folderOf(EXPIRED, looping)

      const listing = listSessionFolders(main)

      expect(listing.kept).toEqual([folder(SECOND)])
      expect(listing.expired).toEqual([])
      expect(listing.undecided).toEqual([
        { ...folder(FIRST), reason: expect.stringContaining(join(projects, '-locked')) },
        { ...folder(EXPIRED), reason: expect.stringContaining('ELOOP') },
      ])
    })

    it('keeps, undecided, a folder whose record cannot be read or names no transcript of this session', () => {
      folderOf(FIRST, 'relative/transcript.jsonl')
      const unreadable = folderOf(SECOND, '/anywhere/transcript.jsonl')
      chmodSync(join(unreadable, '.transcript'), 0o000)
      folderOf(LATE, transcript('-project', SECOND))

      const listing = listSessionFolders(main)

      expect(listing.expired).toEqual([])
      expect(listing.undecided).toEqual([
        { ...folder(FIRST), reason: expect.stringContaining('names no absolute path') },
        { ...folder(SECOND), reason: expect.stringContaining('cannot read') },
        {
          ...folder(LATE),
          reason: expect.stringContaining("not this session's transcript"),
        },
      ])
    })

    it('never judges a folder created while the records are being checked', () => {
      const own = transcript('-project', FIRST)
      folderOf(FIRST, own)
      const gone = join(projects, '-project', `${LATE}.jsonl`)
      vi.mocked(statSync).mockImplementation(((path, options) => {
        if (path === own && !existsSync(join(main, '.sessions', LATE)))
          folderOf(LATE, gone)
        return realStatSync(path, options)
      }) as typeof statSync)

      const listing = listSessionFolders(main)

      expect(listing.expired).toEqual([])
      expect(existsSync(join(main, '.sessions', LATE))).toBe(true)
    })

    it('leaves alone every entry that is not a session folder', () => {
      mkdirSync(join(main, '.sessions', 'shared-notes'), { recursive: true })
      writeFileSync(join(main, '.sessions', 'README.md'), 'notes\n')
      writeFileSync(join(main, '.sessions', EXPIRED), 'a file named like a session\n')

      expect(listSessionFolders(main)).toEqual({
        sessionsDirectory: join(main, '.sessions'),
        expired: [],
        kept: [],
        unrecorded: [],
        undecided: [],
      })
    })

    it('fails when the sessions directory itself cannot be read', () => {
      folderOf(FIRST)
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
      const kept = folderOf(FIRST, transcript('-project', FIRST))
      const goneTranscript = transcript('-project', EXPIRED)
      const expired = folderOf(EXPIRED, goneTranscript)
      unlinkSync(goneTranscript)
      const unrecorded = folderOf(SECOND)
      const undecided = folderOf(
        LATE,
        join(scratch, 'gone', 'projects', '-p', `${LATE}.jsonl`),
      )
      mkdirSync(join(main, '.sessions', 'shared-notes'))

      const { removed, failed } = removeExpiredSessionFolders(main)

      expect(removed).toEqual([folder(EXPIRED)])
      expect(failed).toEqual([])
      expect(existsSync(expired)).toBe(false)
      expect(
        [kept, unrecorded, undecided, join(main, '.sessions', 'shared-notes')].every(
          existsSync,
        ),
      ).toBe(true)
    })

    it('reports a folder it could not remove', () => {
      const goneTranscript = transcript('-project', FIRST)
      const expired = folderOf(FIRST, goneTranscript)
      unlinkSync(goneTranscript)
      chmodSync(join(main, '.sessions'), 0o555)

      const { removed, failed } = removeExpiredSessionFolders(main)

      expect(removed).toEqual([])
      expect(failed).toEqual([{ folder: folder(FIRST), reason: expect.any(String) }])
      expect(existsSync(expired)).toBe(true)
    })
  })
})
