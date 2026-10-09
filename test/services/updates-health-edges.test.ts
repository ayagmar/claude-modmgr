// The update scheduler's, Health's and Dev's edges over fake ports: checks
// switched off, the version the CLI compares, check now, the debug log, a
// hostile marketplace file, the pinned selection.
import { describe, expect, it } from 'vitest'
import type { InstalledEntry } from '../../plugin/hooks/domain/cli-results.ts'
import { DEFAULT_CONFIG } from '../../plugin/hooks/domain/config.ts'
import { healthItemsOf } from '../../plugin/hooks/domain/health.ts'
import type { AbsolutePath, PluginId } from '../../plugin/hooks/domain/ids.ts'
import { INITIAL } from '../../plugin/hooks/domain/state.ts'
import { marketplaceEntriesOf, updateOf } from '../../plugin/hooks/domain/updates.ts'
import { createActions } from '../../plugin/hooks/services/actions.ts'
import { createRuntime } from '../../plugin/hooks/services/runtime.ts'
import { FIRST_CHECK_DELAY_MS } from '../../plugin/hooks/services/updates.ts'
import { runs } from '../domain/fixtures/cli-runs.ts'
import { fixtureCli } from './cli-world.ts'
import { out, type World, world } from './fakes.ts'

const OFFICIAL = '/tmp/modmgr-fixtures/config/plugins/marketplaces/claude-plugins-official'
const SDK = 'agent-sdk-dev@claude-plugins-official'
const HOUR = 3_600_000

const updateCli = (w: World, version = '1.0.0') =>
  fixtureCli(w.process)
    .when(['list', '--json'], () => {
      const list = JSON.parse(runs.list.stdout) as unknown[]
      const sdk = {
        id: SDK,
        version,
        scope: 'user',
        enabled: true,
        installPath: '/cache/claude-plugins-official/sdk/turn-band',
      }
      return out(JSON.stringify([...list, sdk]))
    })
    .when(['marketplace', 'list'], out(runs['marketplace-list'].stdout))
    .when(['marketplace', 'update'], argv =>
      out(
        `${JSON.stringify({ command: 'marketplace-update', outcome: 'ok', marketplace: argv[4] })}\n`,
      ),
    )

const setup = async (
  options: { env?: Record<string, string>; store?: Record<string, unknown>; hours?: number } = {},
) => {
  const w = world({
    env: { CLAUDE_CONFIG_DIR: '/cfg', ...options.env },
    store: options.store ?? {},
  })
  updateCli(w)
  w.fs.files.set(
    `${OFFICIAL}/.claude-plugin/marketplace.json`,
    JSON.stringify({ plugins: [{ name: 'agent-sdk-dev', version: '1.2.0', source: './sdk' }] }),
  )
  const rt = createRuntime(
    w.ports,
    { ...DEFAULT_CONFIG, updateCheckHours: options.hours ?? 6 },
    'own',
  )
  w.state.values.queue = { owner: 'own', jobs: [] }
  await rt.store.load()
  await rt.registry.refresh()
  const act = createActions(w.ports, rt)
  const drain = async () => {
    for (let i = 0; i < 4; i += 1) {
      await w.clock.advance(0)
      await rt.runner.whenIdle()
    }
  }
  const refreshes = () =>
    w.process.calls.filter(call => call.argv[3] === 'update').map(call => call.argv[4])
  return { w, rt, act, drain, refreshes }
}

describe('no timer while checks are off', () => {
  // A check 1 ms after the epoch is past due for a 6-minute period at the fakes' start (1,000,000 ms).
  const pastDue = { updates: { v: 1, data: { at: 1, found: {} } } }

  it('a past-due check with the traffic switch on arms nothing', async () => {
    const { w, rt, refreshes } = await setup({
      env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
      store: pastDue,
      hours: 0.1,
    })
    await rt.updater.arm()
    // Before the fix this spun at 0 ms; now the clock settles with nothing left to fire.
    await w.clock.advance(HOUR)
    expect(w.clock.pending).toBe(0)
    expect(refreshes()).toEqual([])
  })

  it('a past-due check with traffic allowed runs once, then waits a period', async () => {
    const { w, rt, drain, refreshes } = await setup({ store: pastDue, hours: 0.1 })
    await rt.updater.arm()
    await w.clock.advance(0)
    await drain()
    expect(refreshes()).toEqual(['claude-plugins-official'])
    await w.clock.advance(0.1 * HOUR - 1)
    expect(refreshes()).toHaveLength(1)
  })
})

describe('the version the CLI compares, and a guess the CLI refuses', () => {
  const installed = (version: string): InstalledEntry => ({
    id: SDK as PluginId,
    scope: 'user',
    enabled: true,
    version,
    installPath: '/cache/sdk' as AbsolutePath,
  })

  it('the plugin’s own manifest outranks the marketplace’s declaration', async () => {
    const { w, rt } = await setup()
    // The live case: declared 1.2.0, the plugin's own plugin.json still 1.0.0.
    w.fs.files.set(
      `${OFFICIAL}/sdk/.claude-plugin/plugin.json`,
      '{"name":"agent-sdk-dev","version":"1.0.0"}',
    )
    await rt.updater.check()
    expect(rt.store.get('updates').found).toEqual({})
    // Its manifest moves on: now it is sure.
    w.fs.files.set(
      `${OFFICIAL}/sdk/.claude-plugin/plugin.json`,
      '{"name":"agent-sdk-dev","version":"1.3.0"}',
    )
    await rt.updater.check()
    expect(rt.store.get('updates').found[SDK]).toEqual({ from: '1.0.0', to: '1.3.0' })
  })

  it('a declared version for a remote source is not sure', () => {
    const remote = {
      version: '9.0.0',
      source: { kind: 'git-subdir' as const, url: 'https://github.com/o/r.git', path: 'p' },
    }
    expect(updateOf(installed('1.0.0'), remote)).toBeUndefined()
  })

  it('an update the CLI calls up to date drops what the check found', async () => {
    const { w, rt, act, drain } = await setup({
      store: {
        updates: { v: 1, data: { at: 1, found: { [SDK]: { from: '1.0.0', to: '1.2.0' } } } },
      },
    })
    await rt.registry.refresh()
    expect(w.state.values.attention.updates).toBe(1)
    // The CLI's own answer for a plugin already current (captured as update-current).
    w.process.when(['update'], out(runs['update-current'].stdout))
    await act.update(SDK)
    await act.confirm()
    await drain()
    await w.clock.advance(2000)
    await drain()
    expect(rt.store.get('updates').found).toEqual({})
    expect(w.state.values.mods.find(row => row.id === SDK)?.updateTo).toBeUndefined()
    expect(w.state.values.attention.updates).toBe(0)
  })
})

describe('check now re-arms; one refresh at a time', () => {
  it('check now moves the next check a period on', async () => {
    const { w, rt, drain, refreshes } = await setup()
    await rt.updater.arm()
    expect(await rt.updater.run()).toBe('queued')
    await drain()
    await w.clock.advance(FIRST_CHECK_DELAY_MS)
    await drain()
    expect(refreshes()).toHaveLength(1)
  })

  it('a refresh running blocks a second one', async () => {
    const { w, rt, drain, refreshes } = await setup()
    w.process.when(['marketplace', 'update'], { hang: true })
    expect(await rt.updater.run()).toBe('queued')
    await w.clock.advance(0)
    expect(w.state.values.queue.jobs.find(job => job.kind === 'marketplace-update')?.state).toBe(
      'running',
    )
    expect(await rt.updater.run()).toBe('nothing')
    await w.clock.advance(5 * 60_000)
    await drain()
    expect(refreshes()).toHaveLength(1)
  })

  it('waits behind a reload, as behind a turn', async () => {
    const { w, rt } = await setup()
    w.state.values.queue = {
      owner: 'own',
      jobs: [{ id: 'r', kind: 'reload', state: 'queued', tail: [] }],
    }
    expect(await rt.updater.run()).toBe('busy')
  })
})

describe('this session’s debug log, and one too large to read', () => {
  it('a log the engine won’t read whole is said, with a search to copy', async () => {
    const { w, rt } = await setup()
    w.fs.dirs.set('/cfg/debug', [
      { name: 'latest', kind: 'other' },
      { name: 'session-1.txt', kind: 'file' },
    ])
    // No file content: the read rejects, as one over 4 MiB does.
    await rt.health.refresh()
    expect(w.state.values.health.debugLog).toEqual({
      state: 'too-big',
      path: '/cfg/debug/session-1.txt',
    })
    const items = healthItemsOf({
      mods: [],
      attention: INITIAL.attention,
      degraded: INITIAL.degraded,
      sync: INITIAL.sync,
      detect: INITIAL.detect,
      queue: INITIAL.queue,
      facts: w.state.values.health,
    })
    expect(items.find(item => item.key === 'own:debug')).toMatchObject({
      tone: 'warn',
      fix: { kind: 'copy', text: "grep 'hook failed closed' /cfg/debug/session-1.txt" },
    })
  })

  it('another session’s `latest` is not this session’s log', async () => {
    const { w, rt } = await setup()
    w.fs.dirs.set('/cfg/debug', [{ name: 'latest', kind: 'other' }])
    w.fs.files.set('/cfg/debug/latest', 'x hook failed closed: old: errorKind=Error (tool.call; x)')
    await rt.health.refresh()
    expect(w.state.values.health.debugLog).toEqual({ state: 'none' })
    expect(w.state.values.health.logged).toEqual({})
  })

  it('an env or session read that rejects reads no log', async () => {
    const { w, rt } = await setup()
    const reject = async (): Promise<never> => {
      throw new Error('refused')
    }
    w.ports.env = { ...w.ports.env, configDir: reject, home: reject }
    w.ports.session = { ...w.ports.session, id: reject }
    await rt.health.refresh()
    expect(w.state.values.health.debugLog).toEqual({ state: 'none' })
  })
})

describe('a hostile marketplace file', () => {
  it('keeps names that are names and versions cut short; says newer only of a whole version', () => {
    const entries = marketplaceEntriesOf(
      JSON.stringify({
        plugins: [
          { name: 'Bad Name', version: '1.0.0', source: './x' },
          { name: 'long', version: `1.2.0${'x'.repeat(1_000_000)}`, source: './long' },
          { name: 'odd', version: '1.2.0<junk>', source: './odd' },
        ],
      }),
    )
    expect([...entries.keys()]).toEqual(['long', 'odd'])
    expect(entries.get('long')?.version?.length).toBe(64)
    const installed: InstalledEntry = {
      id: 'long@m' as PluginId,
      scope: 'user',
      enabled: true,
      version: '1.0.0',
      installPath: '/c/long' as AbsolutePath,
    }
    expect(updateOf(installed, entries.get('long'))).toBeUndefined()
    expect(updateOf({ ...installed, id: 'odd@m' as PluginId }, entries.get('odd'))).toBeUndefined()
  })
})

describe('the selection pinned only without a filter', () => {
  it('a filtered first row does not become the selection', async () => {
    const { w, rt } = await setup()
    w.state.values.view = { ...w.state.values.view, query: 'turn' }
    const { selected: _none, ...unpinned } = w.state.values.view
    w.state.values.view = unpinned
    await rt.registry.refresh()
    expect(w.state.values.view.selected).toBeUndefined()
  })
})
