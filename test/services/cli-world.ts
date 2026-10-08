// A fake `claude` answering from the captured fixtures (test/domain/fixtures),
// so service tests run against real CLI output.
import { runs } from '../domain/fixtures/cli-runs.ts'
import { type FakeProcess, out } from './fakes.ts'

const basename = (path: string): string => path.split('/').filter(Boolean).at(-1) ?? ''

const opResult = (command: string, id: string, scope = 'user') =>
  `${JSON.stringify({ command, outcome: 'ok', plugin: id, pluginId: id, scope, message: `Successfully ${command}d plugin: ${id}` })}\n`

/** Answers version, list, validate (by folder name), details and ops. */
export const fixtureCli = (process: FakeProcess): FakeProcess =>
  process
    .when(['--version'], out('2.1.292 (Claude Code)\n'))
    .when(['list', '--json'], out(runs.list.stdout))
    .when(['validate'], argv => {
      const name = basename(argv.at(-1) ?? '')
      const run = (runs as Record<string, { stdout: string; exitCode: number }>)[`validate-${name}`]
      return run === undefined ? out('', 1, 'no such folder') : out(run.stdout, run.exitCode)
    })
    .when(['details'], argv =>
      argv.includes('plain-skill@fixtures')
        ? out(runs['details-plain-skill'].stdout)
        : out(runs['details-turn-band'].stdout),
    )
    .when(['enable'], argv => out(opResult('enable', argv[3] ?? '')))
    .when(['disable'], argv => out(opResult('disable', argv[3] ?? '')))
    // The CLI says whether it kept the data folder (`keptData`), as it was asked.
    .when(['uninstall'], argv =>
      out(
        argv.includes('--keep-data')
          ? runs['uninstall-ok'].stdout.replace('"keptData":false', '"keptData":true')
          : runs['uninstall-ok'].stdout,
      ),
    )
    .when(['update'], out(runs['update-bumped'].stdout))
    .when(['install'], out(runs['install-ok-user'].stdout))

export const FIXTURE_MODS = ['broken', 'quiet-bash', 'redactor', 'spawner', 'turn-band']

/**
 * A fixture update: turn-band's folder moves to 0.4.0 and its module now
 * calls `$.process.run` (a new notable capability). turn-band comes from a
 * folder marketplace, so `list --json` shows the folder's version.
 */
export const bumpTurnBand = (process: FakeProcess): FakeProcess =>
  process
    .when(['list', '--json'], () => {
      const list = JSON.parse(runs.list.stdout) as Array<Record<string, unknown>>
      const bumped = list.map(entry =>
        entry.id === 'turn-band@fixtures' ? { ...entry, folderVersion: '0.4.0' } : entry,
      )
      return out(JSON.stringify(bumped))
    })
    .when(['validate'], argv =>
      basename(argv.at(-1) ?? '') === 'turn-band'
        ? out(
            runs['validate-turn-band'].stdout.replace(
              'calls: $.clock.now,',
              'calls: $.clock.now, $.process.run,',
            ),
          )
        : undefined,
    )
