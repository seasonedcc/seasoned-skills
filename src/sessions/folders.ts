import { type Dirent, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveMainRepository } from '../provisioning/runtime.js'

/**
 * Session folders: each Claude Code session keeps everything it writes — its
 * ledger, scratch files, logs, caches — in `.sessions/<session id>/` inside the
 * project's main checkout, where neither a reboot nor a temp cleaner reaches
 * it, and every linked worktree reaches the same folder by absolute path.
 * Subagents share their session's id and therefore its folder. A session can
 * be resumed for as long as Claude Code keeps its transcript, so its folder
 * lives exactly that long: a folder expires when no project directory holds
 * the session's transcript any more, and the sweep removes only expired
 * folders — never one it cannot prove expired.
 */

const SESSIONS_DIRECTORY = '.sessions'

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const TRANSCRIPT_EXTENSION = '.jsonl'

type SessionFolder = { sessionId: string; path: string }

type SessionFolderListing = {
  sessionsDirectory: string
  /** Folders whose session no transcript names any more. */
  expired: SessionFolder[]
  /** Folders whose session Claude Code can still resume. */
  kept: SessionFolder[]
}

type TranscriptOptions = {
  /** Claude Code's projects directory, holding every project's transcripts. */
  projectsDirectory: string
  /** The session running the sweep, whose own transcript proves the directory right. */
  currentSessionId?: string | undefined
}

function sessionsDirectoryOf(projectDirectory: string) {
  return join(resolveMainRepository(projectDirectory), SESSIONS_DIRECTORY)
}

/** This session's folder in the main checkout, created when missing. */
function sessionFolder(projectDirectory: string, sessionId: string | undefined) {
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
  return folder
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
 * The ids of every session whose transcript any project directory holds.
 * Throws when any of them cannot be read: an unread directory could hold the
 * transcript that keeps a folder alive.
 */
function sessionsWithTranscripts({
  projectsDirectory,
  currentSessionId,
}: TranscriptOptions) {
  const sessionIds = new Set<string>()
  try {
    for (const project of readdirSync(projectsDirectory, { withFileTypes: true })) {
      if (!project.isDirectory() && !project.isSymbolicLink()) continue
      for (const name of readdirSync(join(projectsDirectory, project.name))) {
        if (name.endsWith(TRANSCRIPT_EXTENSION)) {
          sessionIds.add(name.slice(0, -TRANSCRIPT_EXTENSION.length))
        }
      }
    }
  } catch (error) {
    throw new Error(
      `cannot read Claude Code's session transcripts in ${projectsDirectory}: ${(error as Error).message} — no session folder counts as expired while its transcript might still be there.`,
    )
  }
  if (
    currentSessionId !== undefined &&
    SESSION_ID.test(currentSessionId) &&
    !sessionIds.has(currentSessionId)
  ) {
    throw new Error(
      `this session's own transcript (${currentSessionId}) is not in ${projectsDirectory}, so it is not where Claude Code keeps the transcripts — no session folder counts as expired.`,
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

/**
 * Every session folder in the main checkout, split by whether its session's
 * transcript is gone. Only directories named like a session id are session
 * folders; anything else in `.sessions/` is never listed.
 */
function listSessionFolders(
  projectDirectory: string,
  options: TranscriptOptions,
): SessionFolderListing {
  const sessionsDirectory = sessionsDirectoryOf(projectDirectory)
  const transcripts = sessionsWithTranscripts(options)
  const listing: SessionFolderListing = { sessionsDirectory, expired: [], kept: [] }
  const folders = sessionFolderEntries(sessionsDirectory)
    .filter((entry) => entry.isDirectory() && SESSION_ID.test(entry.name))
    .map((entry) => entry.name)
    .sort()
  for (const sessionId of folders) {
    const folder = { sessionId, path: join(sessionsDirectory, sessionId) }
    if (transcripts.has(sessionId)) listing.kept.push(folder)
    else listing.expired.push(folder)
  }
  return listing
}

/** Remove the expired session folders, and nothing when the listing cannot be made. */
function removeExpiredSessionFolders(
  projectDirectory: string,
  options: TranscriptOptions,
) {
  const removed: SessionFolder[] = []
  const failed: { folder: SessionFolder; reason: string }[] = []
  for (const folder of listSessionFolders(projectDirectory, options).expired) {
    try {
      rmSync(folder.path, { recursive: true, force: true })
      removed.push(folder)
    } catch (error) {
      failed.push({ folder, reason: (error as Error).message })
    }
  }
  return { removed, failed }
}

export type { SessionFolder, SessionFolderListing }
export {
  claudeProjectsDirectory,
  listSessionFolders,
  removeExpiredSessionFolders,
  sessionFolder,
}
