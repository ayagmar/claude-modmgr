// The capability diff: what each installed mod could do at the
// version modmgr last saw, and what a version change added to its notable
// list. A mod seen for the first time is only recorded; a version change that
// adds notable items keeps them (`added`, `since`) until the person opens the
// mod's detail. Kept in the store's `capsHistory` key, a recency-ordered map.

import type { CapsNew, ModRow } from '../../types/index.d.ts'
import { notableVerb } from './capabilities.ts'
import { type Lru, lruSet, lruTrim } from './lru.ts'
import { sanitize } from './sanitize.ts'
import type { CapsRecord } from './store-schema.ts'

/**
 * Records kept: every installed mod, plus recently removed ones (an undo's
 * review says what a reinstall brings back), oldest dropped first.
 */
export const CAPS_HISTORY_CAP = 300

/** One installed mod as a refresh found it. */
export type CapsSighting = {
  readonly id: string
  readonly version: string
  readonly notable: readonly string[]
}

const minus = (a: readonly string[], b: readonly string[]): string[] =>
  a.filter(item => !b.includes(item))

/** The record a sighting leaves, given the one before it. */
export const nextRecord = (before: CapsRecord | undefined, seen: CapsSighting): CapsRecord => {
  const record: CapsRecord = { version: seen.version, notable: [...seen.notable] }
  if (before === undefined) return record
  // Items added earlier and not yet seen by the person stay while still true.
  const carried = (before.added ?? []).filter(item => seen.notable.includes(item))
  const fresh = before.version === seen.version ? [] : minus(seen.notable, before.notable)
  const added = [...carried, ...minus(fresh, carried)]
  if (added.length === 0) return record
  const since = carried.length > 0 && before.since !== undefined ? before.since : before.version
  return { ...record, added, since }
}

const sameRecord = (a: CapsRecord | undefined, b: CapsRecord): boolean =>
  a !== undefined && JSON.stringify(a) === JSON.stringify(b)

/**
 * The history after a refresh saw `sightings`: each seen mod's record updated
 * and made most recent, the oldest unseen ones dropped past the cap. `changed`
 * is false when nothing needs writing. A refresh that only reorders writes
 * nothing (each store write rewrites the file), so the stored order is
 * the order of the last content change: good enough for a cap of 300 over a
 * few dozen installed mods. Don't "fix" the no-write.
 */
export const recordCaps = (
  history: Lru<CapsRecord>,
  sightings: readonly CapsSighting[],
  cap = CAPS_HISTORY_CAP,
): { readonly history: Lru<CapsRecord>; readonly changed: boolean } => {
  let next = history
  let changed = false
  for (const seen of sightings) {
    const before = next[seen.id]
    const record = nextRecord(before, seen)
    if (!sameRecord(before, record)) changed = true
    next = lruSet(next, seen.id, record, Number.POSITIVE_INFINITY)
  }
  const trimmed = lruTrim(next, Math.max(cap, sightings.length))
  return { history: trimmed, changed: changed || trimmed !== next }
}

/** The person opened the mod's detail: what was new is now seen. */
export const acknowledge = (history: Lru<CapsRecord>, id: string): Lru<CapsRecord> => {
  const record = history[id]
  if (record?.added === undefined) return history
  return { ...history, [id]: { version: record.version, notable: record.notable } }
}

/** What a row says is new, from its record. */
export const capsNewOf = (record: CapsRecord | undefined): CapsNew | undefined =>
  record?.added === undefined || record.since === undefined
    ? undefined
    : { since: record.since, added: [...record.added] }

/** The rows with something new, in row order. */
export const capsNews = (mods: readonly ModRow[]): ModRow[] =>
  mods.filter(row => row.capsNew !== undefined && row.capsNew.added.length > 0)

/**
 * One line about what updates added (the band, the status line): the mod and
 * the item when there is one of each, else counts. Undefined when nothing is new.
 */
export const capsLine = (mods: readonly ModRow[]): string | undefined => {
  const news = capsNews(mods)
  const [first] = news
  if (first?.capsNew === undefined) return undefined
  if (news.length > 1) return `${news.length} mods can do more since an update`
  const name = sanitize(first.name, { max: 40 })
  const [only, ...more] = first.capsNew.added
  return only !== undefined && more.length === 0
    ? `${name} can now ${notableVerb(only)}`
    : `${name} can do ${first.capsNew.added.length} new things`
}
