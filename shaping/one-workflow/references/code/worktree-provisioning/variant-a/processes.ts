import { spawnSync } from 'node:child_process'
import { userInfo } from 'node:os'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  laneProcessesFromLsofOutput,
  sessionEndCleansUpProcesses,
  WORKTREES_DIRECTORY_NAME,
} from './common'
import { log, readStdinJson, resolveMainRepository } from './runtime'

const SERVER_COMMAND_NAMES = ['node', 'pnpm', 'turbo']

function laneProcesses(worktreesRoot: string) {
  const result = spawnSync(
    'lsof',
    [
      '-a',
      '-u',
      userInfo().username,
      '-d',
      'cwd',
      ...SERVER_COMMAND_NAMES.flatMap((name) => ['-c', name]),
      '-F',
      'pn',
    ],
    { encoding: 'utf8' }
  )
  return laneProcessesFromLsofOutput(result.stdout ?? '', worktreesRoot)
}

function ownProcessIds() {
  const ids = new Set<number>()
  let current = process.pid
  while (current > 1 && !ids.has(current)) {
    ids.add(current)
    const result = spawnSync('ps', ['-o', 'ppid=', '-p', String(current)], {
      encoding: 'utf8',
    })
    current = Number(result.stdout.trim())
  }
  return ids
}

function commandLine(processId: number) {
  const result = spawnSync('ps', ['-o', 'command=', '-p', String(processId)], {
    encoding: 'utf8',
  })
  return result.stdout.trim()
}

async function main() {
  const { values } = parseArgs({
    options: {
      kill: { type: 'boolean', default: false },
      lane: { type: 'string' },
      hook: { type: 'boolean', default: false },
    },
  })

  if (values.hook) {
    const payload = await readStdinJson()
    if (!sessionEndCleansUpProcesses(payload.reason)) {
      log(
        `session ended with reason "${payload.reason}", keeping lane processes`
      )
      return
    }
  }

  const worktreesRoot = resolve(
    dirname(resolveMainRepository()),
    WORKTREES_DIRECTORY_NAME
  )
  const own = ownProcessIds()
  const processes = laneProcesses(worktreesRoot).filter(
    (candidate) =>
      !own.has(candidate.processId) &&
      (!values.lane || candidate.lane === values.lane)
  )

  if (processes.length === 0) {
    log('no processes running in worktree lanes')
    return
  }

  for (const { processId, lane } of processes) {
    const command = commandLine(processId)
    if (values.kill || values.hook) {
      try {
        process.kill(processId, 'SIGTERM')
        log(`terminated ${processId} in lane ${lane}: ${command}`)
      } catch {
        log(`process ${processId} in lane ${lane} already exited`)
      }
    } else {
      console.log(`${lane}\t${processId}\t${command}`)
    }
  }
  if (!values.kill && !values.hook) {
    log('kill them with: pnpm run worktree:processes --kill [--lane <lane>]')
  }
}

main().catch((error) => {
  log(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
