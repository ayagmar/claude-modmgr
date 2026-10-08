import { describe, expect, it } from 'vitest'
import type { Analysis } from '../../plugin/hooks/domain/mods.ts'
import {
  CAPS,
  type DetectEntry,
  HARD_BUDGET,
  SOFT_BUDGET,
} from '../../plugin/hooks/domain/store-schema.ts'
import { createStore, FLUSH_DELAY_MS } from '../../plugin/hooks/services/store.ts'
import { world } from './fakes.ts'

const analysis = (at = 1): Analysis => ({
  mod: true,
  events: ['session.start'],
  calls: ['ui.log'],
  envReads: [],
  errors: 0,
  warnings: 0,
  at,
})

const detectMap = (count: number, pad = 0): Record<string, DetectEntry> =>
  Object.fromEntries(
    Array.from({ length: count }, (_, i) => [
      `p${i}${'x'.repeat(pad)}@m`,
      ['a'.repeat(40), 'plain'],
    ]),
  )

describe('store.load', () => {
  it('starts empty and loads once', async () => {
    const w = world()
    const store = createStore(w.ports)
    const first = store.load()
    expect(store.load()).toBe(first)
    await first
    expect(store.get('prefs')).toEqual({
      tab: 'installed',
      sort: 'name',
      kind: 'mods',
      firstRunDone: false,
    })
    expect(store.bytes()).toBeGreaterThan(0)
  })

  it('reads envelopes, and starts a malformed or newer key empty', async () => {
    const w = world({
      store: {
        prefs: { v: 1, data: { tab: 'dev', sort: 'installs', kind: 'all', firstRunDone: true } },
        detect: { nope: true },
        validate: { v: 99, data: { '/a@1': analysis() } },
        history: { v: 1, data: [{ id: 'j1', kind: 'enable', state: 'ok', endedAt: 5 }, { id: 3 }] },
      },
    })
    const debug: string[] = []
    const store = createStore(w.ports, { debug: line => debug.push(line) })
    await store.load()
    expect(store.get('prefs').tab).toBe('dev')
    expect(store.get('detect')).toEqual({})
    expect(store.get('validate')).toEqual({})
    expect(store.get('history')).toEqual([{ id: 'j1', kind: 'enable', state: 'ok', endedAt: 5 }])
    expect(debug).toEqual(['modmgr: store detect was unreadable; starting it empty'])
    // A newer value is not overwritten by a flush with nothing to say.
    expect((await store.flush()).ok).toBe(true)
    expect(w.store.sets).toEqual([])
  })

  it('keeps a value set before the load finished', async () => {
    const w = world({ store: { prefs: { v: 1, data: { tab: 'dev' } } } })
    const store = createStore(w.ports)
    store.set('prefs', { tab: 'health', sort: 'name', kind: 'mods', firstRunDone: true })
    await store.load()
    expect(store.get('prefs').tab).toBe('health')
  })

  it('survives an unreadable store', async () => {
    const w = world()
    w.store.failGets = true
    const debug: string[] = []
    const store = createStore(w.ports, { debug: line => debug.push(line) })
    await store.load()
    expect(store.get('history')).toEqual([])
    expect(debug).toHaveLength(6)
  })
})

describe('store writes', () => {
  it('gathers sets into one write per key after the delay', async () => {
    const w = world()
    const store = createStore(w.ports)
    await store.load()
    store.update('history', h => [...h, { id: 'a', kind: 'enable', state: 'ok', endedAt: 1 }])
    store.update('history', h => [...h, { id: 'b', kind: 'disable', state: 'ok', endedAt: 2 }])
    store.set('prefs', { ...store.get('prefs'), firstRunDone: true })
    expect(w.store.sets).toEqual([])
    await w.clock.advance(FLUSH_DELAY_MS)
    expect(w.store.sets.sort()).toEqual(['history', 'prefs'])
    expect(w.store.data.get('history')).toEqual({
      v: 1,
      data: [
        { id: 'a', kind: 'enable', state: 'ok', endedAt: 1 },
        { id: 'b', kind: 'disable', state: 'ok', endedAt: 2 },
      ],
    })
  })

  it('applies the per-key caps', async () => {
    const w = world()
    const store = createStore(w.ports)
    await store.load()
    store.set('detect', detectMap(CAPS.detect + 10))
    expect(Object.keys(store.get('detect'))).toHaveLength(CAPS.detect)
    expect(Object.keys(store.get('detect'))[0]).toBe('p10@m')
    store.set(
      'history',
      Array.from({ length: 60 }, (_, i) => ({
        id: `j${i}`,
        kind: 'enable' as const,
        state: 'ok' as const,
        endedAt: i,
      })),
    )
    expect(store.get('history')).toHaveLength(CAPS.history)
    store.set(
      'validate',
      Object.fromEntries(Array.from({ length: 310 }, (_, i) => [`/r${i}@1`, analysis()])),
    )
    expect(Object.keys(store.get('validate'))).toHaveLength(CAPS.validate)
  })

  it('evicts the oldest cache entries to stay under the soft budget', async () => {
    const w = world()
    const store = createStore(w.ports)
    await store.load()
    // ~6,000 entries of ~250 bytes: well past 1 MiB.
    store.set('detect', detectMap(CAPS.detect, 180))
    const result = await store.flush()
    expect(result.ok).toBe(true)
    expect(store.bytes()).toBeLessThanOrEqual(SOFT_BUDGET)
    const kept = Object.keys(store.get('detect'))
    expect(kept.length).toBeLessThan(CAPS.detect)
    expect(kept.at(-1)).toBe(`p${CAPS.detect - 1}${'x'.repeat(180)}@m`)
    expect(store.isFull()).toBe(false)
  })

  it('refuses a write past the hard guard, as store-full', async () => {
    const w = world()
    const store = createStore(w.ports)
    await store.load()
    const huge = { version: 'v'.repeat(HARD_BUDGET), notable: [] }
    store.set('capsHistory', { 'a@b': huge })
    const result = await store.flush()
    expect(result).toMatchObject({ ok: false, error: { kind: 'store-full' } })
    expect(store.isFull()).toBe(true)
    expect(w.store.sets).toEqual([])
  })

  it('writes past the soft budget while under the hard guard when nothing can be evicted', async () => {
    const w = world()
    const store = createStore(w.ports)
    await store.load()
    store.set('capsHistory', { 'a@b': { version: 'v'.repeat(SOFT_BUDGET + 10), notable: [] } })
    expect((await store.flush()).ok).toBe(true)
    expect(w.store.sets).toEqual(['capsHistory'])
  })

  it('maps an engine refusal to store-full and retries on the next flush', async () => {
    const w = world()
    w.store.limit = 10
    const store = createStore(w.ports)
    await store.load()
    store.set('prefs', { ...store.get('prefs'), firstRunDone: true })
    const refused = await store.flush()
    expect(refused).toMatchObject({ ok: false, error: { kind: 'store-full' } })
    w.store.limit = 4 * 1024 * 1024
    expect((await store.flush()).ok).toBe(true)
    expect(w.store.sets).toEqual(['prefs'])
    expect(store.isFull()).toBe(false)
  })

  it('writes flushes in order', async () => {
    const w = world()
    const store = createStore(w.ports)
    await store.load()
    store.set('prefs', { ...store.get('prefs'), tab: 'dev' })
    const a = store.flush()
    store.set('prefs', { ...store.get('prefs'), tab: 'health' })
    const b = store.flush()
    await Promise.all([a, b])
    expect((w.store.data.get('prefs') as { data: { tab: string } }).data.tab).toBe('health')
  })

  it('clears the caches', async () => {
    const w = world({ store: { validate: { v: 1, data: { '/r@1': analysis() } } } })
    const store = createStore(w.ports)
    await store.load()
    expect(Object.keys(store.get('validate'))).toHaveLength(1)
    expect((await store.clearCaches()).ok).toBe(true)
    expect(store.get('validate')).toEqual({})
    expect(w.store.data.get('validate')).toEqual({ v: 1, data: {} })
  })
})
