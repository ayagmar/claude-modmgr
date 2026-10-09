// A fake `claude` answering from the captured fixtures (test/domain/fixtures),
// so service tests run against real CLI output.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { planProbe, probeKey } from '../../plugin/hooks/domain/detector.ts'
import { lruSetMany } from '../../plugin/hooks/domain/lru.ts'
import { CAPS, type DetectEntry } from '../../plugin/hooks/domain/store-schema.ts'
import type { Catalog } from '../../plugin/hooks/services/catalog.ts'
import type { StoreService } from '../../plugin/hooks/services/store.ts'
import { runs } from '../domain/fixtures/cli-runs.ts'
import { type FakeFs, type FakeProcess, out } from './fakes.ts'

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

/** Each fixture mod's plugin.json (test/fixture-mods), where `list --json` says its folder is. */
export const fixtureManifests = (fs: FakeFs): FakeFs => {
  for (const name of [...FIXTURE_MODS, 'plain-skill']) {
    const text = readFileSync(
      join(import.meta.dirname, '..', 'fixture-mods', name, '.claude-plugin', 'plugin.json'),
      'utf8',
    )
    fs.files.set(`/tmp/modmgr-fixtures/mkt/${name}/.claude-plugin/plugin.json`, text)
  }
  return fs
}

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

/**
 * Records catalogue entries as mods in the detector's cache, as its probes
 * would (every entry a probe can check, by default): Discover lists mods only.
 * Returns how many it marked.
 */
export const markMods = (
  store: Pick<StoreService, 'update'>,
  catalog: Pick<Catalog, 'entries' | 'invalidate'>,
  ids?: readonly string[],
): number => {
  const marked: [string, DetectEntry][] = []
  for (const entry of catalog.entries()) {
    if (ids !== undefined && !ids.includes(entry.id)) continue
    const key = probeKey(planProbe(entry), entry.version)
    if (key !== undefined) marked.push([entry.id, [key, 'mod']])
  }
  store.update('detect', cache => lruSetMany(cache, marked, CAPS.detect))
  catalog.invalidate()
  return marked.length
}
