// The Discover catalogue (PLAN §2.3, R2, R11): `list --json --available` read
// into an index in module memory, never into `$.state` or `$.store`. `$.state`
// gets the window of rows around Discover's selection and the counts. Kinds
// come from the detector's cache (the store's `detect` key), checked against
// each entry's pinned commit or version.

import type { CatalogKind } from '../../types/index.d.ts'
import { capabilitiesOf } from '../domain/capabilities.ts'
import {
  buildIndex,
  type CatalogIndex,
  type CatalogSort,
  type Match,
  matchAll,
  PAGE_SIZE,
  windowOf,
} from '../domain/catalog.ts'
import { type CatalogEntry, parseAvailable, parseMarketplaces } from '../domain/cli-results.ts'
import { localBase, planProbe, probeKey } from '../domain/detector.ts'
import type { Inspection, Unread } from '../domain/discover.ts'
import { parseAbsolutePath } from '../domain/ids.ts'
import { lruSet } from '../domain/lru.ts'
import { type Analysis, analysisOf } from '../domain/mods.ts'
import { fail, ok, type Result } from '../domain/result.ts'
import { CAPS } from '../domain/store-schema.ts'
import type { Ports } from '../ports.ts'
import { type CliPorts, runCli, validateRoot } from './cli.ts'
import type { StoreService } from './store.ts'
import { NO_TIMING, type Timing, timed } from './timing.ts'

/** How long a loaded catalogue is used before Discover reads it again (PLAN §2.3). */
export const CATALOG_MAX_AGE_MS = 6 * 60 * 60 * 1000

export type CatalogPorts = CliPorts & Pick<Ports, 'state'>

export type Catalog = {
  /** Reads the catalogue (once; again past CATALOG_MAX_AGE_MS or when forced). */
  load(options?: { force?: boolean }): Promise<Result<void>>
  /** Writes the window around Discover's selection for its current search to `catalogPage`. */
  show(): Promise<void>
  /** The first or last entry the current search matches. */
  edge(which: 'first' | 'last'): string | undefined
  /** The detector's cache changed: kinds are read again. */
  invalidate(): void
  isLoaded(): boolean
  entry(id: string): CatalogEntry | undefined
  /** Every entry, most installed first (the detector's order). */
  entries(): readonly CatalogEntry[]
  /** A marketplace's folder on disk (a clone, or the folder itself). */
  rootOf(marketplace: string): string | undefined
  /** The folder of a local entry (a path inside its marketplace), or undefined. */
  folderOf(id: string): string | undefined
  kindOf(id: string): CatalogKind
  /**
   * The entries the person is looking at, to check first: the rows shown, then
   * the first PRIORITY_MAX the search matches whatever their kind (so a search
   * under "mods only" finds the mods among entries not checked yet).
   */
  priority(): readonly string[]
  /**
   * What a local entry can do, read with `validate` before installing (or why it
   * couldn't be); undefined for an entry with no files on disk. One child per
   * entry and version at a time, three at once; the answer is kept in the store's
   * `validate` key beside the registry's, so a reload or the next session has it.
   */
  inspect(id: string): Promise<Inspection | Unread | undefined>
}

/** Validations of catalogue entries at once (PLAN §6: cache misses, three concurrent). */
export const INSPECT_CONCURRENCY = 3

/** Search matches the detector checks ahead of the rest. */
export const PRIORITY_MAX = 200

const toInspection = (analysis: Analysis): Inspection => ({
  notable: capabilitiesOf(analysis).notable,
  hasModule: analysis.mod,
})

export const createCatalog = (
  ports: CatalogPorts,
  store: Pick<StoreService, 'get' | 'update'>,
  debug: (text: string) => void = () => {},
  timing: Timing = NO_TIMING,
): Catalog => {
  let index: CatalogIndex | undefined
  let roots = new Map<string, string>()
  let loadedAt: number | undefined
  let loading: Promise<Result<void>> | undefined
  let kindsVersion = 0
  let memo: { key: string; matched: Match[] } | undefined
  // What the last window showed, and the search's matches whatever their kind.
  let shown: { ids: string[]; text: string; sort: CatalogSort } | undefined
  let searched: { key: string; ids: string[] } | undefined
  // Reads that failed this session (`r` tries again), and the ones under way.
  const failures = new Map<string, string>()
  const inflight = new Map<string, Promise<Inspection | Unread | undefined>>()
  let slots = INSPECT_CONCURRENCY
  const waiting: Array<() => void> = []
  const acquire = (): Promise<void> => {
    if (slots > 0) {
      slots -= 1
      return Promise.resolve()
    }
    return new Promise(resolve => waiting.push(resolve))
  }
  const release = (): void => {
    const next = waiting.shift()
    if (next === undefined) slots += 1
    else next()
  }
  // A window computed from a view another show() has since replaced is dropped (R-M4-3).
  let generation = 0

  const kindOf = (id: string): CatalogKind => {
    const entry = index?.byId.get(id)?.entry
    if (entry === undefined) return 'unknown'
    const key = probeKey(planProbe(entry), entry.version)
    const cached = store.get('detect')[id]
    return key !== undefined && cached !== undefined && cached[0] === key ? cached[1] : 'unknown'
  }

  const folderOf = (id: string): string | undefined => {
    const entry = index?.byId.get(id)?.entry
    if (entry === undefined) return undefined
    const plan = planProbe(entry)
    return plan.kind === 'local' ? localBase(roots.get(entry.marketplace), plan.path) : undefined
  }

  /** Where an entry's analysis is kept: its folder at its version, as the registry keys installs. */
  const inspectKey = (id: string): { key: string; folder: string } | undefined => {
    const entry = index?.byId.get(id)?.entry
    const folder = folderOf(id)
    if (entry === undefined || folder === undefined) return undefined
    return { key: `${folder.replace(/\/$/, '')}@${entry.version ?? '?'}`, folder }
  }

  /** What is known about a local entry without reading it again. */
  const known = (id: string): Inspection | Unread | undefined => {
    const at = inspectKey(id)
    if (at === undefined) return undefined
    const analysis = store.get('validate')[at.key]
    if (analysis !== undefined) return toInspection(analysis)
    const failed = failures.get(at.key)
    return failed === undefined ? undefined : { failed }
  }

  const read = async (): Promise<Result<void>> => {
    await ports.state.update('catalogPage', page => ({ ...page, loading: true }))
    // Two reads that don't depend on each other, side by side (M6: about 0.5 s and 0.3 s).
    const [run, listed] = await Promise.all([
      runCli(ports, { op: 'available' }),
      runCli(ports, { op: 'marketplaces' }),
    ])
    const parsed = run.ok ? parseAvailable(run.value) : run
    if (!parsed.ok) {
      const { message } = parsed.error
      await ports.state.update('catalogPage', page => {
        const { error: _old, ...rest } = page
        return { ...rest, loading: false, error: message }
      })
      return fail(parsed.error.kind, message)
    }
    const marketplaces = listed.ok ? parseMarketplaces(listed.value) : listed
    if (marketplaces.ok) {
      roots = new Map(
        marketplaces.value.items.flatMap(item =>
          item.installLocation === undefined ? [] : [[item.name, item.installLocation] as const],
        ),
      )
    } else {
      debug(`modmgr: marketplace list failed: ${marketplaces.error.message}`)
    }
    index = buildIndex(parsed.value.available.items)
    memo = undefined
    searched = undefined
    loadedAt = await ports.clock.now()
    await show()
    return ok(undefined)
  }

  const show = (): Promise<void> => timed(timing, 'catalogue window', showWindow)

  const showWindow = async (): Promise<void> => {
    if (index === undefined) return
    generation += 1
    const mine = generation
    const view = await ports.state.read('view')
    if (mine !== generation) return
    const key = `${view.search}\u0000${view.kind}\u0000${view.sort}\u0000${kindsVersion}`
    if (memo?.key !== key) {
      memo = {
        key,
        matched: matchAll(index, { text: view.search, kind: view.kind, sort: view.sort }, kindOf),
      }
    }
    const window = windowOf(memo.matched, view.found, PAGE_SIZE)
    shown = { ids: window.rows.map(row => row.id), text: view.search, sort: view.sort }
    const { offset } = window
    // A row modmgr read before installing says what it can do (the detail, the review).
    const rows = window.rows.map(row => {
      if (folderOf(row.id) === undefined) return row
      const local = { ...row, local: true }
      const read = known(row.id)
      if (read === undefined) return local
      return 'failed' in read
        ? { ...local, unread: read.failed }
        : { ...local, notable: [...read.notable] }
    })
    const total = index.size
    const matched = memo.matched.length
    if (mine !== generation) return
    await ports.state.update('catalogPage', () => ({
      rows,
      total,
      matched,
      offset,
      loading: false,
    }))
  }

  return {
    async load(options = {}) {
      if (loading !== undefined) return loading
      const now = await ports.clock.now()
      const fresh = loadedAt !== undefined && now - loadedAt < CATALOG_MAX_AGE_MS
      if (fresh && options.force !== true) return ok(undefined)
      if (options.force === true) failures.clear()
      loading = timed(timing, 'catalogue load', read).finally(() => {
        loading = undefined
      })
      return loading
    },
    show,
    edge(which) {
      const matched = memo?.matched ?? []
      return (which === 'first' ? matched[0] : matched.at(-1))?.item.entry.id
    },
    invalidate() {
      kindsVersion += 1
    },
    isLoaded: () => index !== undefined,
    entry: id => index?.byId.get(id)?.entry,
    entries: () => (index === undefined ? [] : index.order.installs.map(item => item.entry)),
    rootOf: marketplace => roots.get(marketplace),
    folderOf,
    kindOf,
    priority() {
      if (index === undefined || shown === undefined) return []
      const key = `${shown.text}\u0000${shown.sort}`
      if (searched?.key !== key) {
        const all = matchAll(
          index,
          { text: shown.text, kind: 'all', sort: shown.sort },
          () => 'unknown',
        )
        searched = { key, ids: all.slice(0, PRIORITY_MAX).map(match => match.item.entry.id) }
      }
      return [...shown.ids, ...searched.ids]
    },
    inspect(id) {
      const at = inspectKey(id)
      if (at === undefined) return Promise.resolve(undefined)
      const now = known(id)
      if (now !== undefined) return Promise.resolve(now)
      const running = inflight.get(at.key)
      if (running !== undefined) return running
      const reading = (async (): Promise<Inspection | Unread> => {
        await acquire()
        try {
          const path = parseAbsolutePath(at.folder.replace(/\/$/, ''))
          if (!path.ok) return { failed: path.error.message }
          const report = await validateRoot(ports, path.value)
          if (!report.ok) {
            debug(`modmgr: validate ${id} failed: ${report.error.message}`)
            failures.set(at.key, report.error.message)
            return { failed: report.error.message }
          }
          const analysis = analysisOf(report.value, undefined, await ports.clock.now())
          store.update('validate', cache => lruSet(cache, at.key, analysis, CAPS.validate))
          return toInspection(analysis)
        } finally {
          release()
        }
      })()
        // The detail and the review redraw when it lands.
        .then(async result => {
          await show()
          return result
        })
        .finally(() => {
          inflight.delete(at.key)
        })
      inflight.set(at.key, reading)
      return reading
    },
  }
}
