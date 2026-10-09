// The update scheduler over fake ports (timed, idle-only, off switches,
// re-armed by a reloaded module from the stored time), what a marketplace
// refresh finds, Health's facts and each item's fix.
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../../plugin/hooks/domain/config.ts'
import { createActions } from '../../plugin/hooks/services/actions.ts'
import { DETECT_BUDGET } from '../../plugin/hooks/services/detector.ts'
import { background, onTurnEnd, onTurnStart } from '../../plugin/hooks/services/lifecycle.ts'
import { createRuntime } from '../../plugin/hooks/services/runtime.ts'
import { BUSY_RETRY_MS, FIRST_CHECK_DELAY_MS } from '../../plugin/hooks/services/updates.ts'
import { runs } from '../domain/fixtures/cli-runs.ts'
import { fixtureCli } from './cli-world.ts'
import { out, type World, world } from './fakes.ts'

const OFFICIAL = '/tmp/modmgr-fixtures/config/plugins/marketplaces/claude-plugins-official'
const SDK = 'agent-sdk-dev@claude-plugins-official'
const HOUR = 3_600_000

/** The fixtures, plus one mod installed from a repository marketplace (its folder validates as turn-band). */
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
        `${JSON.stringify({ command: 'marketplace-update', outcome: 'ok', marketplace: argv[4], message: 'Updated' })}\n`,
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
  const config = { ...DEFAULT_CONFIG, updateCheckHours: options.hours ?? 6 }
  const rt = createRuntime(w.ports, config, 'own')
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
    w.process.calls.filter(call => call.argv[3] === 'update').map(c => c.argv[4])
  return { w, rt, act, drain, refreshes, config }
}

describe('the update scheduler', () => {
  it('first checks a minute after start-up, refreshes each marketplace a mod comes from, and marks what can update', async () => {
    const { w, rt, drain, refreshes } = await setup()
    await rt.updater.arm()
    await w.clock.advance(FIRST_CHECK_DELAY_MS - 1)
    expect(refreshes()).toEqual([])
    await w.clock.advance(1)
    await drain()
    // Folder marketplaces have no updates (they run from their folder): only the repository one is refreshed.
    expect(refreshes()).toEqual(['claude-plugins-official'])
    expect(w.state.values.queue.jobs.some(job => job.kind === 'reload')).toBe(false)
    await w.clock.advance(0)
    expect(w.state.values.mods.find(row => row.id === SDK)?.updateTo).toBe('1.2.0')
    expect(w.state.values.attention.updates).toBe(1)
    expect(rt.store.get('updates')).toEqual({
      at: 1_000_000 + FIRST_CHECK_DELAY_MS,
      found: { [SDK]: { from: '1.0.0', to: '1.2.0' } },
    })
    // The next one is due a period later.
    await w.clock.advance(6 * HOUR - 1)
    expect(refreshes()).toHaveLength(1)
    await w.clock.advance(1)
    await drain()
    expect(refreshes()).toHaveLength(2)
  })

  it('waits while a turn runs, and not for a subagent’s', async () => {
    const { w, rt, drain, refreshes } = await setup()
    onTurnStart(rt, 'main')
    onTurnEnd(rt, 'sub', 'agent-1')
    await rt.updater.arm()
    await w.clock.advance(FIRST_CHECK_DELAY_MS)
    await drain()
    expect(refreshes()).toEqual([])
    onTurnEnd(rt, 'main', undefined)
    await w.clock.advance(BUSY_RETRY_MS)
    await drain()
    expect(refreshes()).toEqual(['claude-plugins-official'])
  })

  it('is off at 0 hours and under the traffic switch', async () => {
    for (const how of [{ hours: 0 }, { env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' } }]) {
      const { w, rt, drain, refreshes } = await setup(how)
      await rt.updater.arm()
      await w.clock.advance(12 * HOUR)
      await drain()
      expect(refreshes()).toEqual([])
      expect(await rt.updater.run()).toBe('off')
    }
  })

  it('re-arms in a reloaded module from the stored time', async () => {
    // The last check was a minute before this module started.
    const at = 1_000_000 - 60_000
    const { w, rt, drain, refreshes } = await setup({
      store: { updates: { v: 1, data: { at, found: {} } } },
    })
    // The reloaded module's start-up arms it: due 6 h after the last check.
    w.process.when(['--version'], out('2.1.292'))
    await background(rt, { fresh: false })
    await w.clock.advance(6 * HOUR - 60_000 - 1)
    expect(refreshes()).toEqual([])
    await w.clock.advance(1)
    await drain()
    expect(refreshes()).toEqual(['claude-plugins-official'])
    rt.dispose()
  })

  it('drops an update once the mod is at that version, and queues no second refresh while one waits', async () => {
    const { w, rt, drain } = await setup({
      store: {
        updates: { v: 1, data: { at: 1, found: { [SDK]: { from: '1.0.0', to: '1.2.0' } } } },
      },
    })
    await rt.registry.refresh()
    expect(w.state.values.attention.updates).toBe(1)
    updateCli(w, '1.2.0')
    await rt.registry.refresh()
    expect(w.state.values.mods.find(row => row.id === SDK)?.updateTo).toBeUndefined()
    expect(w.state.values.attention.updates).toBe(0)
    expect(await rt.updater.run()).toBe('queued')
    expect(await rt.updater.run()).toBe('nothing')
    await drain()
  })

  it('says nothing when the marketplaces can’t be listed', async () => {
    const { w, rt } = await setup()
    w.process.when(['marketplace', 'list'], out('not json'))
    await rt.updater.check()
    expect(w.ui.lines.some(line => line.includes('could not list the marketplaces'))).toBe(true)
  })

  it('coalesces checks, and survives a check that throws', async () => {
    const { w, rt } = await setup()
    const lists = () => w.process.calls.filter(call => call.argv[3] === 'list').length
    await Promise.all([rt.updater.check(), rt.updater.check(), rt.updater.check()])
    expect(lists()).toBe(2)
    w.fs.read = async () => {
      throw new Error('disk gone')
    }
    rt.registry.refresh = async () => {
      throw new Error('refused')
    }
    await rt.updater.check()
    expect(w.ui.lines.some(line => line.includes('update check failed'))).toBe(true)
  })

  it('restarts the detector after a timed refresh when Discover has read the catalogue', async () => {
    const { w, rt, drain } = await setup()
    w.process.when(['list', '--json', '--available'], out(runs['list-available'].stdout))
    await rt.catalog.load()
    let starts = 0
    const start = rt.detector.start
    rt.detector.start = () => {
      starts += 1
      start()
    }
    await rt.updater.run()
    await drain()
    await w.clock.advance(0)
    expect(starts).toBeGreaterThan(0)
  })
})

describe('Health', () => {
  it('gathers its facts: hook order without modmgr, the debug log, the detector, the cache, the checks', async () => {
    const { w, rt } = await setup()
    // This session's own log, not `latest`.
    w.fs.dirs.set('/cfg/debug', [
      { name: 'latest', kind: 'other' },
      { name: 'session-1.txt', kind: 'file' },
    ])
    w.fs.files.set(
      '/cfg/debug/session-1.txt',
      'x [WARN] hook failed closed: quiet-bash: errorKind=Error errorChars=4 (tool.call; skipped)\n',
    )
    await rt.health.refresh()
    const facts = w.state.values.health
    expect(facts.logged).toEqual({ 'quiet-bash': 'tool.call (Error)' })
    expect(facts.debugLog).toEqual({ state: 'read', path: '/cfg/debug/session-1.txt' })
    expect(facts.detector).toEqual({ spent: 0, budget: DETECT_BUDGET, remote: true })
    expect(facts.updates).toEqual({ every: 6 })
    expect(facts.cache.full).toBe(false)
    expect(facts.chain.every(note => !note.text.includes('modmgr'))).toBe(true)
  })

  it('reads no debug log without a config dir, and gathers once more for calls during one', async () => {
    const { w, rt } = await setup()
    w.ports.env = { ...w.ports.env, configDir: async () => undefined, home: async () => undefined }
    await Promise.all([rt.health.refresh(), rt.health.refresh(), rt.health.refresh()])
    expect(w.state.values.health.debugLog).toEqual({ state: 'none' })
    w.state.failWrites = true
    await rt.health.refresh()
    expect(w.ui.lines.some(line => line.includes('health refresh failed'))).toBe(true)
  })

  it('says why remote checks and update checks are off, and when there is no debug log', async () => {
    const { w, rt } = await setup({ env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' } })
    await rt.health.refresh()
    expect(w.state.values.health).toMatchObject({
      debugLog: { state: 'none' },
      detector: { remote: false, why: 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC is set' },
      updates: { off: 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC is set' },
    })
    const quiet = await setup({ hours: 0 })
    await quiet.rt.health.refresh()
    expect(quiet.w.state.values.health.updates.off).toBe('updateCheckHours is 0')
  })

  it('runs each item’s fix', async () => {
    const { w, rt, act, drain, refreshes } = await setup({
      store: {
        updates: { v: 1, data: { at: 1, found: { [SDK]: { from: '1.0.0', to: '1.2.0' } } } },
      },
    })
    await rt.registry.refresh()
    await act.tab('health')
    expect(w.state.values.view.tab).toBe('health')
    // update → the update review.
    await act.fix(`${SDK}:update`)
    expect(w.state.values.review).toMatchObject({ action: 'update', targets: [{ id: SDK }] })
    await act.cancel()
    // check now → the marketplaces refreshed.
    await act.fix('own:updates')
    await drain()
    expect(refreshes()).toEqual(['claude-plugins-official'])
    // clear cache → the caches emptied.
    await act.fix('own:cache')
    expect(w.state.values.view.notice).toBe('Cache cleared')
    expect(Object.keys(rt.store.get('validate'))).toEqual([])
    // copy → the command.
    await act.fix('own:debug')
    expect(w.ui.copies).toEqual(['claude --debug'])
    // An item with no fix, or none at all, does nothing.
    await act.fix('own:load')
    await act.fix('nothing:here')
    await act.focusHealth('own:load')
    expect(w.state.values.view.health).toBe('own:load')
  })

  it('opens a mod’s detail on Installed to see what it can do now', async () => {
    const { w, rt, act } = await setup()
    w.state.values.mods = w.state.values.mods.map(row =>
      row.id === 'turn-band@fixtures' ? { ...row, problems: 1 } : row,
    )
    await rt.health.refresh()
    await act.tab('health')
    await act.fix('turn-band@fixtures:validate')
    expect(w.state.values.view).toMatchObject({
      tab: 'installed',
      selected: 'turn-band@fixtures',
      stack: ['detail'],
    })
  })

  it('reloads and refreshes from its items', async () => {
    const { w, act, drain } = await setup()
    w.state.values.attention = { ...w.state.values.attention, reloadPending: true }
    w.state.values.sync = { ...w.state.values.sync, error: { kind: 'timeout', message: 'slow' } }
    await act.fix('own:reload')
    expect(w.state.values.queue.jobs.some(job => job.kind === 'reload')).toBe(true)
    const lists = () => w.process.calls.filter(call => call.argv[2] === 'list').length
    const before = lists()
    w.state.values.view = { ...w.state.values.view, tab: 'health' }
    await act.fix('own:sync')
    expect(lists()).toBe(before + 1)
    await drain()
  })
})
