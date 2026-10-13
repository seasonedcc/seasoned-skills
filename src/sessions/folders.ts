import {
  type Dirent,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { git } from '../provisioning/runtime.js'

/**
 * Session folders: each Claude Code session keeps everything it writes — its
 * ledger, scratch files, logs, caches — in `.sessions/<session id>/` inside the
 * project's main checkout, where neither a reboot nor a temp cleaner reaches
 * it, and every linked worktree reaches the same folder by absolute path.
 * Subagents share their session's id and therefore its folder. A session can
 * be resumed for as long as Claude Code keeps its transcript, so its folder
 * lives exactly that long: the folder records the path of the transcript it
 * found, and the sweep removes it only once that transcript is gone from a
 * projects directory it can still read. A folder that recorded no transcript,
 * and one whose transcript cannot be checked, is never removed.
 */

const SESSIONS_DIRECTORY = '.sessions'

const TRANSCRIPT_RECORD = '.transcript'

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

type SessionFolder = { sessionId: string; path: string }

type UndecidedSessionFolder = SessionFolder & { reason: string }

type SessionFolderListing = {
  sessionsDirectory: string
  /** Folders whose recorded transcript Claude Code no longer keeps. */
  expired: SessionFolder[]
  /** Folders whose recorded transcript is still there. */
  kept: SessionFolder[]
  /** Folders that recorded no transcript, which the sweep never removes. */
  unrecorded: SessionFolder[]
  /** Folders kept because whether their transcript remains cannot be told. */
  undecided: UndecidedSessionFolder[]
}

/**
 * The checkout every worktree of this repository branches from. Refuses a
 * repository whose git directory does not sit inside a working checkout — a
 * submodule, a bare repository, a separate git directory — rather than put
 * session folders somewhere no checkout owns.
 */
function mainCheckoutOf(projectDirectory: string) {
  const commonDirectory = git(
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { cwd: projectDirectory },
  )
  const bare = git(['--git-dir', commonDirectory, 'rev-parse', '--is-bare-repository'])
  if (basename(commonDirectory) !== '.git' || bare === 'true') {
    throw new Error(
      `${projectDirectory} belongs to a repository whose git directory, ${commonDirectory}, does not sit inside a working checkout (a submodule, a bare repository, or a separate git directory), so it has no main checkout to keep session folders in. Run this from the project's own checkout or one of its worktrees.`,
    )
  }
  return dirname(commonDirectory)
}

function sessionsDirectoryOf(projectDirectory: string) {
  return join(mainCheckoutOf(projectDirectory), SESSIONS_DIRECTORY)
}

/** Claude Code's projects directory: under `$CLAUDE_CONFIG_DIR`, or `~/.claude` without it. */
function claudeProjectsDirectory(environment: NodeJS.ProcessEnv) {
  const configured = environment.CLAUDE_CONFIG_DIR
  const configDirectory =
    configured === undefined || configured === ''
      ? join(homedir(), '.claude')
      : configured
  return join(configDirectory, 'projects')
}

/**
 * The session's transcript in any project directory, reached through links
 * too. A directory that cannot be read only means the transcript was not found
 * there: a folder that records nothing is never removed.
 */
function findTranscript(projectsDirectory: string, sessionId: string) {
  let projects: string[]
  try {
    projects = readdirSync(projectsDirectory)
  } catch {
    return undefined
  }
  for (const project of projects.sort()) {
    const candidate = join(projectsDirectory, project, `${sessionId}.jsonl`)
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {}
  }
  return undefined
}

function readOrNothing(path: string) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * This session's folder in the main checkout, created when missing, with the
 * path of the session's transcript recorded in it. The record changes only to
 * another transcript that exists, so no configuration can point it at nothing.
 */
function sessionFolder(
  projectDirectory: string,
  sessionId: string | undefined,
  projectsDirectory: string,
) {
  if (sessionId === undefined || sessionId === '') {
    throw new Error(
      'CLAUDE_CODE_SESSION_ID is not set — a session folder belongs to a Claude Code session, so ask for it from inside one.',
    )
  }
  if (!SESSION_ID.test(sessionId)) {
    throw new Error(
      `CLAUDE_CODE_SESSION_ID ${JSON.stringify(sessionId)} is not a Claude Code session id, so no folder is named after it.`,
    )
  }
  const path = join(sessionsDirectoryOf(projectDirectory), sessionId)
  mkdirSync(path, { recursive: true })
  const record = join(path, TRANSCRIPT_RECORD)
  const recorded = readOrNothing(record)?.trim()
  const found = findTranscript(projectsDirectory, sessionId)
  if (found === undefined) return { path, transcript: recorded }
  if (found !== recorded) writeFileSync(record, `${found}\n`)
  return { path, transcript: found }
}

function sessionFolderEntries(sessionsDirectory: string): Dirent[] {
  try {
    return readdirSync(sessionsDirectory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

type Judgement =
  | { verdict: 'expired' | 'kept' | 'unrecorded' }
  | { verdict: 'undecided'; reason: string }

/**
 * A folder expires only on positive evidence: its record names a transcript,
 * that transcript is gone, and the projects directory that held it can still
 * be read — so a moved or unmounted configuration never removes anything.
 */
function judge(folder: SessionFolder): Judgement {
  const record = join(folder.path, TRANSCRIPT_RECORD)
  let recorded: string
  try {
    recorded = readFileSync(record, 'utf8').trim()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { verdict: 'unrecorded' }
    return {
      verdict: 'undecided',
      reason: `cannot read ${record}: ${(error as Error).message}`,
    }
  }
  if (!isAbsolute(recorded)) {
    return { verdict: 'undecided', reason: `${record} names no absolute path` }
  }
  try {
    statSync(recorded)
    return { verdict: 'kept' }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return {
        verdict: 'undecided',
        reason: `cannot check the transcript ${recorded}: ${(error as Error).message}`,
      }
    }
  }
  const projectsDirectory = dirname(dirname(recorded))
  try {
    readdirSync(projectsDirectory)
    return { verdict: 'expired' }
  } catch (error) {
    return {
      verdict: 'undecided',
      reason: `cannot read Claude Code's projects directory ${projectsDirectory}: ${(error as Error).message}`,
    }
  }
}

/**
 * Every session folder in the main checkout, each judged by the transcript it
 * recorded. The folders are listed before any is judged, so a session that
 * starts mid-sweep is never judged at all. Only directories named like a
 * session id are session folders; anything else in `.sessions/` is never
 * listed.
 */
function listSessionFolders(projectDirectory: string): SessionFolderListing {
  const sessionsDirectory = sessionsDirectoryOf(projectDirectory)
  const folders = sessionFolderEntries(sessionsDirectory)
    .filter((entry) => entry.isDirectory() && SESSION_ID.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .map((sessionId) => ({ sessionId, path: join(sessionsDirectory, sessionId) }))
  const listing: SessionFolderListing = {
    sessionsDirectory,
    expired: [],
    kept: [],
    unrecorded: [],
    undecided: [],
  }
  for (const folder of folders) {
    const judgement = judge(folder)
    if (judgement.verdict === 'undecided') {
      listing.undecided.push({ ...folder, reason: judgement.reason })
    } else {
      listing[judgement.verdict].push(folder)
    }
  }
  return listing
}

/** Remove the expired session folders, leaving every other one. */
function removeExpiredSessionFolders(projectDirectory: string) {
  const removed: SessionFolder[] = []
  const failed: { folder: SessionFolder; reason: string }[] = []
  for (const folder of listSessionFolders(projectDirectory).expired) {
    try {
      rmSync(folder.path, { recursive: true, force: true })
      removed.push(folder)
    } catch (error) {
      failed.push({ folder, reason: (error as Error).message })
    }
  }
  return { removed, failed }
}

export type { SessionFolder, SessionFolderListing, UndecidedSessionFolder }
export {
  claudeProjectsDirectory,
  listSessionFolders,
  removeExpiredSessionFolders,
  sessionFolder,
}
