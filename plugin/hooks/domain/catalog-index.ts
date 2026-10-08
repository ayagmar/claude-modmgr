// The hosted catalogue index: what the detector would find for each entry of
// the official catalogues, built daily by CI (scripts/build-index.ts) and read
// in one request, so Discover knows their mods without probing each entry.
// It only classifies: a kind is taken for an entry only when the index's key
// (the pinned commit, or `local:<version>`) is the entry's own, and installing
// still reviews what the entry can do. The file is external input, checked
// whole: one malformed part rejects it.

import type { CatalogKind } from '../../types/index.d.ts'
import type { CatalogEntry } from './cli-results.ts'
import { planProbe, probeKey } from './detector.ts'
import { parsePluginId } from './ids.ts'
import { isRecord, parseJson } from './json.ts'
import { fail, ok, type Result } from './result.ts'
import type { DetectEntry } from './store-schema.ts'

/** Where clients read it: the branch CI force-pushes, on the host the detector already probes. */
export const INDEX_URL =
  'https://raw.githubusercontent.com/ayagmar/claude-modmgr/catalog-index/v1.json'
export const INDEX_VERSION = 1
/** A body past this is not parsed (the official catalogues make a few hundred KB). */
export const INDEX_MAX_BYTES = 2 * 1024 * 1024
/** More entries than any catalogue lists is not an index. */
export const INDEX_MAX_ENTRIES = 50_000
/** A key is a 40-hex commit or `local:<version>`. */
const KEY_MAX = 100
const KINDS: readonly string[] = ['mod', 'hooks', 'plain', 'unknown']

export type CatalogIndexFile = {
  readonly v: number
  /** When CI built it (ms since the epoch). */
  readonly at: number
  readonly entries: Readonly<Record<string, DetectEntry>>
}

export const parseIndex = (text: string): Result<CatalogIndexFile> => {
  if (text.length > INDEX_MAX_BYTES) return fail('parse', 'the index is too large')
  const value = parseJson(text)
  if (!isRecord(value)) return fail('parse', 'the index is not an object')
  if (value.v !== INDEX_VERSION) return fail('parse', `index version ${String(value.v)}`)
  const at = value.at
  if (typeof at !== 'number' || !Number.isSafeInteger(at) || at < 0) {
    return fail('parse', 'the index has no build time')
  }
  if (!isRecord(value.entries)) return fail('parse', 'the index has no entries')
  const listed = Object.entries(value.entries)
  if (listed.length > INDEX_MAX_ENTRIES) return fail('parse', 'the index lists too many entries')
  const entries: Record<string, DetectEntry> = {}
  for (const [id, entry] of listed) {
    if (!parsePluginId(id).ok) return fail('parse', 'the index names an entry wrongly')
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== 'string' ||
      entry[0].length === 0 ||
      entry[0].length > KEY_MAX ||
      !KINDS.includes(entry[1] as string)
    ) {
      return fail('parse', 'the index has a malformed entry')
    }
    entries[id] = [entry[0], entry[1] as CatalogKind]
  }
  return ok({ v: INDEX_VERSION, at, entries })
}

/**
 * The detect cache entries the index gives for `entries`: a remote entry whose
 * index key is its own pinned commit. `unknown` is not a verdict (a failed
 * read gives it; the detector tries again), and a local entry is read from
 * disk for free, so neither is taken. What the cache already holds at that key
 * is kept, unless `newer`: an index built after the last one read corrects it.
 */
export const fromIndex = (
  entries: readonly CatalogEntry[],
  index: CatalogIndexFile,
  cache: Readonly<Record<string, DetectEntry>>,
  newer = false,
): [string, DetectEntry][] => {
  const out: [string, DetectEntry][] = []
  for (const entry of entries) {
    const listed = index.entries[entry.id]
    if (listed === undefined || listed[1] === 'unknown') continue
    const plan = planProbe(entry)
    if (plan.kind !== 'remote') continue
    const key = probeKey(plan, entry.version)
    if (key === undefined || listed[0] !== key) continue
    const cached = cache[entry.id]
    if (cached?.[0] === key && (!newer || cached[1] === listed[1])) continue
    out.push([entry.id, listed])
  }
  return out
}

/** The file CI writes: entries sorted by id, so a day's diff is only what changed. */
export const indexText = (at: number, entries: ReadonlyMap<string, DetectEntry>): string => {
  const sorted: Record<string, DetectEntry> = {}
  for (const id of [...entries.keys()].sort()) {
    const entry = entries.get(id)
    if (entry !== undefined) sorted[id] = entry
  }
  return `${JSON.stringify({ v: INDEX_VERSION, at, entries: sorted })}\n`
}
