import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'
import { loadConfig } from '../config/load.js'
import { deriveChecks, renderReport, runChecks } from '../doctor/doctor.js'
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
            `warning: ${finding.check.binary} is missing — ${finding.check.reason}. Install: ${finding.check.hint}`,
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
    })

  program
    .command('sweep')
    .description(
      'Sweep leftover workflow processes: automated browsers, or the processes of torn-down provisioning lanes.',
    )
    .option(
      '--browsers',
      'list surviving automated-browser processes; exits 1 while any are alive',
    )
    .option(
      '--kill',
      'with --browsers: kill each survivor by its exact pid, then re-list',
    )
    .option('--lane-processes', 'sweep processes belonging to provisioning lanes')
    .option('--hook', 'with --lane-processes: run quietly as the session-end hook')
    .action(
      (options: {
        browsers?: boolean
        kill?: boolean
        laneProcesses?: boolean
        hook?: boolean
      }) => {
        if (options.browsers) {
          const script = fileURLToPath(
            new URL('../../runtime/sweeps/browser-sweep.sh', import.meta.url),
          )
          const result = spawnSync('sh', [script, ...(options.kill ? ['--kill'] : [])], {
            stdio: 'inherit',
          })
          process.exitCode = result.status ?? 1
          return
        }
        if (options.laneProcesses) {
          // Lane-process sweeping lands with provisioning; until then there are
          // no lanes to sweep, and the session-end hook must stay silent.
          if (!options.hook) console.log('No provisioned lanes to sweep.')
          return
        }
        console.error('Specify what to sweep: --browsers or --lane-processes.')
        process.exitCode = 1
      },
    )

  return program
}
