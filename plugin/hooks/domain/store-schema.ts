// What modmgr keeps in `$.store` across sessions (PLAN §4), as pure data:
// each key is an envelope `{ v, data }`, checked on read (the file is the
// person's to edit, and an older or newer modmgr may have written it), migrated
// forward, capped, and held under a size budget. services/store.ts does the I/O.

import type { CatalogKind, JobKind, JobState, Tab, View } from '../../types/index.d.ts'
import { isRecord, type JsonRecord } from './json.ts'
import { type Lru, lruTrim } from './lru.ts'
import type { Analysis } from './mods.ts'

export type Prefs = {
  readonly tab: Tab
  readonly sort: View['sort']
  readonly firstRunDone: boolean
}

/** `[sha, kind]` per catalogue entry the detector checked. */
export type DetectEntry = readonly [sha: string, kind: CatalogKind]

/**
 * A mod's notable capabilities at the version modmgr last saw (PLAN §2.2).
 * `added` and `since` are what a version change added and the version it came
 * from, kept until the person opens the mod's detail; both or neither.
 */
export type CapsRecord = {
  readonly version: string
  readonly notable: readonly string[]
  readonly added?: readonly string[]
  readonly since?: string
}

/** A finished job, without its output. */
export type HistoryEntry = {
  readonly id: string
  readonly kind: JobKind
  readonly target?: string
  readonly state: JobState
  readonly endedAt: number
  readonly error?: string
}

/** An update a check found: the version it was found for, and the one available. */
export type FoundUpdate = { readonly from: string; readonly to: string }

/** The update scheduler's last check, and what it found (PLAN §2.6). */
export type Updates = {
  readonly at?: number
  readonly found: Readonly<Record<string, FoundUpdate>>
}

/**
 * The hosted index's last check: when it was last asked for with an answer
 * (a 200, or a 404 before it exists), and when the index it read was built.
 */
export type IndexCheck = {
  readonly at?: number
  readonly built?: number
}

export type StoreData = {
  prefs: Prefs
  detect: Lru<DetectEntry>
  validate: Lru<Analysis>
  capsHistory: Readonly<Record<string, CapsRecord>>
  history: readonly HistoryEntry[]
  updates: Updates
  catalogIndex: IndexCheck
}

export type StoreKey = keyof StoreData

export const STORE_KEYS: readonly StoreKey[] = [
  'prefs',
  'detect',
  'validate',
  'capsHistory',
  'history',
  'updates',
  'catalogIndex',
]

/**
 * The envelope version each key is written at. A key's version moves on when
 * its data changes shape; an older modmgr then reads it as `newer` and leaves
 * it alone instead of rewriting it without the new fields.
 */
export const KEY_VERSIONS: Readonly<Record<StoreKey, number>> = {
  prefs: 1,
  detect: 1,
  validate: 1,
  // 2: records gained `added` and `since` (M3b, the capability diff).
  capsHistory: 2,
  history: 1,
  updates: 1,
  catalogIndex: 1,
}

export const CAPS = { detect: 6000, validate: 300, history: 50 } as const

const KiB = 1024
const MiB = 1024 * KiB
/** Steady-state budget: past it, the caches give up their oldest entries. */
export const SOFT_BUDGET = 1 * MiB
/** Past this even after eviction, a write is refused as `store-full`. The engine's own limit is 4 MiB (F16). */
export const HARD_BUDGET = 3 * MiB

export const DEFAULT_PREFS: Prefs = {
  tab: 'installed',
  sort: 'name',
  firstRunDone: false,
}

export const emptyStore = (): StoreData => ({
  prefs: DEFAULT_PREFS,
  detect: {},
  validate: {},
  capsHistory: {},
  history: [],
  updates: { found: {} },
  catalogIndex: {},
})

// ---- shape checks --------------------------------------------------------

const TABS: readonly string[] = ['installed', 'discover', 'dev', 'health']
const SORTS: readonly string[] = ['installs', 'name', 'marketplace']
const CATALOG_KINDS: readonly string[] = ['mod', 'hooks', 'plain', 'unknown']
const JOB_KINDS: readonly string[] = [
  'install',
  'update',
  'remove',
  'enable',
  'disable',
  'validate',
  'test',
  'reload',
  'marketplace-add',
  'marketplace-update',
]
const JOB_STATES: readonly string[] = [
  'queued',
  'running',
  'ok',
  'failed',
  'cancelled',
  'interrupted',
]

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string')
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0
const oneOf = <T extends string>(values: readonly string[], value: unknown, fallback: T): T =>
  typeof value === 'string' && values.includes(value) ? (value as T) : fallback

export const readPrefs = (value: unknown): Prefs => {
  if (!isRecord(value)) return DEFAULT_PREFS
  return {
    tab: oneOf(TABS, value.tab, DEFAULT_PREFS.tab),
    sort: oneOf(SORTS, value.sort, DEFAULT_PREFS.sort),
    firstRunDone: value.firstRunDone === true,
  }
}

/** Keeps the entries that pass `check`, in order (an LRU's order is its recency). */
const readMap = <V>(
  value: unknown,
  check: (entry: unknown) => V | undefined,
): Record<string, V> => {
  if (!isRecord(value)) return {}
  const out: Record<string, V> = {}
  for (const [key, entry] of Object.entries(value)) {
    const checked = check(entry)
    if (checked !== undefined) out[key] = checked
  }
  return out
}

const readDetectEntry = (entry: unknown): DetectEntry | undefined =>
  Array.isArray(entry) &&
  entry.length === 2 &&
  typeof entry[0] === 'string' &&
  CATALOG_KINDS.includes(entry[1] as string)
    ? [entry[0], entry[1] as CatalogKind]
    : undefined

const readParts = (value: unknown): Analysis['parts'] | undefined =>
  isRecord(value) && isCount(value.skills) && isCount(value.agents) && isCount(value.mcp)
    ? { skills: value.skills, agents: value.agents, mcp: value.mcp }
    : undefined

export const readAnalysis = (entry: unknown): Analysis | undefined => {
  if (!isRecord(entry)) return undefined
  const { mod, events, calls, envReads, errors, warnings, at } = entry
  if (
    typeof mod !== 'boolean' ||
    !isStringArray(events) ||
    !isStringArray(calls) ||
    !isStringArray(envReads) ||
    !isCount(errors) ||
    !isCount(warnings) ||
    !isCount(at)
  ) {
    return undefined
  }
  const parts = readParts(entry.parts)
  const tokens = isCount(entry.tokens) ? entry.tokens : undefined
  return {
    mod,
    events,
    calls,
    envReads,
    errors,
    warnings,
    at,
    ...(parts === undefined ? {} : { parts }),
    ...(tokens === undefined ? {} : { tokens }),
  }
}

const readCapsRecord = (entry: unknown): CapsRecord | undefined => {
  if (!isRecord(entry) || typeof entry.version !== 'string' || !isStringArray(entry.notable)) {
    return undefined
  }
  const record = { version: entry.version, notable: entry.notable }
  return isStringArray(entry.added) && entry.added.length > 0 && typeof entry.since === 'string'
    ? { ...record, added: entry.added, since: entry.since }
    : record
}

const readHistoryEntry = (entry: unknown): HistoryEntry | undefined => {
  if (!isRecord(entry)) return undefined
  const { id, kind, target, state, endedAt, error } = entry
  if (
    typeof id !== 'string' ||
    !JOB_KINDS.includes(kind as string) ||
    !JOB_STATES.includes(state as string) ||
    !isCount(endedAt)
  ) {
    return undefined
  }
  return {
    id,
    kind: kind as JobKind,
    state: state as JobState,
    endedAt,
    ...(typeof target === 'string' ? { target } : {}),
    ...(typeof error === 'string' ? { error } : {}),
  }
}

const readFoundUpdate = (entry: unknown): FoundUpdate | undefined =>
  isRecord(entry) && typeof entry.from === 'string' && typeof entry.to === 'string'
    ? { from: entry.from, to: entry.to }
    : undefined

export const readUpdates = (value: unknown): Updates => {
  if (!isRecord(value)) return { found: {} }
  const found = readMap(value.found, readFoundUpdate)
  return isCount(value.at) ? { at: value.at, found } : { found }
}

export const readIndexCheck = (value: unknown): IndexCheck => {
  if (!isRecord(value)) return {}
  return {
    ...(isCount(value.at) ? { at: value.at } : {}),
    ...(isCount(value.built) ? { built: value.built } : {}),
  }
}

const READERS: { [K in StoreKey]: (data: unknown) => StoreData[K] } = {
  prefs: readPrefs,
  detect: value => lruTrim(readMap(value, readDetectEntry), CAPS.detect),
  validate: value => lruTrim(readMap(value, readAnalysis), CAPS.validate),
  capsHistory: value => readMap(value, readCapsRecord),
  history: value =>
    (Array.isArray(value) ? value : [])
      .flatMap(entry => {
        const read = readHistoryEntry(entry)
        return read === undefined ? [] : [read]
      })
      .slice(-CAPS.history),
  updates: readUpdates,
  catalogIndex: readIndexCheck,
}

// ---- envelopes and migrations ---------------------------------------------

export type Envelope = { readonly v: number; readonly data: unknown }

/**
 * `MIGRATIONS[key][n]` turns a key's data written at version `n + 1` into
 * version `n + 2`.
 */
export type Migrations = Readonly<
  Partial<Record<StoreKey, ReadonlyArray<(data: unknown) => unknown>>>
>
export const MIGRATIONS: Migrations = {
  // 1 → 2: a version-1 record (`{ version, notable }`) is a version-2 record
  // with nothing added since; the reader checks each field either way.
  capsHistory: [data => data],
}

export type Opened<K extends StoreKey> = {
  readonly data: StoreData[K]
  /** Why the stored value was not used as is; absent when it was. */
  readonly note?: 'missing' | 'malformed' | 'newer' | 'migrated'
}

const isEnvelope = (value: unknown): value is JsonRecord & Envelope =>
  isRecord(value) && isCount(value.v) && value.v >= 1 && 'data' in value

/**
 * Reads one key's stored value. A value from a newer modmgr (a downgrade)
 * reads as empty and is marked `newer`, so the caller doesn't overwrite it
 * until it has something of its own to write.
 */
export const openKey = <K extends StoreKey>(
  key: K,
  stored: unknown,
  migrations: Migrations = MIGRATIONS,
  version: number = KEY_VERSIONS[key],
): Opened<K> => {
  const fresh = emptyStore()[key]
  if (stored === undefined) return { data: fresh, note: 'missing' }
  if (!isEnvelope(stored)) return { data: fresh, note: 'malformed' }
  if (stored.v > version) return { data: fresh, note: 'newer' }
  let data = stored.data
  const steps = migrations[key] ?? []
  for (let v = stored.v; v < version; v += 1) {
    const step = steps[v - 1]
    if (step === undefined) return { data: fresh, note: 'malformed' }
    data = step(data)
  }
  const read = READERS[key](data) as StoreData[K]
  return stored.v < version ? { data: read, note: 'migrated' } : { data: read }
}

export const envelope = (data: unknown, version = 1): Envelope => ({
  v: version,
  data,
})

// ---- caps and budget -----------------------------------------------------

/** Applies the per-key caps (PLAN §4). */
const CAPPERS: { [K in StoreKey]: (data: StoreData[K]) => StoreData[K] } = {
  prefs: data => data,
  detect: data => lruTrim(data, CAPS.detect),
  validate: data => lruTrim(data, CAPS.validate),
  capsHistory: data => data,
  history: data => data.slice(-CAPS.history),
  updates: data => data,
  catalogIndex: data => data,
}

export const capped = <K extends StoreKey>(key: K, data: StoreData[K]): StoreData[K] =>
  (CAPPERS[key] as (data: StoreData[K]) => StoreData[K])(data)

/** A key's data in the envelope it is written in. */
export const envelopeOf = <K extends StoreKey>(key: K, data: StoreData[K]): Envelope =>
  envelope(data, KEY_VERSIONS[key])

const encoder = new TextEncoder()

/** Bytes of a key's envelope as the store writes it (JSON, UTF-8). */
export const bytesOf = (data: unknown): number =>
  encoder.encode(JSON.stringify(envelope(data))).length

export type Sizes = Readonly<Record<StoreKey, number>>

export const totalOf = (sizes: Sizes): number =>
  STORE_KEYS.reduce((sum, key) => sum + sizes[key], 0)

/** The caches, in the order they give up entries: the detector's first (it re-probes cheaply). */
const EVICTABLE = ['detect', 'validate'] as const

export type Fitted = {
  readonly data: StoreData
  readonly sizes: Sizes
  /** Keys whose data eviction changed (they need writing). */
  readonly changed: readonly StoreKey[]
}

/**
 * Trims the caches, oldest entries first, until everything fits `budget`.
 * Returns undefined when the non-cache keys alone exceed it.
 */
export const fitBudget = (data: StoreData, sizes: Sizes, budget: number): Fitted | undefined => {
  let current = data
  const now: Record<StoreKey, number> = { ...sizes }
  const changed = new Set<StoreKey>()
  for (const key of EVICTABLE) {
    while (totalOf(now) > budget) {
      const map: Lru<unknown> = current[key]
      const count = Object.keys(map).length
      if (count === 0) break
      const trimmed = lruTrim(map, Math.floor(count / 2))
      current = { ...current, [key]: trimmed }
      now[key] = bytesOf(trimmed)
      changed.add(key)
    }
  }
  if (totalOf(now) > budget) return undefined
  return { data: current, sizes: now, changed: [...changed] }
}
