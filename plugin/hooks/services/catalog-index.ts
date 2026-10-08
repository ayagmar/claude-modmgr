// Reads the hosted catalogue index (domain/catalog-index.ts) and gives its
// kinds to the detector's cache. Asked for at most every INDEX_MAX_AGE_MS
// across sessions (the store keeps when), and at most once per module when the
// host can't be reached; what it read is kept in module memory, so a catalogue
// read again later (a marketplace added) is matched without asking again. Any
// failure is quiet: the detector probes what the index didn't give.

import {
  type CatalogIndexFile,
  fromIndex,
  INDEX_MAX_BYTES,
  INDEX_URL,
  parseIndex,
} from '../domain/catalog-index.ts'
import type { CatalogEntry } from '../domain/cli-results.ts'
import { lruSetMany } from '../domain/lru.ts'
import { CAPS } from '../domain/store-schema.ts'
import type { Ports } from '../ports.ts'
import type { StoreService } from './store.ts'

/** The index is rebuilt daily; twice a day catches a rebuild soon enough. */
export const INDEX_MAX_AGE_MS = 12 * 60 * 60 * 1000
/**
 * A new module holds no index: it asks again after this, so a session started
 * after the marketplaces moved still gets what the index knows.
 */
export const INDEX_NEW_MODULE_AGE_MS = 60 * 60 * 1000

export type IndexSync = {
  /** Gives the index's kinds for `entries` to the detect cache; resolves to how many it gave. */
  sync(entries: readonly CatalogEntry[]): Promise<number>
  /** When the index last read was built (this session's, else the store's). */
  built(): number | undefined
}

export const createIndexSync = (
  ports: Pick<Ports, 'http' | 'clock' | 'env'>,
  deps: {
    readonly store: Pick<StoreService, 'get' | 'update'>
    readonly debug?: (text: string) => void
    readonly url?: string
  },
): IndexSync => {
  const debug = deps.debug ?? (() => {})
  const base = deps.url ?? INDEX_URL
  let held: CatalogIndexFile | undefined
  let unreachable = false

  /** An answer from the host: checked again only after INDEX_MAX_AGE_MS. */
  const answered = (at: number, built?: number): void => {
    deps.store.update('catalogIndex', () => (built === undefined ? { at } : { at, built }))
  }

  const fetchIndex = async (): Promise<CatalogIndexFile | undefined> => {
    const now = await ports.clock.now()
    // An index being tried out (MODMGR_INDEX_URL) is read at every catalogue read.
    const trial = await ports.env.indexUrl().catch(() => undefined)
    const url = trial !== undefined && /^https?:\/\//.test(trial) ? trial : base
    const last = deps.store.get('catalogIndex').at
    const age = held === undefined ? INDEX_NEW_MODULE_AGE_MS : INDEX_MAX_AGE_MS
    if (url === base && (unreachable || (last !== undefined && now - last < age))) return undefined
    let response: { readonly status: number; readonly text: string }
    try {
      response = await ports.http.get(url, INDEX_MAX_BYTES)
    } catch (error) {
      unreachable = true
      debug(`modmgr: index ${url} failed: ${String(error)}`)
      return undefined
    }
    if (response.status !== 200) {
      // A 404 is an answer (no index published yet); anything else may pass.
      if (response.status === 404) answered(now)
      else unreachable = true
      debug(`modmgr: index ${url} answered ${response.status}`)
      return undefined
    }
    const parsed = parseIndex(response.text)
    if (!parsed.ok) {
      answered(now)
      debug(`modmgr: index ${url} unusable: ${parsed.error.message}`)
      return undefined
    }
    answered(now, parsed.value.at)
    return parsed.value
  }

  return {
    async sync(entries) {
      const before = deps.store.get('catalogIndex').built
      const fetched = await fetchIndex()
      held = fetched ?? held
      if (held === undefined) return 0
      // A file built after the last one read corrects what that one said.
      const newer = fetched !== undefined && (before === undefined || fetched.at > before)
      const given = fromIndex(entries, held, deps.store.get('detect'), newer)
      if (given.length > 0) {
        deps.store.update('detect', cache => lruSetMany(cache, given, CAPS.detect))
      }
      return given.length
    },
    built: () => held?.at ?? deps.store.get('catalogIndex').built,
  }
}
