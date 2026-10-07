import { describe, expect, it } from 'vitest'
import { createRegistry, VALIDATE_CONCURRENCY } from '../../plugin/hooks/services/registry.ts'
import { createStore } from '../../plugin/hooks/services/store.ts'
import { runs } from '../domain/fixtures/cli-runs.ts'
import { FIXTURE_MODS, fixtureCli } from './cli-world.ts'
import { out, settle, world } from './fakes.ts'

const setup = () => {
  const w = world()
  fixtureCli(w.process)
  const store = createStore(w.ports)
  const registry = createRegistry(w.ports, store, text => w.ui.debug(text))
  return { w, store, registry }
}

const validateCalls = (w: ReturnType<typeof world>) =>
  w.process.calls.filter(call => call.argv[2] === 'validate').length

describe('registry.refresh', () => {
  it('lists mods only, sorted, with what they can do', async () => {
    const { w, registry } = setup()
    const result = await registry.refresh()
    expect(result).toEqual({ ok: true, value: { mods: 5, analysed: 6, skipped: 0 } })
    const mods = w.state.values.mods
    expect(mods.map(row => row.name)).toEqual(FIXTURE_MODS)
    const redactor = mods.find(row => row.name === 'redactor')
    expect(redactor).toMatchObject({
      scope: 'project',
      origin: 'folder-marketplace',
      toggleable: true,
    })
    expect(mods.find(row => row.name === 'spawner')?.notableCount).toBeGreaterThan(0)
    expect(w.state.values.sync).toMatchObject({ refreshing: false, skipped: 0 })
    expect(w.state.values.sync.at).toBe(w.clock.time)
    expect(w.state.values.attention.problems).toBe(mods.reduce((sum, row) => sum + row.problems, 0))
  })

  it('validates each root@version once, then reads the cache', async () => {
    const { w, registry, store } = setup()
    await registry.refresh()
    const first = validateCalls(w)
    expect(first).toBe(6)
    await w.clock.advance(2000)
    // The first sight of each mod is recorded for the capability diff.
    expect(w.store.sets).toEqual(['validate', 'capsHistory'])
    await registry.refresh()
    expect(validateCalls(w)).toBe(first)
    expect(Object.keys(store.get('validate'))).toHaveLength(6)
    await w.clock.advance(2000)
    // Nothing new: the store file isn't rewritten.
    expect(w.store.sets).toEqual(['validate', 'capsHistory'])
  })

  it('asks details for mods only', async () => {
    const { w, registry } = setup()
    await registry.refresh()
    const details = w.process.calls.filter(call => call.argv[2] === 'details')
    expect(details.map(call => call.argv[3])).not.toContain('plain-skill@fixtures')
    expect(details).toHaveLength(5)
  })

  it('runs at most three validations at once', async () => {
    const { w, registry } = setup()
    // Each validation takes 10 ms, so the ones started at one instant ran together.
    const startedAt: number[] = []
    w.process.on(argv => {
      if (argv[2] !== 'validate') return undefined
      startedAt.push(w.clock.time)
      return { throws: 'slow', afterMs: 10 }
    })
    const done = registry.refresh()
    await w.clock.advance(50)
    await done
    const together = Math.max(...startedAt.map(t => startedAt.filter(s => s === t).length))
    expect(startedAt).toHaveLength(6)
    expect(together).toBe(VALIDATE_CONCURRENCY)
  })

  it('skips entries it can not inspect, and says so', async () => {
    const { w, registry } = setup()
    w.process.when(['validate'], { throws: 'boom' })
    const result = await registry.refresh()
    expect(result.ok && result.value).toEqual({ mods: 0, analysed: 0, skipped: 6 })
    expect(w.state.values.sync.skipped).toBe(6)
    expect(w.ui.lines.some(line => line.includes('validate'))).toBe(true)
  })

  it('records a failed list and keeps the rows it had', async () => {
    const { w, registry } = setup()
    await registry.refresh()
    w.process.when(['list'], out('nope', 1, 'no settings'))
    const result = await registry.refresh()
    expect(result.ok).toBe(false)
    expect(w.state.values.mods).toHaveLength(5)
    expect(w.state.values.sync.error).toEqual({ kind: 'cli-failed', message: 'no settings' })
    expect(w.state.values.sync.refreshing).toBe(false)
  })

  it('keeps a mod whose details failed, without its parts', async () => {
    const { w, registry } = setup()
    w.process.when(['details'], out('', 1, 'nope'))
    await registry.refresh()
    expect(w.state.values.mods.every(row => row.mixed === false)).toBe(true)
  })

  it('coalesces refreshes asked during one into exactly one more', async () => {
    const { w, registry } = setup()
    const first = registry.refresh()
    const second = registry.refresh()
    const third = registry.refresh()
    expect(second).toBe(first)
    expect(third).toBe(first)
    await first
    const lists = w.process.calls.filter(call => call.argv[2] === 'list').length
    expect(lists).toBe(2)
    expect(registry.isLoaded()).toBe(true)
  })

  it('reports a host failure instead of throwing', async () => {
    const { w, registry } = setup()
    w.state.failWrites = true
    const result = await registry.refresh()
    expect(result).toEqual({
      ok: false,
      error: { kind: 'unavailable', message: 'the installed list could not be refreshed' },
    })
  })
})

describe('registry.select', () => {
  it('writes the selected mod detail and refreshes it', async () => {
    const { w, registry } = setup()
    await registry.refresh()
    await registry.select('turn-band@fixtures')
    expect(w.state.values.detail).toMatchObject({
      id: 'turn-band@fixtures',
      root: '/tmp/modmgr-fixtures/mkt/turn-band',
      caps: { events: expect.arrayContaining(['ui.render']) },
      mixedCounts: { skills: 0, agents: 0, mcp: 0 },
    })
    await registry.refresh()
    expect(w.state.values.detail?.id).toBe('turn-band@fixtures')
    await registry.select(undefined)
    expect(w.state.values.detail).toBeNull()
    await registry.select('nosuch@x')
    expect(w.state.values.detail).toBeNull()
    expect(registry.entry('turn-band@fixtures')?.version).toBe('0.3.1')
  })

  it('reads a skipped list entry as unread', async () => {
    const { w, registry } = setup()
    const list = JSON.parse(runs.list.stdout) as unknown[]
    w.process.when(['list'], out(JSON.stringify([...list, { id: 'NOT VALID' }])))
    const result = await registry.refresh()
    expect(result.ok && result.value.skipped).toBe(1)
    await settle()
  })
})
