// M6 over fake ports: preferences remembered for the next session, the first
// run's welcome said once, the timings behind docs/PERF.md, and a store update
// that changes nothing writing nothing.
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../../plugin/hooks/domain/config.ts'
import { createActions } from '../../plugin/hooks/services/actions.ts'
import { modsCommand } from '../../plugin/hooks/services/commands.ts'
import { runJob } from '../../plugin/hooks/services/job-runner.ts'
import { background } from '../../plugin/hooks/services/lifecycle.ts'
import { createRuntime } from '../../plugin/hooks/services/runtime.ts'
import { createStore } from '../../plugin/hooks/services/store.ts'
import { NO_TIMING, timed, timingOf } from '../../plugin/hooks/services/timing.ts'
import { fixtureCli } from './cli-world.ts'
import { world } from './fakes.ts'

const setup = async (
  store: Record<string, unknown> = {},
  debugTimings = false,
  surfaces: ('terminal' | 'desktop')[] = ['terminal'],
) => {
  const w = world({ store, session: { surfaces } })
  fixtureCli(w.process)
  const rt = createRuntime(w.ports, { ...DEFAULT_CONFIG, debugTimings }, 'own')
  w.state.values.queue = { owner: 'own', jobs: [] }
  return { w, rt, act: createActions(w.ports, rt) }
}

describe('preferences', () => {
  it('remembers the tab and sort for the next session', async () => {
    const { w, rt, act } = await setup({ prefs: { v: 1, data: { firstRunDone: true } } })
    await background(rt, { fresh: true })
    await act.tab('discover')
    await act.cycleSort()
    await rt.store.flush()
    expect(w.store.data.get('prefs')).toEqual({
      v: 1,
      data: { tab: 'discover', sort: 'marketplace', firstRunDone: true },
    })
    // The next session opens where this one was.
    const next = await setup(Object.fromEntries(w.store.data))
    await background(next.rt, { fresh: true })
    expect(next.w.state.values.view).toMatchObject({
      tab: 'discover',
      sort: 'marketplace',
    })
  })
})

describe('the first run', () => {
  it('waits for a session that draws (a -p run has no surface)', async () => {
    const { w, rt } = await setup({}, false, [])
    await background(rt, { fresh: true })
    expect(w.state.values.view.stack).toEqual([])
    expect(rt.store.get('prefs').firstRunDone).toBe(false)
  })

  it('opens on the welcome until it is left, then never again (review R-M6-5)', async () => {
    const first = await setup()
    await background(first.rt, { fresh: true })
    expect(first.w.state.values.view.stack).toEqual(['welcome'])
    // Not opened in that session: the next one still welcomes.
    await first.rt.store.flush()
    const second = await setup(Object.fromEntries(first.w.store.data))
    await background(second.rt, { fresh: true })
    expect(second.w.state.values.view.stack).toEqual(['welcome'])
    await second.act.back()
    await second.rt.store.flush()
    const third = await setup(Object.fromEntries(second.w.store.data))
    await background(third.rt, { fresh: true })
    expect(third.w.state.values.view.stack).toEqual([])
  })

  it('closing the dialog on it counts as seen', async () => {
    const { w, rt, act } = await setup()
    await background(rt, { fresh: true })
    await act.closing('person', false)
    expect(rt.store.get('prefs').firstRunDone).toBe(true)
    expect(w.state.values.view.stack).toEqual([])
  })

  it('start leaves it, the ring back on the list', async () => {
    const { w, rt, act } = await setup()
    await background(rt, { fresh: true })
    await act.back()
    expect(w.state.values.view.stack).toEqual([])
    await act.overlay('help')
    w.state.values.view = { ...w.state.values.view, stack: ['welcome'] }
    await act.back()
    expect(w.ui.focuses.at(-1)).toBe('modmgr:row:broken@fixtures')
  })
})

describe('timings (docs/PERF.md)', () => {
  it('say nothing unless debugTimings is on', async () => {
    const lines: string[] = []
    const on = timingOf(true, line => lines.push(line))
    expect(await timed(on, 'step', async () => 7)).toBe(7)
    expect(lines[0]).toMatch(/^modmgr: timing step \d+\.\d ms$/)
    timingOf(false, line => lines.push(line))('quiet', 0)
    NO_TIMING('quiet', 0)
    expect(lines).toHaveLength(1)
    await expect(timed(on, 'failing', async () => Promise.reject(new Error('x')))).rejects.toThrow(
      'x',
    )
    expect(lines.at(-1)).toMatch(/timing failing/)
  })

  it('time the refreshes with debugTimings on', async () => {
    const { w, rt } = await setup({}, true)
    await rt.registry.refresh()
    await rt.dev.refresh()
    await rt.health.refresh()
    const timings = w.ui.lines.filter(line => line.startsWith('modmgr: timing '))
    expect(timings.map(line => line.replace(/ [\d.]+ ms$/, ''))).toEqual(
      expect.arrayContaining([
        'modmgr: timing installed list refresh',
        'modmgr: timing dev refresh',
        'modmgr: timing health facts',
      ]),
    )
  })
})

describe('the store', () => {
  it('writes nothing for an update that changes nothing', async () => {
    const w = world()
    const store = createStore(w.ports)
    await store.load()
    store.update('prefs', prefs => prefs)
    await store.flush()
    expect(w.store.sets).toEqual([])
  })
})

describe('runJob, shared by the runner and the text writes (F59)', () => {
  it('refuses a streamed test and an id it can’t check', async () => {
    const { w } = await setup()
    const test = await runJob(w.ports, {
      id: 't',
      kind: 'test',
      state: 'running',
      tail: [],
      args: { path: '/x' },
    })
    expect(test.finish).toMatchObject({ ok: false, error: { kind: 'invalid' } })
    const bad = await runJob(w.ports, {
      id: 'b',
      kind: 'disable',
      state: 'running',
      tail: [],
      target: 'NOT AN ID',
    })
    expect(bad.finish).toMatchObject({ ok: false, error: { kind: 'invalid' } })
    const missing = await runJob(
      w.ports,
      { id: 'm', kind: 'disable', state: 'running', tail: [], target: 'gone@m' },
      async () => false,
    )
    expect(missing.finish).toMatchObject({
      ok: false,
      error: { message: 'gone@m is not installed' },
    })
  })

  it('a text write is recorded like the runner’s: queue, history, a reload owed', async () => {
    const { w, rt } = await setup({ prefs: { v: 1, data: { firstRunDone: true } } })
    await rt.store.load()
    await rt.registry.refresh()
    await modsCommand(w.ports, rt, 'disable turn-band@fixtures --yes')
    expect(w.state.values.queue.jobs).toMatchObject([
      { kind: 'disable', state: 'ok', target: 'turn-band@fixtures' },
    ])
    expect(rt.store.get('history')).toMatchObject([{ kind: 'disable', state: 'ok' }])
    expect(w.state.values.attention.reloadPending).toBe(true)
  })
})
