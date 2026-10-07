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

export type CatalogQuery = {
  readonly text: string
  readonly kind: KindFilter
  readonly sort: CatalogSort
  readonly page: number
  readonly pageSize?: number
}

export type CatalogPageResult = {
  readonly rows: CatalogRow[]
  readonly total: number
  readonly matched: number
  readonly page: number
  readonly pages: number
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

export const clampPage = (page: number, pages: number): number =>
  Math.min(Math.max(0, Math.floor(Number.isFinite(page) ? page : 0)), Math.max(0, pages - 1))

export const search = (
  index: CatalogIndex,
  query: CatalogQuery,
  kindOf: (id: string) => CatalogKind,
): CatalogPageResult => {
  const words = tokens(query.text)
  const allowed = KIND_ALLOWED[query.kind]
  const size = Math.max(1, Math.floor(query.pageSize ?? PAGE_SIZE))
  const matched: { item: Indexed; kind: CatalogKind }[] = []
  for (const item of index.order[query.sort]) {
    const kind = kindOf(item.entry.id)
    if (!allowed.has(kind)) continue
    if (words.every(word => item.haystack.includes(word))) matched.push({ item, kind })
  }
  const pages = Math.max(1, Math.ceil(matched.length / size))
  const page = clampPage(query.page, pages)
  const rows = matched
    .slice(page * size, page * size + size)
    .map(({ item, kind }) => toRow(item, kind))
  return { rows, total: index.size, matched: matched.length, page, pages }
}

const toRow = (item: Indexed, kind: CatalogKind): CatalogRow => {
  const row: CatalogRow = {
    id: item.entry.id,
    name: item.name,
    marketplace: sanitize(item.entry.marketplace, { max: NAME_MAX }),
    kind,
    blurb: item.blurb,
  }
  return item.entry.installs === undefined ? row : { ...row, installs: item.entry.installs }
}

/** `1.5k`, `12k`, `3.4M`: install counts in a fixed narrow column. */
export const formatCount = (count: number): string => {
  if (count < 1000) return String(count)
  if (count < 10_000) return `${(Math.floor(count / 100) / 10).toFixed(1).replace(/\.0$/, '')}k`
  if (count < 1_000_000) return `${Math.floor(count / 1000)}k`
  return `${(Math.floor(count / 100_000) / 10).toFixed(1).replace(/\.0$/, '')}M`
}

/** `21–40 of 312` for the pager. */
export const pageLabel = (
  result: Pick<CatalogPageResult, 'page' | 'matched'>,
  size = PAGE_SIZE,
): string => {
  if (result.matched === 0) return '0 of 0'
  const first = result.page * size + 1
  const last = Math.min(result.matched, first + size - 1)
  return `${first}–${last} of ${result.matched}`
}
