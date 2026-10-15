import {
  type Dirent,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
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
 * lives that long: the folder records the projects directory its transcript
 * was found in, and the sweep removes it once two reads of that directory find
 * the transcript in none of its project directories. When in doubt, a folder
 * is kept.
 */

const SESSIONS_DIRECTORY = '.sessions'

const PROJECTS_RECORD = '.projects'

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

type SessionFolder = { sessionId: string; path: string }

type KeptSessionFolder = SessionFolder & { reason: string }

type SessionFolderListing = {
  sessionsDirectory: string
  /** Folders whose transcript no project directory holds any more. */
  expired: SessionFolder[]
  /** Folders whose transcript a project directory still holds. */
  resumable: SessionFolder[]
  /** Folders kept because the sweep cannot tell whether their transcript remains. */
  kept: KeptSessionFolder[]
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
 * The ids of the sessions whose transcript some project directory holds,
 * following links to project directories and passing over dangling links and
 * stray files. Anything else that cannot be read throws, since the transcript
 * may be exactly there.
 */
function sessionsWithTranscripts(projectsDirectory: string) {
  const sessions = new Set<string>()
  for (const project of readdirSync(projectsDirectory)) {
    let entries: string[]
    try {
      entries = readdirSync(join(projectsDirectory, project))
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') continue
      throw error
    }
    for (const entry of entries) {
      if (entry.endsWith('.jsonl')) sessions.add(basename(entry, '.jsonl'))
    }
  }
  return sessions
}

function holdsTranscript(projectsDirectory: string, sessionId: string) {
  try {
    return sessionsWithTranscripts(projectsDirectory).has(sessionId)
  } catch {
    return false
  }
}

/**
 * The session id Claude Code sets for every command it runs, refused when it
 * is missing or is not a session id.
 */
function claudeCodeSessionId(sessionId: string | undefined) {
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
  return sessionId
}

/**
 * Where a session's folder sits in the main checkout, whether or not it
 * exists yet. Nothing is created, and a value that is not a session id never
 * names a path.
 */
function sessionFolderPath(projectDirectory: string, sessionId: string) {
  if (!SESSION_ID.test(sessionId)) {
    throw new Error(
      `${JSON.stringify(sessionId)} is not a Claude Code session id, so no session folder is named after it.`,
    )
  }
  return join(sessionsDirectoryOf(projectDirectory), sessionId)
}

/**
 * This session's folder in the main checkout, created when missing. When a
 * project directory holds the session's transcript, the folder records the
 * projects directory, which is all the sweep needs to tell when it is gone.
 */
function sessionFolder(
  projectDirectory: string,
  sessionId: string | undefined,
  projectsDirectory: string,
) {
  const id = claudeCodeSessionId(sessionId)
  const path = sessionFolderPath(projectDirectory, id)
  mkdirSync(path, { recursive: true })
  const record = join(path, PROJECTS_RECORD)
  if (holdsTranscript(projectsDirectory, id)) {
    writeFileSync(record, `${projectsDirectory}\n`)
  }
  return { path, recorded: existsSync(record) }
}

function sessionFolderEntries(sessionsDirectory: string): Dirent[] {
  try {
    return readdirSync(sessionsDirectory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

function recordedProjectsDirectory(folder: SessionFolder) {
  try {
    const recorded = readFileSync(join(folder.path, PROJECTS_RECORD), 'utf8').trim()
    return isAbsolute(recorded) ? recorded : undefined
  } catch {
    return undefined
  }
}

/**
 * Every session folder in the main checkout, listed before any is judged, so
 * a session that starts mid-sweep is never judged at all. Each recorded
 * projects directory is read twice, back to back, and a folder expires only
 * when neither read finds its transcript, so a transcript Claude Code was
 * moving between project directories during the first read keeps its
 * folder. Only directories named like a session id are session folders.
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
    resumable: [],
    kept: [],
  }
  const reads = new Map<string, Set<string>[] | { reason: string }>()
  function readTwice(projectsDirectory: string) {
    let read = reads.get(projectsDirectory)
    if (read === undefined) {
      try {
        read = [
          sessionsWithTranscripts(projectsDirectory),
          sessionsWithTranscripts(projectsDirectory),
        ]
      } catch (error) {
        read = {
          reason: `${projectsDirectory} cannot be fully read: ${(error as Error).message}`,
        }
      }
      reads.set(projectsDirectory, read)
    }
    return read
  }
  for (const folder of folders) {
    const projectsDirectory = recordedProjectsDirectory(folder)
    if (projectsDirectory === undefined) {
      listing.kept.push({ ...folder, reason: 'it records no projects directory' })
      continue
    }
    const read = readTwice(projectsDirectory)
    if ('reason' in read) {
      listing.kept.push({ ...folder, reason: read.reason })
    } else if (read.some((sessions) => sessions.has(folder.sessionId))) {
      listing.resumable.push(folder)
    } else {
      listing.expired.push(folder)
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

export type { KeptSessionFolder, SessionFolder, SessionFolderListing }
export {
  claudeCodeSessionId,
  claudeProjectsDirectory,
  listSessionFolders,
  removeExpiredSessionFolders,
  sessionFolder,
  sessionFolderPath,
}
