// The Discover catalogue (PLAN §2.3, R11): an index kept in module memory,
// never in `$.state` or `$.store`. Sort orders are computed once at build time,
// so a keystroke costs one filter pass over a pre-sorted list and no sort.

import type { CatalogKind, CatalogRow } from '../../types/index.d.ts'
import type { CatalogEntry } from './cli-results.ts'
import { sanitize } from './sanitize.ts'

export type { CatalogKind, CatalogRow }

export const SORTS = ['installs', 'name', 'marketplace'] as const
export type CatalogSort = (typeof SORTS)[number]
export const KIND_FILTERS = ['mods', 'hooks', 'all'] as const
export type KindFilter = (typeof KIND_FILTERS)[number]

export const PAGE_SIZE = 50
const NAME_MAX = 64
const BLURB_MAX = 140

type Indexed = {
  readonly entry: CatalogEntry
  readonly name: string
  readonly blurb: string
  /** Lowercased `name description marketplace id`, the one string a query scans. */
  readonly haystack: string
}

export type CatalogIndex = {
  readonly size: number
  readonly byId: ReadonlyMap<string, Indexed>
  readonly order: Readonly<Record<CatalogSort, readonly Indexed[]>>
}

const byName = (a: Indexed, b: Indexed): number =>
  a.name.localeCompare(b.name) || a.entry.id.localeCompare(b.entry.id)

export const buildIndex = (entries: readonly CatalogEntry[]): CatalogIndex => {
  const byId = new Map<string, Indexed>()
  for (const entry of entries) {
    if (byId.has(entry.id)) continue
    const name = sanitize(entry.name, { max: NAME_MAX })
    const blurb = sanitize(entry.description, { max: BLURB_MAX })
    const haystack = `${name} ${sanitize(entry.description, { max: 1000 })} ${entry.marketplace} ${entry.id}`
    byId.set(entry.id, { entry, name, blurb, haystack: haystack.toLowerCase() })
  }
  const all = [...byId.values()]
  const name = [...all].sort(byName)
  return {
    size: all.length,
    byId,
    order: {
      name,
      installs: [...name].sort((a, b) => (b.entry.installs ?? -1) - (a.entry.installs ?? -1)),
      marketplace: [...name].sort((a, b) => a.entry.marketplace.localeCompare(b.entry.marketplace)),
    },
  }
}

/** Lowercased words of the query; every one must appear in an entry. */
export const tokens = (text: string): string[] =>
  sanitize(text, { max: 100 })
    .toLowerCase()
    .split(' ')
    .filter(word => word.length > 0)

const KIND_ALLOWED: Readonly<Record<KindFilter, ReadonlySet<CatalogKind>>> = {
  mods: new Set(['mod']),
  hooks: new Set(['mod', 'hooks']),
  all: new Set(['mod', 'hooks', 'plain', 'unknown']),
}

/** One matched entry, with the kind the filter saw. */
export type Match = { readonly item: Indexed; readonly kind: CatalogKind }

/** Where a kind ranks: mods first, then plugins with command hooks, then the rest. */
const RANK: Readonly<Record<CatalogKind, number>> = { mod: 0, hooks: 1, plain: 2, unknown: 2 }

/**
 * Every entry the query matches, mods first and each rank in its sort's order:
 * one pass over a pre-sorted list (under 16 ms over 3.5k entries).
 */
export const matchAll = (
  index: CatalogIndex,
  query: { readonly text: string; readonly kind: KindFilter; readonly sort: CatalogSort },
  kindOf: (id: string) => CatalogKind,
): Match[] => {
  const words = tokens(query.text)
  const allowed = KIND_ALLOWED[query.kind]
  const ranks: Match[][] = [[], [], []]
  for (const item of index.order[query.sort]) {
    const kind = kindOf(item.entry.id)
    if (!allowed.has(kind)) continue
    if (words.every(word => item.haystack.includes(word))) ranks[RANK[kind]]?.push({ item, kind })
  }
  return ranks.flat()
}

/**
 * The rows `$.state` holds (R11): at most `size` matches around the one
 * selected (the first when it isn't matched), and where they start.
 */
export const windowOf = (
  matched: readonly Match[],
  selected: string | undefined,
  size = PAGE_SIZE,
): { readonly rows: CatalogRow[]; readonly offset: number } => {
  const at = Math.max(
    0,
    matched.findIndex(match => match.item.entry.id === selected),
  )
  const half = Math.floor(size / 2)
  const offset = Math.max(0, Math.min(at - half, matched.length - size))
  return {
    rows: matched.slice(offset, offset + size).map(({ item, kind }) => toRow(item, kind)),
    offset,
  }
}

/** Where an entry comes from, in a few words (the detail's "from" line). */
export const sourceLabel = (entry: Pick<CatalogEntry, 'source'>): string => {
  const source = entry.source
  switch (source.kind) {
    case 'relative':
      return 'its marketplace folder'
    case 'github':
      return `github.com/${sanitize(source.repo, { max: 80 })}`
    case 'url':
      return sanitize(source.url.replace(/^https:\/\//, '').replace(/\.git$/, ''), { max: 80 })
    case 'git-subdir':
      return `${sanitize(source.url.replace(/^https:\/\//, '').replace(/\.git$/, ''), { max: 60 })} ${sanitize(source.path, { max: 60 })}`
    case 'command':
      return 'a command its marketplace runs'
    default:
      return 'another source'
  }
}

const toRow = (item: Indexed, kind: CatalogKind): CatalogRow => {
  const row: CatalogRow = {
    id: item.entry.id,
    name: item.name,
    marketplace: sanitize(item.entry.marketplace, { max: NAME_MAX }),
    kind,
    blurb: item.blurb,
    source: sourceLabel(item.entry),
  }
  return {
    ...row,
    ...(item.entry.installs === undefined ? {} : { installs: item.entry.installs }),
    ...(item.entry.version === undefined
      ? {}
      : { version: sanitize(item.entry.version, { max: 20 }) }),
  }
}

/** `1.5k`, `12k`, `3.4M`: install counts in a fixed narrow column. */
export const formatCount = (count: number): string => {
  if (count < 1000) return String(count)
  if (count < 10_000) return `${(Math.floor(count / 100) / 10).toFixed(1).replace(/\.0$/, '')}k`
  if (count < 1_000_000) return `${Math.floor(count / 1000)}k`
  return `${(Math.floor(count / 100_000) / 10).toFixed(1).replace(/\.0$/, '')}M`
}
