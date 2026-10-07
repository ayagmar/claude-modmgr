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
  type Match,
  matchAll,
  PAGE_SIZE,
  windowOf,
} from '../domain/catalog.ts'
import { type CatalogEntry, parseAvailable, parseMarketplaces } from '../domain/cli-results.ts'
import { localBase, planProbe, probeKey } from '../domain/detector.ts'
import type { Inspection } from '../domain/discover.ts'
import { parseAbsolutePath } from '../domain/ids.ts'
import { fail, ok, type Result } from '../domain/result.ts'
import type { Ports } from '../ports.ts'
import { type CliPorts, runCli, validateRoot } from './cli.ts'
import type { StoreService } from './store.ts'

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
  /** What a local entry can do, read with `validate` before installing; undefined for others. */
  inspect(id: string): Promise<Inspection | undefined>
}

export const createCatalog = (
  ports: CatalogPorts,
  store: Pick<StoreService, 'get'>,
  debug: (text: string) => void = () => {},
): Catalog => {
  let index: CatalogIndex | undefined
  let roots = new Map<string, string>()
  let loadedAt: number | undefined
  let loading: Promise<Result<void>> | undefined
  let kindsVersion = 0
  let memo: { key: string; matched: Match[] } | undefined
  const inspections = new Map<string, Inspection | undefined>()

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

  const read = async (): Promise<Result<void>> => {
    await ports.state.update('catalogPage', page => ({ ...page, loading: true }))
    const run = await runCli(ports, { op: 'available' })
    const parsed = run.ok ? parseAvailable(run.value) : run
    if (!parsed.ok) {
      const { message } = parsed.error
      await ports.state.update('catalogPage', page => {
        const { error: _old, ...rest } = page
        return { ...rest, loading: false, error: message }
      })
      return fail(parsed.error.kind, message)
    }
    const listed = await runCli(ports, { op: 'marketplaces' })
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
    inspections.clear()
    loadedAt = await ports.clock.now()
    await show()
    return ok(undefined)
  }

  const show = async (): Promise<void> => {
    if (index === undefined) return
    const view = await ports.state.read('view')
    const key = `${view.search}\u0000${view.kind}\u0000${view.sort}\u0000${kindsVersion}`
    if (memo?.key !== key) {
      memo = {
        key,
        matched: matchAll(index, { text: view.search, kind: view.kind, sort: view.sort }, kindOf),
      }
    }
    const window = windowOf(memo.matched, view.found, PAGE_SIZE)
    const { offset } = window
    // A row modmgr read before installing says what it can do (the detail, the review).
    const rows = window.rows.map(row => {
      const entry = index?.byId.get(row.id)?.entry
      const inspection = inspections.get(`${row.id}@${entry?.version ?? '?'}`)
      const local = folderOf(row.id) === undefined ? row : { ...row, local: true }
      return inspection === undefined ? local : { ...local, notable: [...inspection.notable] }
    })
    const total = index.size
    const matched = memo.matched.length
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
      loading = read().finally(() => {
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
    async inspect(id) {
      const entry = index?.byId.get(id)?.entry
      if (entry === undefined) return undefined
      const memoKey = `${id}@${entry.version ?? '?'}`
      if (inspections.has(memoKey)) return inspections.get(memoKey)
      const folder = folderOf(id)
      const path = folder === undefined ? undefined : parseAbsolutePath(folder.replace(/\/$/, ''))
      let inspection: Inspection | undefined
      if (path?.ok === true) {
        const report = await validateRoot(ports, path.value)
        if (report.ok) {
          const { notable } = capabilitiesOf(report.value)
          inspection = { notable, hasModule: report.value.hasModule }
        } else {
          debug(`modmgr: validate ${id} failed: ${report.error.message}`)
        }
      }
      inspections.set(memoKey, inspection)
      if (inspection !== undefined) await show()
      return inspection
    },
  }
}
