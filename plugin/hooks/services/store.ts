// modmgr's persistent store over `$.store` (PLAN §4): typed keys in versioned
// envelopes, read once per load, held in memory, and written back in batches
// (each `$.store.set` rewrites the whole file, F16). Writes are capped per key
// and kept under a 1 MiB budget by evicting the caches' oldest entries; past
// 3 MiB a write is refused as `store-full`, never sent.

import { fail, ok, type Result } from '../domain/result.ts'
import {
  bytesOf,
  capped,
  emptyStore,
  envelopeOf,
  fitBudget,
  HARD_BUDGET,
  openKey,
  SOFT_BUDGET,
  STORE_KEYS,
  type StoreData,
  type StoreKey,
  totalOf,
} from '../domain/store-schema.ts'
import type { Ports } from '../ports.ts'

export type StorePorts = Pick<Ports, 'store' | 'clock'>

export type StoreService = {
  /** Reads every key (once; later calls share the first). */
  load(): Promise<void>
  get<K extends StoreKey>(key: K): StoreData[K]
  /** Replaces a key's data in memory and schedules a batched write. */
  set<K extends StoreKey>(key: K, data: StoreData[K]): void
  /** Replaces a key's data with what `change` makes of it; the same value back writes nothing. */
  update<K extends StoreKey>(key: K, change: (data: StoreData[K]) => StoreData[K]): void
  /** Writes every changed key now. */
  flush(): Promise<Result<void>>
  /** Empties the caches (`[clear cache]` in Health). */
  clearCaches(): Promise<Result<void>>
  /** Bytes the store holds, as last written or read. */
  bytes(): number
  /** True after a write was refused for size; cleared by the next good flush. */
  isFull(): boolean
}

export type StoreOptions = {
  /** How long sets gather before one write. */
  readonly flushDelayMs?: number
  readonly debug?: (text: string) => void
}

export const FLUSH_DELAY_MS = 2000

const zeroSizes = (): Record<StoreKey, number> => ({
  prefs: 0,
  detect: 0,
  validate: 0,
  capsHistory: 0,
  history: 0,
  updates: 0,
  catalogIndex: 0,
})

export const createStore = (ports: StorePorts, options: StoreOptions = {}): StoreService => {
  const delay = options.flushDelayMs ?? FLUSH_DELAY_MS
  const debug = options.debug ?? (() => {})
  let data: StoreData = emptyStore()
  const sizes = zeroSizes()
  const dirty = new Set<StoreKey>()
  let loading: Promise<void> | undefined
  let timer: { cancel(): void } | undefined
  let full = false
  let writing: Promise<Result<void>> = Promise.resolve(ok(undefined))

  const readAll = async (): Promise<void> => {
    for (const key of STORE_KEYS) {
      if (dirty.has(key)) continue // set before the load finished: the newer value wins
      let stored: unknown
      try {
        stored = await ports.store.get(key)
      } catch (error) {
        debug(`modmgr: store read ${key} failed: ${String(error)}`)
        continue
      }
      const opened = openKey(key, stored)
      data = { ...data, [key]: opened.data }
      sizes[key] = bytesOf(opened.data)
      if (opened.note === 'migrated') dirty.add(key)
      if (opened.note === 'malformed')
        debug(`modmgr: store ${key} was unreadable; starting it empty`)
    }
  }

  const schedule = (): void => {
    if (timer !== undefined) return
    timer = ports.clock.after(delay, () => {
      timer = undefined
      void flush()
    })
  }

  const write = async (): Promise<Result<void>> => {
    if (loading !== undefined) await loading
    if (dirty.size === 0) return ok(undefined)
    for (const key of dirty) sizes[key] = bytesOf(data[key])
    if (totalOf(sizes) > SOFT_BUDGET) {
      const fitted = fitBudget(data, sizes, SOFT_BUDGET)
      if (fitted !== undefined) {
        data = fitted.data
        Object.assign(sizes, fitted.sizes)
        for (const key of fitted.changed) dirty.add(key)
      } else if (totalOf(sizes) > HARD_BUDGET) {
        full = true
        dirty.clear()
        return fail('store-full', `modmgr's store would hold ${totalOf(sizes)} bytes`)
      }
    }
    const keys = [...dirty]
    dirty.clear()
    for (const [index, key] of keys.entries()) {
      try {
        await ports.store.set(key, envelopeOf(key, data[key]))
      } catch (error) {
        // Kept dirty for the next flush, which a later set schedules.
        for (const left of keys.slice(index)) dirty.add(left)
        full = true
        return fail('store-full', `writing ${key} was refused: ${String(error)}`)
      }
    }
    full = false
    return ok(undefined)
  }

  const flush = (): Promise<Result<void>> => {
    timer?.cancel()
    timer = undefined
    // One write at a time, in order: a flush waits for the one before it.
    writing = writing.then(write)
    return writing
  }

  const set = <K extends StoreKey>(key: K, value: StoreData[K]): void => {
    data = { ...data, [key]: capped(key, value) }
    dirty.add(key)
    schedule()
  }

  return {
    load() {
      loading ??= readAll()
      return loading
    },
    get: key => data[key],
    set,
    // A change that returns what it was given writes nothing (each write rewrites the file, F16).
    update: (key, change) => {
      const next = change(data[key])
      if (next !== data[key]) set(key, next)
    },
    flush,
    clearCaches() {
      const empty = emptyStore()
      set('detect', empty.detect)
      set('validate', empty.validate)
      return flush()
    },
    bytes: () => totalOf(sizes),
    isFull: () => full,
  }
}
