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
 * lives exactly that long. The folder records the path of the transcript it
 * found, which pins the projects directory Claude Code keeps it in. Claude
 * Code moves a live session's transcript between the project directories in
 * there, so the sweep removes the folder only once none of them holds the
 * transcript. A folder that recorded no transcript, and one whose
 * transcript cannot be looked for everywhere it could be, is never removed.
 */

const SESSIONS_DIRECTORY = '.sessions'

const TRANSCRIPT_RECORD = '.transcript'

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

type SessionFolder = { sessionId: string; path: string }

type UndecidedSessionFolder = SessionFolder & { reason: string }

type SessionFolderListing = {
  sessionsDirectory: string
  /** Folders whose session's transcript is gone from their projects directory. */
  expired: SessionFolder[]
  /** Folders whose session's transcript is still in their projects directory. */
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

function isMissing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

/** The projects directory a folder's record pins, or why the folder is judged without one. */
function pinnedProjectsDirectory(
  folder: SessionFolder,
): { projectsDirectory: string } | Judgement {
  const record = join(folder.path, TRANSCRIPT_RECORD)
  let recorded: string
  try {
    recorded = readFileSync(record, 'utf8').trim()
  } catch (error) {
    if (isMissing(error)) return { verdict: 'unrecorded' }
    return {
      verdict: 'undecided',
      reason: `cannot read ${record}: ${(error as Error).message}`,
    }
  }
  if (!isAbsolute(recorded)) {
    return { verdict: 'undecided', reason: `${record} names no absolute path` }
  }
  if (basename(recorded) !== `${folder.sessionId}.jsonl`) {
    return {
      verdict: 'undecided',
      reason: `${record} names ${recorded}, which is not this session's transcript`,
    }
  }
  return { projectsDirectory: dirname(dirname(recorded)) }
}

type ProjectsDirectoryScan =
  | { unreadable: string }
  | { projects: { path: string; entries: Set<string> }[]; problems: string[] }

/**
 * What every project directory of a projects directory holds, following links to
 * directories and passing over dangling ones. Anything else that cannot be
 * read is a problem, since the transcript may be exactly there.
 */
function scanProjectsDirectory(projectsDirectory: string): ProjectsDirectoryScan {
  let names: string[]
  try {
    names = readdirSync(projectsDirectory)
  } catch (error) {
    return {
      unreadable: `cannot read Claude Code's projects directory ${projectsDirectory}: ${(error as Error).message}`,
    }
  }
  const projects: { path: string; entries: Set<string> }[] = []
  const problems: string[] = []
  for (const name of names) {
    const path = join(projectsDirectory, name)
    try {
      if (statSync(path).isDirectory()) {
        projects.push({ path, entries: new Set(readdirSync(path)) })
      }
    } catch (error) {
      if (!isMissing(error)) {
        problems.push(
          `cannot read the project directory ${path}: ${(error as Error).message}`,
        )
      }
    }
  }
  return { projects, problems }
}

/**
 * Kept when a project directory holds the session's transcript, expired only when
 * none does and every place it could be was checked.
 */
function judgeByScan(scan: ProjectsDirectoryScan, sessionId: string): Judgement {
  if ('unreadable' in scan) return { verdict: 'undecided', reason: scan.unreadable }
  const transcript = `${sessionId}.jsonl`
  const problems = [...scan.problems]
  for (const project of scan.projects) {
    if (!project.entries.has(transcript)) continue
    const candidate = join(project.path, transcript)
    try {
      statSync(candidate)
      return { verdict: 'kept' }
    } catch (error) {
      if (!isMissing(error)) {
        problems.push(
          `cannot check the transcript ${candidate}: ${(error as Error).message}`,
        )
      }
    }
  }
  if (problems.length > 0) return { verdict: 'undecided', reason: problems.join('; ') }
  return { verdict: 'expired' }
}

/** Judge each session against its pinned projects directory, reading each directory once. */
function lookForTranscripts(pinned: Map<string, string>) {
  const scans = new Map<string, ProjectsDirectoryScan>()
  const judgements = new Map<string, Judgement>()
  for (const [sessionId, projectsDirectory] of pinned) {
    let scan = scans.get(projectsDirectory)
    if (scan === undefined) {
      scan = scanProjectsDirectory(projectsDirectory)
      scans.set(projectsDirectory, scan)
    }
    judgements.set(sessionId, judgeByScan(scan, sessionId))
  }
  return judgements
}

/**
 * Every session folder in the main checkout, each judged by whether its
 * session's transcript is still in the projects directory its record pins.
 * The folders are listed before any is judged, so a session that starts
 * mid-sweep is never judged at all, and a folder about to expire is looked
 * for once more, so a transcript Claude Code was moving during the first look
 * keeps it. Only directories named like a session id are session folders;
 * anything else in `.sessions/` is never listed.
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
  const judgements = new Map<string, Judgement>()
  const pinned = new Map<string, string>()
  for (const folder of folders) {
    const pin = pinnedProjectsDirectory(folder)
    if ('projectsDirectory' in pin) pinned.set(folder.sessionId, pin.projectsDirectory)
    else judgements.set(folder.sessionId, pin)
  }
  const firstLook = lookForTranscripts(pinned)
  const vanished = new Map(
    [...pinned].filter(([sessionId]) => firstLook.get(sessionId)?.verdict === 'expired'),
  )
  for (const looks of [firstLook, lookForTranscripts(vanished)]) {
    for (const [sessionId, judgement] of looks) judgements.set(sessionId, judgement)
  }
  for (const folder of folders) {
    const judgement = judgements.get(folder.sessionId) as Judgement
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
