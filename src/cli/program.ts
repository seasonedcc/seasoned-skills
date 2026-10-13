import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import { Command } from 'commander'
import { loadConfig } from '../config/load.js'
import { buildCorpus } from '../corpus/build.js'
import { corpusBuiltBy, corpusCacheRoot } from '../corpus/cache.js'
import { checkTarget, deriveChecks, renderReport, runChecks } from '../doctor/doctor.js'
import { applyInstall, planInstall } from '../install/install.js'
import { collectAnswers } from '../install/interactive.js'
import {
  type BrowserProcess,
  killBrowserProcesses,
  listBrowserProcesses,
} from '../processes/browsers.js'
import { describeOwnership, isKillable, type Ownership } from '../processes/ownership.js'
import {
  type LaneProcessCandidate,
  listLaneProcesses,
  provisionLane,
  sessionEndCleansUpProcesses,
  sweepLaneProcesses,
  teardownLane,
} from '../provisioning/index.js'
import { degrade, sync } from '../sync/sync.js'

const require = createRequire(import.meta.url)
const { version } = require('../../package.json') as { version: string }

export function buildProgram(): Command {
  const program = new Command()

  program
    .name('seasoned-skills')
    .description(
      'The Seasoned workflow — installed with one command and kept current by upgrading a version.',
    )
    .version(version)

  program
    .command('sync')
    .description(
      'Regenerate every generated file from the configuration and project content. Idempotent; fails loud, degrading the project to the repair kit when inputs are broken.',
    )
    .action(async () => {
      const root = process.cwd()
      try {
        const result = await sync(root)
        console.log(`Generated ${result.generated.length} files.`)
        // Doctor in warn mode: advisory only, missing tools never fail a sync.
        const missing = runChecks(deriveChecks(result.config)).filter((f) => !f.ok)
        for (const finding of missing) {
          console.warn(
            `warning: ${checkTarget(finding.check)} is missing — ${finding.check.reason}. Install: ${finding.check.hint}`,
          )
        }
      } catch (error) {
        degrade(root, error as Error)
        console.error((error as Error).message)
        console.error(
          '\nThe generated workflow has been removed down to the repair kit. Fix the inputs above and run `seasoned-skills sync` again.',
        )
        process.exitCode = 1
      }
    })

  program
    .command('install')
    .description(
      'Adopt the workflow: an interactive one-time scaffold of the configuration (asking every option the rulings give no default) and the committed artifacts, then the shaping corpus this machine still needs — finishing with a sync and a doctor report. Never overwrites what exists.',
    )
    .action(async () => {
      const root = process.cwd()
      try {
        const cacheRoot = corpusCacheRoot()
        const corpusNeedsBuilding = corpusBuiltBy(cacheRoot) !== version
        const { answers, bookPath } = await collectAnswers(root, { corpusNeedsBuilding })
        const plan = planInstall(root, answers)
        applyInstall(root, plan)
        for (const file of plan.files) console.log(`created ${file.path}`)
        for (const path of plan.skipped) console.log(`kept existing ${path}`)
        if (corpusNeedsBuilding) {
          console.log(`Building the shaping corpus at ${cacheRoot}.`)
          buildCorpus(cacheRoot, bookPath === undefined ? {} : { book: bookPath })
        }
        const result = await sync(root)
        console.log(`Generated ${result.generated.length} files.`)
        console.log(renderReport(runChecks(deriveChecks(result.config))))
      } catch (error) {
        console.error((error as Error).message)
        process.exitCode = 1
      }
    })

  program
    .command('doctor')
    .description(
      'Check this machine for the binaries the configured workflow depends on. Advisory: reports and points at installs, never blocks.',
    )
    .action(async () => {
      try {
        const config = await loadConfig(process.cwd())
        console.log(renderReport(runChecks(deriveChecks(config))))
      } catch (error) {
        console.log((error as Error).message)
        console.log(
          'Doctor could not derive its checklist without a loadable configuration.',
        )
      }
      const builtBy = corpusBuiltBy(corpusCacheRoot())
      if (builtBy === undefined) {
        console.log(
          'Shaping corpus cache: missing — run `seasoned-skills corpus` to build it; until then the generated shaping skill carries no references.',
        )
      } else if (builtBy !== version) {
        console.log(
          `Shaping corpus cache: stale (built by ${builtBy}, this package is ${version}) — run \`seasoned-skills corpus\` to rebuild.`,
        )
      } else {
        console.log('Shaping corpus cache: present and current.')
      }
    })

  program
    .command('corpus')
    .description(
      "Build the shaping corpus into this machine's cache: fetch the freely published sources from their authors' sites, vendor the one commercial book from your own compiled copy when given, and verify the result. The built corpus lives only on this machine.",
    )
    .option(
      '--book <path>',
      "path to your own compiled copy of the book (a folder of numbered markdown chapters with images); without it the workflow's distilled account stands in",
    )
    .option('--force', 're-download sources that are already present')
    .action((options: { book?: string; force?: boolean }) => {
      try {
        buildCorpus(corpusCacheRoot(), options)
        console.log(
          `Corpus built at ${corpusCacheRoot()}. Run \`seasoned-skills sync\` in each project to weave it in.`,
        )
      } catch (error) {
        console.error((error as Error).message)
        process.exitCode = 1
      }
    })

  program
    .command('provision')
    .description(
      "Set up an isolated worktree lane over the repositories the run covers, from what each declares in the configuration's resource table: worktrees, ports, databases, cache-store index, dependencies, and seed data. Idempotent — re-running keeps the lane's allocation and never reseeds existing databases.",
    )
    .argument(
      '<lane>',
      'the lane name, a single directory name; also names the worktree directories',
    )
    .option(
      '--repo <path>',
      'a declared repository this lane covers, by its exact declared path; repeatable (default: the first declared repository)',
      (path: string, paths: string[]) => [...paths, path],
      [] as string[],
    )
    .option(
      '--branch <branch>',
      'branch the worktrees check out (default worktree/<lane>)',
    )
    .option(
      '--base <ref>',
      "base reference for a new branch (default origin's HEAD branch)",
    )
    .option('--skip-provision', 'create the worktrees only')
    .option('--skip-seed', 'provision without seeding')
    .option('--fresh-seed', "re-anchor the seed's demo data to today")
    .action(
      async (
        lane: string,
        options: {
          repo: string[]
          branch?: string
          base?: string
          skipProvision?: boolean
          skipSeed?: boolean
          freshSeed?: boolean
        },
      ) => {
        try {
          const config = await loadConfig(process.cwd())
          const { repo, ...rest } = options
          await provisionLane(process.cwd(), config.provisioning, lane, {
            ...rest,
            repositoryPaths: repo,
          })
        } catch (error) {
          console.error((error as Error).message)
          process.exitCode = 1
        }
      },
    )

  program
    .command('teardown')
    .description(
      "Remove a provisioned lane across every declared repository: its processes (by exact pid, only those that listen on the lane's ports, run from inside its worktrees, and were started by this session or an ended one), its cache-store index, its whole database family including derived names, and its worktrees. Refuses a lane another live Claude Code session is using, one whose processes cannot be listed, or one with uncommitted changes; never touches the branch.",
    )
    .argument('<lane>', 'the lane to remove, by its directory name')
    .option(
      '--force',
      "remove the lane even when a worktree has uncommitted changes or another live session is using it; that session's processes are still left running",
    )
    .action(async (lane: string, options: { force?: boolean }) => {
      try {
        const config = await loadConfig(process.cwd())
        await teardownLane(process.cwd(), config.provisioning, lane, options)
      } catch (error) {
        console.error((error as Error).message)
        process.exitCode = 1
      }
    })

  program
    .command('sweep')
    .description(
      "List leftover workflow processes — automated browsers, or processes running from inside provisioning lanes — with the Claude Code session each belongs to, and with --kill, kill the ones this session may: its own and those of ended sessions, never another live session's or an unmarked process.",
    )
    .option(
      '--browsers',
      "list this user's automated-browser processes; exits 1 while any this session may kill are alive",
    )
    .option('--lane-processes', 'list the processes running from inside worktree lanes')
    .option(
      '--kill',
      "kill the listed processes this session may kill — its own and ended sessions' — each by its exact pid",
    )
    .option('--lane <lane>', "with --lane-processes: only that lane's processes")
    .option(
      '--hook',
      'with --lane-processes: run quietly as the session-end hook, acting only when the session is truly over; without --kill it does nothing, and the generated hook passes --kill',
    )
    .action(
      async (options: {
        browsers?: boolean
        kill?: boolean
        laneProcesses?: boolean
        lane?: string
        hook?: boolean
      }) => {
        if (options.browsers) {
          try {
            await sweepBrowsers(options.kill === true)
          } catch (error) {
            console.error((error as Error).message)
            process.exitCode = 1
          }
          return
        }
        if (options.laneProcesses) {
          if (options.hook) {
            // The session-end hook pipes its JSON payload through; only the
            // reasons that mean "this machine's session is truly over" sweep,
            // and nothing may ever block session end.
            try {
              if (!options.kill || !sessionEndCleansUpProcesses(sessionEndReason()))
                return
              const config = await loadConfig(process.cwd())
              sweepLaneProcesses(process.cwd(), config.provisioning)
            } catch {
              // Silent by contract.
            }
            return
          }
          try {
            const config = await loadConfig(process.cwd())
            const laneOption = options.lane === undefined ? {} : { lane: options.lane }
            if (options.kill) {
              const { candidates, terminated, failed } = sweepLaneProcesses(
                process.cwd(),
                config.provisioning,
                laneOption,
              )
              reportLaneSweep(candidates, new Set(terminated), new Set(failed))
            } else {
              reportLaneProcesses(
                listLaneProcesses(process.cwd(), config.provisioning, laneOption),
              )
            }
          } catch (error) {
            console.error((error as Error).message)
            process.exitCode = 1
          }
          return
        }
        console.error('Specify what to sweep: --browsers or --lane-processes.')
        process.exitCode = 1
      },
    )

  return program
}

/** The session-end reason from the hook payload on stdin, if one is piped. */
function sessionEndReason(): string | undefined {
  if (process.stdin.isTTY) return undefined
  try {
    const payload = JSON.parse(readFileSync(0, 'utf8')) as { reason?: unknown }
    return typeof payload.reason === 'string' ? payload.reason : undefined
  } catch {
    return undefined
  }
}

function processCount(count: number) {
  return `${count} ${count === 1 ? 'process' : 'processes'}`
}

const KEPT_EXPLANATION =
  "Another live session's processes and unmarked ones are never killed."

function laneProcessLine(verdict: string, candidate: LaneProcessCandidate) {
  return `  ${verdict.padEnd(11)} ${candidate.processId}  ${candidate.lane}  ${describeOwnership(candidate.ownership)}  ${candidate.command}`
}

function reportLaneProcesses(candidates: LaneProcessCandidate[]) {
  if (candidates.length === 0) {
    console.log('No lane processes to sweep.')
    return
  }
  for (const candidate of candidates) {
    console.log(
      laneProcessLine(isKillable(candidate.ownership) ? 'would kill' : 'keep', candidate),
    )
  }
  const killable = candidates.filter((candidate) => isKillable(candidate.ownership))
  console.log(
    `${killable.length} of ${candidates.length} would be killed with --kill: this session's own and those of ended sessions. ${KEPT_EXPLANATION}`,
  )
}

function reportLaneSweep(
  candidates: LaneProcessCandidate[],
  terminated: Set<LaneProcessCandidate>,
  failed: Set<LaneProcessCandidate>,
) {
  if (candidates.length === 0) {
    console.log('No lane processes to sweep.')
    return
  }
  for (const candidate of candidates) {
    const verdict = terminated.has(candidate)
      ? 'terminated'
      : failed.has(candidate)
        ? 'kill failed'
        : isKillable(candidate.ownership)
          ? 'exited'
          : 'kept'
    console.log(laneProcessLine(verdict, candidate))
  }
  console.log(
    `Terminated ${terminated.size} of ${processCount(candidates.length)} found in lanes. ${KEPT_EXPLANATION}`,
  )
}

type ClassifiedBrowser = BrowserProcess & { ownership: Ownership }

function reportBrowsers(browsers: ClassifiedBrowser[]) {
  for (const kind of ['Chrome for Testing', 'agent-browser daemon'] as const) {
    const ofKind = browsers.filter((browser) => browser.kind === kind)
    console.log(`${kind} processes: ${ofKind.length}`)
    for (const browser of ofKind) {
      console.log(
        `  pid=${browser.processId} age=${browser.age} ${describeOwnership(browser.ownership)}`,
      )
    }
  }
  const killable = browsers.filter((browser) => isKillable(browser.ownership))
  const kept = browsers.length - killable.length
  const keptNote = kept === 0 ? '' : ` ${kept} kept. ${KEPT_EXPLANATION}`
  if (killable.length > 0) {
    console.log(
      `SWEEP: ${processCount(killable.length)} of this session or ended sessions still alive — NOT clean.${keptNote}`,
    )
    process.exitCode = 1
    return
  }
  console.log(
    `SWEEP: clean — no browser process of this session or an ended session is alive.${keptNote}`,
  )
}

async function sweepBrowsers(kill: boolean) {
  let browsers = listBrowserProcesses()
  if (kill) {
    const killed = killBrowserProcesses(browsers)
    for (const browser of killed) console.log(`killing pid=${browser.processId}`)
    if (killed.length > 0) await delay(2000)
    browsers = listBrowserProcesses()
  }
  reportBrowsers(browsers)
}
