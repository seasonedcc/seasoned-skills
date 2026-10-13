import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  claudeProjectsDirectory,
  listSessionFolders,
  removeExpiredSessionFolders,
  sessionFolder,
} from './folders.js'

const FIRST = '11111111-1111-4111-8111-111111111111'
const SECOND = '22222222-2222-4222-8222-222222222222'
const EXPIRED = '33333333-3333-4333-8333-333333333333'
const CURRENT = '44444444-4444-4444-8444-444444444444'

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
    for (const directory of [projects, join(projects, '-elsewhere')]) {
      if (existsSync(directory)) chmodSync(directory, 0o755)
    }
    rmSync(scratch, { recursive: true, force: true })
  })

  function linkedWorktree() {
    const worktree = join(scratch, 'project-worktrees', 'lane-a')
    execFileSync('git', ['worktree', 'add', '--quiet', '-b', 'lane-a', worktree], {
      cwd: main,
    })
    return worktree
  }

  function transcript(projectFolder: string, sessionId: string) {
    mkdirSync(join(projects, projectFolder), { recursive: true })
    writeFileSync(join(projects, projectFolder, `${sessionId}.jsonl`), '{}\n')
  }

  function folderOf(sessionId: string) {
    const folder = join(main, '.sessions', sessionId)
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'ledger.md'), 'state\n')
    return folder
  }

  describe('sessionFolder', () => {
    it("creates the session's folder in the main checkout, even from a linked worktree", () => {
      const folder = sessionFolder(linkedWorktree(), FIRST)

      expect(folder).toBe(join(main, '.sessions', FIRST))
      expect(existsSync(folder)).toBe(true)
      expect(sessionFolder(main, FIRST)).toBe(folder)
    })

    it('refuses a missing session id', () => {
      expect(() => sessionFolder(main, undefined)).toThrow(
        'CLAUDE_CODE_SESSION_ID is not set',
      )
      expect(() => sessionFolder(main, '')).toThrow('CLAUDE_CODE_SESSION_ID is not set')
      expect(existsSync(join(main, '.sessions'))).toBe(false)
    })

    it('refuses a session id that is not a plain session id', () => {
      for (const sessionId of ['..', `../${FIRST}`, `${FIRST}/nested`, 'notes']) {
        expect(() => sessionFolder(main, sessionId)).toThrow(
          'is not a Claude Code session id',
        )
      }
      expect(existsSync(join(main, '.sessions'))).toBe(false)
      expect(existsSync(join(main, FIRST))).toBe(false)
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
      const first = folderOf(FIRST)
      const second = folderOf(SECOND)
      const expired = folderOf(EXPIRED)

      const listing = listSessionFolders(linkedWorktree(), {
        projectsDirectory: projects,
      })

      expect(listing.sessionsDirectory).toBe(join(main, '.sessions'))
      expect(listing.expired).toEqual([{ sessionId: EXPIRED, path: expired }])
      expect(listing.kept).toEqual([
        { sessionId: FIRST, path: first },
        { sessionId: SECOND, path: second },
      ])
    })

    it('leaves alone every entry that is not a session folder', () => {
      transcript('-project', FIRST)
      mkdirSync(join(main, '.sessions', 'shared-notes'), { recursive: true })
      writeFileSync(join(main, '.sessions', 'README.md'), 'notes\n')
      writeFileSync(join(main, '.sessions', EXPIRED), 'a file named like a session\n')

      const listing = listSessionFolders(main, { projectsDirectory: projects })

      expect(listing.expired).toEqual([])
      expect(listing.kept).toEqual([])
    })

    it('lists nothing when no session has a folder yet', () => {
      transcript('-project', FIRST)

      expect(listSessionFolders(main, { projectsDirectory: projects })).toEqual({
        sessionsDirectory: join(main, '.sessions'),
        expired: [],
        kept: [],
      })
    })

    it('fails, naming why, when the projects directory does not exist', () => {
      folderOf(EXPIRED)

      expect(() => listSessionFolders(main, { projectsDirectory: projects })).toThrow(
        `cannot read Claude Code's session transcripts in ${projects}`,
      )
    })

    it('reads the transcripts of a project directory reached through a link', () => {
      transcript('-project', FIRST)
      const linked = join(scratch, 'linked-project')
      mkdirSync(linked)
      writeFileSync(join(linked, `${SECOND}.jsonl`), '{}\n')
      symlinkSync(linked, join(projects, '-linked'))
      folderOf(SECOND)

      const listing = listSessionFolders(main, { projectsDirectory: projects })

      expect(listing.expired).toEqual([])
      expect(listing.kept.map((folder) => folder.sessionId)).toEqual([SECOND])
    })

    it('fails when a project directory inside it cannot be read', () => {
      transcript('-project', FIRST)
      transcript('-elsewhere', SECOND)
      chmodSync(join(projects, '-elsewhere'), 0o000)
      folderOf(SECOND)

      expect(() => listSessionFolders(main, { projectsDirectory: projects })).toThrow(
        `cannot read Claude Code's session transcripts in ${projects}`,
      )
    })

    it("fails when the running session's own transcript is not there", () => {
      transcript('-project', FIRST)
      folderOf(EXPIRED)

      expect(() =>
        listSessionFolders(main, {
          projectsDirectory: projects,
          currentSessionId: CURRENT,
        }),
      ).toThrow(`this session's own transcript (${CURRENT}) is not in ${projects}`)
      transcript('-project', CURRENT)
      expect(
        listSessionFolders(main, {
          projectsDirectory: projects,
          currentSessionId: CURRENT,
        }).expired.map((folder) => folder.sessionId),
      ).toEqual([EXPIRED])
    })
  })

  describe('removeExpiredSessionFolders', () => {
    it('removes exactly the expired folders', () => {
      transcript('-project', FIRST)
      transcript('-elsewhere', SECOND)
      const first = folderOf(FIRST)
      const second = folderOf(SECOND)
      const expired = folderOf(EXPIRED)
      mkdirSync(join(main, '.sessions', 'shared-notes'))

      const { removed, failed } = removeExpiredSessionFolders(main, {
        projectsDirectory: projects,
      })

      expect(removed).toEqual([{ sessionId: EXPIRED, path: expired }])
      expect(failed).toEqual([])
      expect(existsSync(expired)).toBe(false)
      expect(
        [first, second, join(main, '.sessions', 'shared-notes')].every(existsSync),
      ).toBe(true)
    })

    it('removes nothing when the transcripts cannot be read', () => {
      const expired = folderOf(EXPIRED)

      expect(() =>
        removeExpiredSessionFolders(main, { projectsDirectory: projects }),
      ).toThrow("cannot read Claude Code's session transcripts")
      mkdirSync(projects, { recursive: true })
      chmodSync(projects, 0o000)
      expect(() =>
        removeExpiredSessionFolders(main, { projectsDirectory: projects }),
      ).toThrow("cannot read Claude Code's session transcripts")

      expect(existsSync(join(expired, 'ledger.md'))).toBe(true)
    })
  })
})
