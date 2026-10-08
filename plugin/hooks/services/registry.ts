// The installed mods (PLAN §2.1, §4): `list --json`, then `validate --json`
// (and `details` for mods) for every `root@version` the store hasn't seen,
// three at a time. Writes the rows to `$.state` `mods`, the selected mod's
// detail to `detail`, and the refresh's outcome to `sync` (the `↻` marker, C8).
// Each refresh also records what every mod can do at its version, so a
// version change that adds notable capabilities is shown (PLAN §2.2).

import type { ModDetail, ModRow } from '../../types/index.d.ts'
import { capabilitiesOf } from '../domain/capabilities.ts'
import { acknowledge, type CapsSighting, capsNewOf, recordCaps } from '../domain/caps-history.ts'
import type { InstalledEntry } from '../domain/cli-results.ts'
import type { Listed } from '../domain/dev.ts'
import { lruSet, lruTouch } from '../domain/lru.ts'
import {
  type Analysis,
  analysisKey,
  analysisOf,
  modDetail,
  modRow,
  rootOf,
  runningVersion,
  sortRows,
} from '../domain/mods.ts'
import { fail, ok, type Result } from '../domain/result.ts'
import { CAPS } from '../domain/store-schema.ts'
import { type ReviewFacts, selectedRow } from '../domain/view.ts'
import type { Ports } from '../ports.ts'
import { type CliPorts, detailsOf, listInstalled, validateRoot } from './cli.ts'
import { mapLimit } from './pool.ts'
import type { StoreService } from './store.ts'

export const VALIDATE_CONCURRENCY = 3

export type RegistryPorts = CliPorts & Pick<Ports, 'state'>

export type RefreshSummary = {
  readonly mods: number
  /** Plugins whose analysis was new this refresh. */
  readonly analysed: number
  /** Entries modmgr couldn't read or inspect. */
  readonly skipped: number
}

export type Registry = {
  /** One refresh at a time; a call during one queues exactly one more. */
  refresh(): Promise<Result<RefreshSummary>>
  /** Shows a mod's detail (`undefined` clears it). */
  select(id: string | undefined): Promise<void>
  /** The `list --json` entry from the last refresh. */
  entry(id: string): InstalledEntry | undefined
  /**
   * What a review says about a mod: its notable capabilities, its other parts
   * and its data's size; for a mod no longer installed, what it could do when
   * last seen (an undo's reinstall).
   */
  facts(id: string): ReviewFacts | undefined
  /**
   * The person opened the mod's detail: what its update added is now seen.
   * The row, the band and the status line drop it; the detail on screen keeps it.
   */
  acknowledge(id: string): Promise<void>
  /** Whether a refresh has listed the plugins yet. */
  isLoaded(): boolean
  /**
   * Every plugin the last refresh listed, mods or not, and whether validate
   * found a hooks module in it (undefined when it couldn't read it): Dev's
   * listed sources.
   */
  listed(): Listed[]
  /**
   * Forgets the analyses of `root` (any version), so the next refresh reads it
   * again (Dev's `v`: a folder edited without a version bump keeps its key).
   * True when there was one.
   */
  forget(root: string): boolean
}

export const createRegistry = (
  ports: RegistryPorts,
  store: StoreService,
  debug: (text: string) => void = () => {},
): Registry => {
  let entries = new Map<string, InstalledEntry>()
  let loaded = false
  let running: Promise<Result<RefreshSummary>> | undefined
  let again = false

  const analyse = async (entry: InstalledEntry, now: number): Promise<Analysis | undefined> => {
    const root = rootOf(entry)
    if (root === undefined) return undefined
    const report = await validateRoot(ports, root)
    if (!report.ok) {
      debug(`modmgr: validate ${entry.id} failed: ${report.error.message}`)
      return undefined
    }
    if (!report.value.hasModule) return analysisOf(report.value, undefined, now)
    const details = await detailsOf(ports, entry.id)
    return analysisOf(report.value, details.ok ? details.value : undefined, now)
  }

  const analysisFor = (id: string | undefined) => {
    const entry = id === undefined ? undefined : entries.get(id)
    const key = entry === undefined ? undefined : analysisKey(entry)
    const analysis = key === undefined ? undefined : store.get('validate')[key]
    return entry === undefined || analysis === undefined ? undefined : { entry, analysis }
  }

  /** A row or detail with what its update added, from the capability history. */
  const withNews = <T extends ModRow>(row: T): T => {
    const news = capsNewOf(store.get('capsHistory')[row.id])
    if (news !== undefined) return { ...row, capsNew: news }
    if (row.capsNew === undefined) return row
    const { capsNew: _seen, ...rest } = row
    return rest as T
  }

  const detailOf = (id: string | undefined): ModDetail | null => {
    const found = analysisFor(id)
    return found === undefined ? null : withNews(modDetail(found.entry, found.analysis))
  }

  const writeNews = async (mods: readonly ModRow[]): Promise<void> => {
    await ports.state.update('attention', attention => ({
      ...attention,
      problems: mods.reduce((sum, row) => sum + row.problems, 0),
      capsChanged: mods.filter(row => row.capsNew !== undefined).length,
    }))
  }

  const once = async (): Promise<Result<RefreshSummary>> => {
    await ports.state.update('sync', sync => ({ ...sync, refreshing: true }))
    const listed = await listInstalled(ports, { dataSize: true })
    const now = await ports.clock.now()
    if (!listed.ok) {
      const { kind, message } = listed.error
      await ports.state.update('sync', sync => ({
        ...sync,
        refreshing: false,
        error: { kind, message },
      }))
      return listed
    }

    const cache = store.get('validate')
    const misses = listed.value.items.filter(entry => {
      const key = analysisKey(entry)
      return key !== undefined && cache[key] === undefined
    })
    const fresh = await mapLimit(misses, VALIDATE_CONCURRENCY, entry => analyse(entry, now))

    let validate = store.get('validate')
    for (const [index, entry] of misses.entries()) {
      const analysis = fresh[index]
      const key = analysisKey(entry)
      if (analysis !== undefined && key !== undefined) {
        validate = lruSet(validate, key, analysis, CAPS.validate)
      }
    }
    const rows: ModRow[] = []
    const sightings: CapsSighting[] = []
    let unread = 0
    for (const entry of listed.value.items) {
      const key = analysisKey(entry)
      const analysis = key === undefined ? undefined : validate[key]
      if (key === undefined || analysis === undefined) {
        unread += 1
        continue
      }
      validate = lruTouch(validate, key)
      if (!analysis.mod) continue
      rows.push(modRow(entry, analysis))
      const { notable } = capabilitiesOf(analysis)
      sightings.push({ id: entry.id, version: runningVersion(entry) ?? '?', notable })
    }
    // Written only when something was analysed: each `$.store.set` rewrites the file (F16).
    // Installed entries are touched in that write, so a cache hit can't be evicted before them.
    if (fresh.some(Boolean)) store.set('validate', validate)
    const history = recordCaps(store.get('capsHistory'), sightings)
    if (history.changed) store.set('capsHistory', history.history)
    entries = new Map(listed.value.items.map(entry => [entry.id, entry]))
    loaded = true

    const mods = sortRows(rows).map(withNews)
    const skipped = listed.value.skipped + unread
    const [before, view] = await Promise.all([ports.state.read('mods'), ports.state.read('view')])
    // The row shown selected stays so when a new one sorts above it (found live in Dev);
    // written only when it moves, since a view write redraws the pane.
    const shown = view.selected === undefined ? selectedRow(view, before)?.id : undefined
    if (shown !== undefined) {
      await ports.state.update('view', current =>
        current.selected === undefined ? { ...current, selected: shown } : current,
      )
    }
    await ports.state.update('mods', () => mods)
    await ports.state.update('detail', detail => detailOf(detail?.id))
    await writeNews(mods)
    await ports.state.update('sync', () => ({ refreshing: false, at: now, skipped }))
    return ok({ mods: mods.length, analysed: fresh.filter(Boolean).length, skipped })
  }

  const loop = async (): Promise<Result<RefreshSummary>> => {
    let result: Result<RefreshSummary>
    do {
      again = false
      try {
        result = await once()
      } catch (error) {
        // A state write refused (or another host error): report it, never throw.
        debug(`modmgr: refresh failed: ${String(error)}`)
        result = fail('unavailable', 'the installed list could not be refreshed')
      }
    } while (again)
    return result
  }

  return {
    refresh() {
      if (running !== undefined) {
        again = true
        return running
      }
      running = loop().finally(() => {
        running = undefined
      })
      return running
    },
    async select(id) {
      await ports.state.update('detail', () => detailOf(id))
    },
    entry: id => entries.get(id),
    facts(id) {
      const found = analysisFor(id)
      if (found === undefined) {
        const last = store.get('capsHistory')[id]
        return last === undefined ? undefined : { notable: last.notable }
      }
      const { analysis, entry } = found
      const { notable } = capabilitiesOf(analysis)
      return {
        notable,
        ...(analysis.parts === undefined ? {} : { parts: analysis.parts }),
        ...(entry.dataBytes === undefined ? {} : { dataBytes: entry.dataBytes }),
      }
    },
    async acknowledge(id) {
      const before = store.get('capsHistory')
      const after = acknowledge(before, id)
      if (after === before) return
      store.set('capsHistory', after)
      // The detail open now keeps saying what was new; the next one won't.
      const mods = await ports.state.update('mods', rows => rows.map(withNews))
      await writeNews(mods)
    },
    isLoaded: () => loaded,
    listed() {
      const cache = store.get('validate')
      return [...entries.values()].map(entry => {
        const key = analysisKey(entry)
        return { entry, mod: key === undefined ? undefined : cache[key]?.mod }
      })
    },
    forget(root) {
      const prefix = `${root.replace(/\/+$/, '')}@`
      const cache = store.get('validate')
      const kept = Object.fromEntries(
        Object.entries(cache).filter(([key]) => !key.startsWith(prefix)),
      )
      if (Object.keys(kept).length === Object.keys(cache).length) return false
      store.set('validate', kept)
      return true
    },
  }
}
