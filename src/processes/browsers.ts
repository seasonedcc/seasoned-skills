import { spawnSync } from 'node:child_process'
import { isKillable, type Ownership, withOwnership } from './ownership.js'

/**
 * The automated-browser sweep: this user's agent-browser daemons and the
 * Chrome for Testing processes under an .agent-browser install — never this
 * process or its ancestors, whose command lines may name them — each with the
 * Claude Code instance it belongs to — agent-browser hands its caller's
 * environment down to the daemon and every browser process it launches. Kills
 * are SIGKILL by exact pid, and only of this session's own browsers and those
 * ended sessions left behind.
 */

type BrowserProcessKind = 'Chrome for Testing' | 'agent-browser daemon'

type BrowserProcess = {
  processId: number
  age: string
  kind: BrowserProcessKind
  command: string
}

const BROWSER_PATTERNS: [BrowserProcessKind, RegExp][] = [
  ['Chrome for Testing', /[.]agent-browser\/browsers.*Chrome for Testing/],
  ['agent-browser daemon', /agent-browser-(darwin|linux)-/],
]

/** Parses `ps -A -ww -o pid=,uid=,etime=,command=`, keeping one user's browsers. */
function browserProcessesFromPsOutput(output: string, userId: number) {
  const browsers: BrowserProcess[] = []
  for (const line of output.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/)
    if (!match || Number(match[2]) !== userId) continue
    const command = match[4] ?? ''
    const kind = BROWSER_PATTERNS.find(([, pattern]) => pattern.test(command))?.[0]
    if (kind === undefined) continue
    browsers.push({ processId: Number(match[1]), age: match[3] ?? '', kind, command })
  }
  return browsers
}

function listBrowserProcesses() {
  const result = spawnSync('ps', ['-A', '-ww', '-o', 'pid=,uid=,etime=,command='], {
    encoding: 'utf8',
  })
  return withOwnership(
    browserProcessesFromPsOutput(result.stdout ?? '', process.getuid?.() ?? -1),
  )
}

/** Kill each browser process this session may kill by its exact pid. */
function killBrowserProcesses(browsers: (BrowserProcess & { ownership: Ownership })[]) {
  const killed: (BrowserProcess & { ownership: Ownership })[] = []
  for (const browser of browsers) {
    if (!isKillable(browser.ownership)) continue
    try {
      process.kill(browser.processId, 'SIGKILL')
    } catch {
      continue
    }
    killed.push(browser)
  }
  return killed
}

export type { BrowserProcess, BrowserProcessKind }
export { browserProcessesFromPsOutput, killBrowserProcesses, listBrowserProcesses }
