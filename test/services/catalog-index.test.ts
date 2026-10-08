import { describe, expect, it } from 'vitest'
import { INDEX_URL, indexText } from '../../plugin/hooks/domain/catalog-index.ts'
import { parseAvailable } from '../../plugin/hooks/domain/cli-results.ts'
import { planProbe, probeKey } from '../../plugin/hooks/domain/detector.ts'
import type { DetectEntry } from '../../plugin/hooks/domain/store-schema.ts'
import { createCatalog } from '../../plugin/hooks/services/catalog.ts'
import {
  createIndexSync,
  INDEX_MAX_AGE_MS,
  INDEX_NEW_MODULE_AGE_MS,
} from '../../plugin/hooks/services/catalog-index.ts'
import { createDetector } from '../../plugin/hooks/services/detector.ts'
import { createStore } from '../../plugin/hooks/services/store.ts'
import { runs } from '../domain/fixtures/cli-runs.ts'
import { fixtureCli } from './cli-world.ts'
import { out, type World, world } from './fakes.ts'

const AWS = 'aws-serverless@claude-plugins-official'
/** The fake clock's start. */
const START = 1_000_000

const catalogue = (() => {
  const parsed = parseAvailable(runs['list-available'])
  if (!parsed.ok) throw new Error(parsed.error.message)
  return parsed.value.available.items
})()

/** Every remote entry of the fixture catalogue at its own key: plain, but AWS a mod. */
const remoteIndex = (): Map<string, DetectEntry> => {
  const entries = new Map<string, DetectEntry>()
  for (const entry of catalogue) {
    const plan = planProbe(entry)
    const key = probeKey(plan, entry.version)
    if (plan.kind !== 'remote' || key === undefined) continue
    entries.set(entry.id, [key, entry.id === AWS ? 'mod' : 'plain'])
  }
  return entries
}

const setup = async (w: World = world()) => {
  fixtureCli(w.process)
    .when(['list', '--json', '--available'], out(runs['list-available'].stdout))
    .when(['marketplace', 'list'], out(runs['marketplace-list'].stdout))
  const store = createStore(w.ports)
  await store.load()
  const catalog = createCatalog(w.ports, store)
  await catalog.load()
  return { w, store, catalog }
}

const indexGets = (w: World) => w.http.gets.filter(url => url === INDEX_URL).length

describe('the hosted index', () => {
  it('gives its kinds in one request, and is asked again only after twelve hours', async () => {
    const { w, store, catalog } = await setup()
    w.http.answers.set(INDEX_URL, { status: 200, text: indexText(9, remoteIndex()) })
    const sync = createIndexSync(w.ports, { store })
    const given = await sync.sync(catalog.entries())
    expect(given).toBe(remoteIndex().size)
    expect(store.get('detect')[AWS]?.[1]).toBe('mod')
    expect(store.get('catalogIndex')).toEqual({ at: START, built: 9 })
    expect(sync.built()).toBe(9)
    // Within the twelve hours: nothing asked, and nothing left to give.
    expect(await sync.sync(catalog.entries())).toBe(0)
    expect(indexGets(w)).toBe(1)
    await w.clock.advance(INDEX_MAX_AGE_MS)
    await sync.sync(catalog.entries())
    expect(indexGets(w)).toBe(2)
  })

  it('takes nothing from an index it can’t read, and waits before asking again', async () => {
    const { w, store, catalog } = await setup()
    w.http.answers.set(INDEX_URL, { status: 200, text: '{"v":1}' })
    const debug: string[] = []
    const sync = createIndexSync(w.ports, { store, debug: line => debug.push(line) })
    expect(await sync.sync(catalog.entries())).toBe(0)
    expect(store.get('detect')).toEqual({})
    expect(store.get('catalogIndex')).toEqual({ at: START })
    expect(debug[0]).toContain('unusable')
    await sync.sync(catalog.entries())
    expect(indexGets(w)).toBe(1)
  })

  it('a 404 (nothing published yet) is an answer; an unreachable host is tried next module', async () => {
    const { w, store, catalog } = await setup()
    const sync = createIndexSync(w.ports, { store })
    await sync.sync(catalog.entries())
    expect(store.get('catalogIndex')).toEqual({ at: START })
    expect(sync.built()).toBeUndefined()

    const other = await setup()
    other.w.http.answers.set(INDEX_URL, { throws: 'offline' })
    const offline = createIndexSync(other.w.ports, { store: other.store })
    await offline.sync(other.catalog.entries())
    await offline.sync(other.catalog.entries())
    expect(indexGets(other.w)).toBe(1)
    expect(other.store.get('catalogIndex')).toEqual({})
  })

  it('a new module asks again after an hour; a newer index corrects what an older one said', async () => {
    const { w, store, catalog } = await setup()
    const wrong = remoteIndex()
    const right = remoteIndex()
    const [id, [key]] = [...right.entries()].find(([other]) => other !== AWS) ?? ['', ['']]
    wrong.set(id, [key, 'plain'])
    right.set(id, [key, 'mod'])
    w.http.answers.set(INDEX_URL, { status: 200, text: indexText(9, wrong) })
    await createIndexSync(w.ports, { store }).sync(catalog.entries())
    expect(store.get('detect')[id]?.[1]).toBe('plain')
    // The next session, within the hour: nothing asked.
    w.http.answers.set(INDEX_URL, { status: 200, text: indexText(10, right) })
    await createIndexSync(w.ports, { store }).sync(catalog.entries())
    expect(indexGets(w)).toBe(1)
    await w.clock.advance(INDEX_NEW_MODULE_AGE_MS)
    await createIndexSync(w.ports, { store }).sync(catalog.entries())
    expect(indexGets(w)).toBe(2)
    expect(store.get('detect')[id]?.[1]).toBe('mod')
  })

  it('reads an index being tried out (MODMGR_INDEX_URL) at every sync, and only an http(s) one', async () => {
    const TRIAL = 'http://127.0.0.1:8000/v1.json'
    const { w, store, catalog } = await setup(world({ env: { MODMGR_INDEX_URL: TRIAL } }))
    w.http.answers.set(TRIAL, { status: 200, text: indexText(9, remoteIndex()) })
    const sync = createIndexSync(w.ports, { store })
    expect(await sync.sync(catalog.entries())).toBe(remoteIndex().size)
    await sync.sync(catalog.entries())
    expect(w.http.gets.filter(url => url === TRIAL)).toHaveLength(2)
    expect(indexGets(w)).toBe(0)
    const odd = await setup(world({ env: { MODMGR_INDEX_URL: 'file:///etc/passwd' } }))
    await createIndexSync(odd.w.ports, { store: odd.store }).sync(odd.catalog.entries())
    expect(odd.w.http.gets).toEqual([INDEX_URL])
  })

  it('says when the index it gave was built, in a later session too', async () => {
    const { w, store } = await setup()
    store.set('catalogIndex', { at: 0, built: 4 })
    expect(createIndexSync(w.ports, { store }).built()).toBe(4)
  })
})

describe('the detector with the index', () => {
  it('probes only what the index didn’t give, and says it used the index', async () => {
    const { w, store, catalog } = await setup()
    w.http.answers.set(INDEX_URL, { status: 200, text: indexText(9, remoteIndex()) })
    const detector = createDetector(w.ports, {
      store,
      catalog,
      index: createIndexSync(w.ports, { store }),
      remoteAllowed: async () => true,
    })
    detector.start()
    for (let i = 0; i < 20; i += 1) await w.clock.advance(0)
    await detector.whenIdle()
    expect(w.http.gets).toEqual([INDEX_URL])
    expect(detector.spent()).toBe(0)
    expect(w.state.values.detect).toMatchObject({ running: false, indexAt: 9 })
    expect(w.state.values.detect.found).toBeGreaterThanOrEqual(1)
    expect(w.state.values.detect.checked).toBe(w.state.values.detect.total)
  })

  it('checks what Discover shows first', async () => {
    const { w, store, catalog } = await setup()
    w.state.values.view = { ...w.state.values.view, search: 'aws-serverless' }
    await catalog.show()
    expect(catalog.priority()[0]).toBe(AWS)
    const detector = createDetector(w.ports, {
      store,
      catalog,
      remoteAllowed: async () => true,
      budget: 1,
    })
    detector.start()
    for (let i = 0; i < 20; i += 1) await w.clock.advance(0)
    await detector.whenIdle()
    const aws = catalogue.find(entry => entry.id === AWS)
    const plan = aws === undefined ? undefined : planProbe(aws)
    expect(plan?.kind).toBe('remote')
    expect(w.http.gets[0]).toBe(plan?.kind === 'remote' ? `${plan.base}hooks/hooks.json` : '')
  })
})
