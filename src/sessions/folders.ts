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
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { git } from '../provisioning/runtime.js'

/**
 * Session folders: each Claude Code session keeps everything it writes — its
 * ledger, scratch files, logs, caches — in `.sessions/<session id>/` inside the
 * project's main checkout, where neither a reboot nor a temp cleaner reaches
 * it, and every linked worktree reaches the same folder by absolute path.
 * Subagents share their session's id and therefore its folder. A session can
 * be resumed for as long as Claude Code keeps its transcript, so its folder
 * lives exactly that long. Each folder records the projects directory its
 * session's transcripts live in, so a sweep run under another Claude Code
 * configuration still judges it where its transcript really is: a folder
 * expires only when that directory is readable and holds no transcript for the
 * session, and the sweep removes only expired folders — never one it cannot
 * prove expired.
 */

const SESSIONS_DIRECTORY = '.sessions'

const PROJECTS_DIRECTORY_MARKER = '.projects-directory'

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const TRANSCRIPT_EXTENSION = '.jsonl'

type SessionFolder = {
  sessionId: string
  path: string
  /** The projects directory the folder is judged against. */
  projectsDirectory: string
}

type UndecidedSessionFolder = SessionFolder & { reason: string }

type SessionFolderListing = {
  sessionsDirectory: string
  /** Folders whose session no transcript names any more. */
  expired: SessionFolder[]
  /** Folders whose session Claude Code can still resume. */
  kept: SessionFolder[]
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

/**
 * This session's folder in the main checkout, created when missing, recording
 * the projects directory that keeps this session's transcript.
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
  const folder = join(sessionsDirectoryOf(projectDirectory), sessionId)
  mkdirSync(folder, { recursive: true })
  const marker = join(folder, PROJECTS_DIRECTORY_MARKER)
  const recorded = `${resolve(projectsDirectory)}\n`
  if (readOrNothing(marker) !== recorded) writeFileSync(marker, recorded)
  return folder
}

function readOrNothing(path: string) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
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

/** A project directory, or a link that resolves to one; anything else holds no transcripts. */
function holdsTranscripts(projectsDirectory: string, entry: Dirent) {
  if (entry.isDirectory()) return true
  if (!entry.isSymbolicLink()) return false
  try {
    return statSync(join(projectsDirectory, entry.name)).isDirectory()
  } catch {
    return false
  }
}

/**
 * The ids of every session whose transcript any project directory holds.
 * Throws when any of them cannot be read: an unread directory could hold the
 * transcript that keeps a folder alive.
 */
function sessionsWithTranscripts(projectsDirectory: string) {
  const sessionIds = new Set<string>()
  try {
    for (const project of readdirSync(projectsDirectory, { withFileTypes: true })) {
      if (!holdsTranscripts(projectsDirectory, project)) continue
      for (const name of readdirSync(join(projectsDirectory, project.name))) {
        if (name.endsWith(TRANSCRIPT_EXTENSION)) {
          sessionIds.add(name.slice(0, -TRANSCRIPT_EXTENSION.length))
        }
      }
    }
  } catch (error) {
    throw new Error(
      `cannot read Claude Code's session transcripts in ${projectsDirectory}: ${(error as Error).message}`,
    )
  }
  return sessionIds
}

function sessionFolderEntries(sessionsDirectory: string): Dirent[] {
  try {
    return readdirSync(sessionsDirectory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/** The projects directory a folder recorded, or the sweep's own for a folder that recorded none. */
function recordedProjectsDirectory(folder: string, sweepProjectsDirectory: string) {
  const recorded = readOrNothing(join(folder, PROJECTS_DIRECTORY_MARKER))
  return recorded === undefined ? sweepProjectsDirectory : recorded.trim()
}

/**
 * Every session folder in the main checkout, each judged against the projects
 * directory it recorded. The folders are listed before any transcript is read,
 * so a session that starts mid-sweep is never judged without its transcript.
 * Only directories named like a session id are session folders; anything else
 * in `.sessions/` is never listed.
 */
function listSessionFolders(
  projectDirectory: string,
  projectsDirectory: string,
): SessionFolderListing {
  const sessionsDirectory = sessionsDirectoryOf(projectDirectory)
  const folders = sessionFolderEntries(sessionsDirectory)
    .filter((entry) => entry.isDirectory() && SESSION_ID.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .map((sessionId) => {
      const path = join(sessionsDirectory, sessionId)
      return {
        sessionId,
        path,
        projectsDirectory: recordedProjectsDirectory(path, projectsDirectory),
      }
    })

  const transcripts = new Map<string, Set<string> | Error>()
  const transcriptsIn = (directory: string) => {
    let found = transcripts.get(directory)
    if (found === undefined) {
      try {
        found = sessionsWithTranscripts(directory)
      } catch (error) {
        found = error as Error
      }
      transcripts.set(directory, found)
    }
    return found
  }

  const listing: SessionFolderListing = {
    sessionsDirectory,
    expired: [],
    kept: [],
    undecided: [],
  }
  for (const folder of folders) {
    if (!isAbsolute(folder.projectsDirectory)) {
      listing.undecided.push({
        ...folder,
        reason: `${join(folder.path, PROJECTS_DIRECTORY_MARKER)} records no absolute projects directory`,
      })
      continue
    }
    const found = transcriptsIn(folder.projectsDirectory)
    if (found instanceof Error)
      listing.undecided.push({ ...folder, reason: found.message })
    else if (found.has(folder.sessionId)) listing.kept.push(folder)
    else listing.expired.push(folder)
  }
  return listing
}

/** Remove the expired session folders, leaving every kept and undecided one. */
function removeExpiredSessionFolders(
  projectDirectory: string,
  projectsDirectory: string,
) {
  const removed: SessionFolder[] = []
  const failed: { folder: SessionFolder; reason: string }[] = []
  for (const folder of listSessionFolders(projectDirectory, projectsDirectory).expired) {
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
