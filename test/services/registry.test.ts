import { describe, expect, it } from 'vitest'
import { lruSet } from '../../plugin/hooks/domain/lru.ts'
import { CAPS } from '../../plugin/hooks/domain/store-schema.ts'
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

  it('lists every installed mod however full the cache of analyses is', async () => {
    const { w, registry, store } = setup()
    await registry.refresh()
    // The cache at its cap, this install's analyses its oldest, two of them to read
    // again: storing those two evicts the two oldest, which this refresh still lists.
    store.update('validate', cache => {
      const [first, ...rest] = Object.keys(cache)
      const value = cache[first ?? '']
      if (value === undefined) throw new Error('an analysis')
      let next = { ...cache }
      for (const key of rest.slice(-2)) delete next[key]
      for (let n = 0; Object.keys(next).length < CAPS.validate; n += 1) {
        next = lruSet(next, `other-plugin-${n}`, value, CAPS.validate)
      }
      return next
    })
    await registry.refresh()
    expect(w.state.values.mods.map(row => row.name)).toEqual(FIXTURE_MODS)
    expect(w.state.values.sync.skipped).toBe(0)
    // Each listed mod still has its detail and its place in the hook order.
    for (const row of w.state.values.mods) {
      w.state.values.view = { ...w.state.values.view, selected: row.id }
      await registry.select(row.id)
      expect(w.state.values.detail?.id).toBe(row.id)
    }
    expect(registry.listed().every(({ mod }) => mod !== undefined)).toBe(true)
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
  it("shows the first row's detail before the selection ever moves", async () => {
    const { w, registry } = setup()
    await registry.refresh()
    expect(w.state.values.detail?.id).toBe(w.state.values.mods[0]?.id)
  })

  it('writes the selected mod detail and refreshes it', async () => {
    const { w, registry } = setup()
    await registry.refresh()
    // As every action does: the view's selection, then its detail.
    w.state.values.view = { ...w.state.values.view, selected: 'turn-band@fixtures' }
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

  it('says what the mod is and links its page, as its plugin.json gives them', async () => {
    const { w, registry } = setup()
    const manifest = (folder: string) =>
      `/tmp/modmgr-fixtures/mkt/${folder}/.claude-plugin/plugin.json`
    w.fs.files.set(
      manifest('turn-band'),
      JSON.stringify({
        name: 'turn-band',
        description: '  Shows the turn above the prompt. ',
        homepage: 'http://example.com',
        repository: { type: 'git', url: 'git+https://github.com/o/turn-band.git' },
      }),
    )
    w.fs.files.set(
      manifest('redactor'),
      JSON.stringify({ name: 'redactor', homepage: 'javascript:alert(1)' }),
    )
    await registry.refresh()
    await registry.select('turn-band@fixtures')
    expect(w.state.values.detail).toMatchObject({
      description: 'Shows the turn above the prompt.',
      link: 'https://github.com/o/turn-band',
    })
    await registry.select('redactor@fixtures')
    expect(w.state.values.detail).not.toHaveProperty('link')
    expect(w.state.values.detail).not.toHaveProperty('description')
  })

  it("never shows one mod's plugin.json on another chosen while it was read", async () => {
    const { w, registry } = setup()
    await registry.refresh()
    w.fs.files.set(
      '/tmp/modmgr-fixtures/mkt/turn-band/.claude-plugin/plugin.json',
      JSON.stringify({ description: 'Shows the turn.' }),
    )
    let release = () => {}
    const read = w.fs.read
    w.fs.read = path => new Promise<string>(resolve => (release = () => resolve(read(path))))
    const slow = registry.select('turn-band@fixtures')
    await settle()
    w.fs.read = read
    await registry.select('redactor@fixtures')
    release()
    await slow
    expect(w.state.values.detail).toMatchObject({ id: 'redactor@fixtures' })
    expect(w.state.values.detail).not.toHaveProperty('description')
  })

  it('keeps the row shown selected when a new one sorts above it (found live)', async () => {
    const { w, registry } = setup()
    // Nothing listed yet: nothing to keep.
    w.process.when(['list'], out('[]'))
    await registry.refresh()
    expect(w.state.values.view.selected).toBeUndefined()
    w.process.when(['list'], out(runs.list.stdout))
    await registry.refresh()
    // The first row shown (broken) was what the ring sat on; it stays the selection.
    const { selected: _pinned, ...unpinned } = w.state.values.view
    w.state.values.view = unpinned
    const list = JSON.parse(runs.list.stdout) as Array<Record<string, unknown>>
    const first = { ...list.find(entry => entry.id === 'turn-band@fixtures'), id: 'aaa@fixtures' }
    w.process.when(['list'], out(JSON.stringify([first, ...list])))
    await registry.refresh()
    expect(w.state.values.mods[0]?.id).toBe('aaa@fixtures')
    expect(w.state.values.view.selected).toBe('broken@fixtures')
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
