// The Discover catalogue: an index kept in module memory,
// never in `$.state` or `$.store`. It holds the entries of the person's
// marketplaces and the community index's mods (domain/community.ts) that none
// of them lists. Sort orders are computed once at build time, so a keystroke
// costs one filter pass over a pre-sorted list and no sort.

import type { CatalogKind, CatalogRow } from '../../types/index.d.ts'
import { capabilitiesOf } from './capabilities.ts'
import type { CatalogEntry, CatalogSource } from './cli-results.ts'
import { type CommunityMod, communityKey } from './community.ts'
import { githubRepo } from './detector.ts'
import { sanitize } from './sanitize.ts'

export type { CatalogKind, CatalogRow }

export const SORTS = ['installs', 'stars', 'name', 'marketplace'] as const
export type CatalogSort = (typeof SORTS)[number]

/**
 * The matches `$.state` holds around the selection: with mods only, all of
 * them, so the rows drawn (each a stop of the ring) don't move as the
 * selection does; past it the page moves with the selection.
 */
export const PAGE_SIZE = 200
const NAME_MAX = 64
const BLURB_MAX = 140

type Indexed = {
  /** A catalogue entry's plugin id, or a community mod's `communityId`. */
  readonly id: string
  readonly name: string
  readonly blurb: string
  /** Lowercased `name description marketplace id`, the one string a query scans. */
  readonly haystack: string
} & (
  | { readonly entry: CatalogEntry; readonly mod?: undefined }
  | { readonly entry?: undefined; readonly mod: CommunityMod }
)

export type CatalogIndex = {
  readonly size: number
  /** Of `size`, community mods. */
  readonly community: number
  readonly byId: ReadonlyMap<string, Indexed>
  readonly order: Readonly<Record<CatalogSort, readonly Indexed[]>>
}

const byName = (a: Indexed, b: Indexed): number =>
  a.name.localeCompare(b.name) || a.id.localeCompare(b.id)

/** A community mod's id in Discover: its place on GitHub, which no plugin id can be. */
export const communityId = (mod: Pick<CommunityMod, 'repo' | 'path'>): string =>
  `github.com/${communityKey(mod)}`

/** The id a community mod installs as: its plugin in the marketplace at its repository's root. */
export const installIdOf = (mod: CommunityMod): string | undefined =>
  mod.market === undefined ? undefined : `${mod.market.plugin}@${mod.market.name}`

/** Where an entry's files are on GitHub (`owner/repo[/path]`, lowercased), when they are. */
export const githubKeyOf = (source: CatalogSource): string | undefined => {
  if (source.kind === 'github') return source.repo.toLowerCase()
  if (source.kind !== 'url' && source.kind !== 'git-subdir') return undefined
  const repo = githubRepo(source.url)
  if (repo === undefined) return undefined
  const path = source.kind === 'git-subdir' ? source.path.replace(/^\.?\/+|\/+$/g, '') : ''
  return communityKey({ repo: repo.join('/'), path }).toLowerCase()
}

/** What the person has besides the catalogue: community mods they have are not offered. */
export type Have = {
  /** Installed plugin ids. */
  readonly installed: ReadonlySet<string>
  /** Each GitHub marketplace's `owner/repo`, by name: where its `./folder` entries live. */
  readonly marketplaceRepos?: ReadonlyMap<string, string>
}

/** Where an entry's files are on GitHub, a marketplace's own folders included. */
const folderKeyOf = (entry: CatalogEntry, have: Have): string | undefined => {
  if (entry.source.kind !== 'relative') return githubKeyOf(entry.source)
  const repo = have.marketplaceRepos?.get(entry.marketplace)
  const path = entry.source.path.replace(/^\.?\/+|\/+$/g, '')
  return repo === undefined ? undefined : communityKey({ repo, path }).toLowerCase()
}

/**
 * The index of the catalogue's entries, and of the community mods it doesn't
 * already list (by plugin id or by the files on GitHub), that the person
 * hasn't installed and that validate.
 */
export const buildIndex = (
  entries: readonly CatalogEntry[],
  community: readonly CommunityMod[] = [],
  have: Have = { installed: new Set() },
): CatalogIndex => {
  const byId = new Map<string, Indexed>()
  const onGithub = new Set<string>()
  // One entry per folder: two catalogues listing the same plugin (Anthropic's
  // official catalogue and its directory list hundreds alike) offer it once, from
  // the one that counts its installs.
  const kept = new Map<string, CatalogEntry>()
  for (const entry of entries) {
    const key = folderKeyOf(entry, have)
    if (key === undefined) continue
    const held = kept.get(key)
    if (held === undefined || (entry.installs ?? -1) > (held.installs ?? -1)) kept.set(key, entry)
  }
  for (const entry of entries) {
    if (byId.has(entry.id)) continue
    const folder = folderKeyOf(entry, have)
    if (folder !== undefined && kept.get(folder) !== entry) continue
    const name = sanitize(entry.name, { max: NAME_MAX })
    const blurb = sanitize(entry.description, { max: BLURB_MAX })
    const haystack = `${name} ${sanitize(entry.description, { max: 1000 })} ${entry.marketplace} ${entry.id}`
    byId.set(entry.id, { id: entry.id, entry, name, blurb, haystack: haystack.toLowerCase() })
    if (folder !== undefined) onGithub.add(folder)
  }
  for (const mod of community) {
    const id = communityId(mod)
    const installId = installIdOf(mod)
    if (mod.check === 'failed' || byId.has(id)) continue
    if (onGithub.has(communityKey(mod).toLowerCase())) continue
    if (installId !== undefined && (byId.has(installId) || have.installed.has(installId))) continue
    const name = sanitize(mod.name, { max: NAME_MAX })
    const blurb = sanitize(mod.description, { max: BLURB_MAX })
    const haystack = `${name} ${sanitize(mod.description, { max: 1000 })} ${communityKey(mod)}`
    byId.set(id, { id, mod, name, blurb, haystack: haystack.toLowerCase() })
  }
  const all = [...byId.values()]
  const name = [...all].sort(byName)
  const turns = turnsOf(name)
  return {
    size: all.length,
    community: all.filter(item => item.mod !== undefined).length,
    byId,
    order: {
      name,
      installs: [...name].sort(byPopularity(turns)),
      stars: [...name].sort(byStars(turns)),
      marketplace: [...name].sort((a, b) => originOf(a).localeCompare(originOf(b))),
    },
  }
}

/**
 * Each community mod's turn within its repository, in name order: a
 * repository's mods share its stars, so one that ships dozens would fill the
 * top of a list by stars on its own.
 */
const turnsOf = (byName: readonly Indexed[]): ReadonlyMap<string, number> => {
  const seen = new Map<string, number>()
  const turns = new Map<string, number>()
  for (const item of byName) {
    if (item.mod === undefined) continue
    const repo = item.mod.repo.toLowerCase()
    const turn = seen.get(repo) ?? 0
    turns.set(item.id, turn)
    seen.set(repo, turn + 1)
  }
  return turns
}

/**
 * The person's marketplaces first, by installs; then the community's mods by
 * stars, one from each repository before any repository's second.
 */
const byPopularity =
  (turns: ReadonlyMap<string, number>) =>
  (a: Indexed, b: Indexed): number => {
    if (a.entry !== undefined && b.entry !== undefined) {
      return (b.entry.installs ?? -1) - (a.entry.installs ?? -1)
    }
    if (a.entry !== undefined) return -1
    if (b.entry !== undefined) return 1
    return (turns.get(a.id) ?? 0) - (turns.get(b.id) ?? 0) || b.mod.stars - a.mod.stars
  }

/**
 * Community mods by stars, as GitHub counts them, one from each repository
 * before any repository's second; then the catalogue's entries, by installs.
 */
const byStars =
  (turns: ReadonlyMap<string, number>) =>
  (a: Indexed, b: Indexed): number => {
    if (a.mod !== undefined && b.mod !== undefined) {
      return (turns.get(a.id) ?? 0) - (turns.get(b.id) ?? 0) || b.mod.stars - a.mod.stars
    }
    if (a.mod !== undefined) return -1
    if (b.mod !== undefined) return 1
    return (b.entry.installs ?? -1) - (a.entry.installs ?? -1)
  }

/** The marketplace an entry comes from, or the repository of a community mod. */
const originOf = (item: Indexed): string =>
  item.entry !== undefined ? item.entry.marketplace : item.mod.repo

/** Lowercased words of the query; every one must appear in an entry. */
export const tokens = (text: string): string[] =>
  sanitize(text, { max: 100 })
    .toLowerCase()
    .split(' ')
    .filter(word => word.length > 0)

/** One matched entry, with its kind. */
export type Match = { readonly item: Indexed; readonly kind: CatalogKind }

/**
 * Every entry the query matches in its sort's order, only those of `only`'s
 * kind when given: one pass over a pre-sorted list (under 16 ms over 3.5k entries).
 */
export const matchAll = (
  index: CatalogIndex,
  query: {
    readonly text: string
    readonly sort: CatalogSort
    readonly only?: CatalogKind
    /** Only the entries of the person's own marketplaces. */
    readonly mine?: boolean
  },
  kindOf: (id: string) => CatalogKind,
): Match[] => {
  const words = tokens(query.text)
  const matched: Match[] = []
  for (const item of index.order[query.sort]) {
    if (query.mine === true && item.mod !== undefined) continue
    const kind = item.mod !== undefined ? 'mod' : kindOf(item.id)
    if (query.only !== undefined && kind !== query.only) continue
    if (words.every(word => item.haystack.includes(word))) matched.push({ item, kind })
  }
  return matched
}

/**
 * The rows `$.state` holds (never the whole catalogue): at most `size` matches around the one
 * selected (the first when it isn't matched), and where they start.
 */
export const windowOf = (
  matched: readonly Match[],
  selected: string | undefined,
  size = PAGE_SIZE,
): { readonly rows: CatalogRow[]; readonly offset: number } => {
  const at = Math.max(
    0,
    matched.findIndex(match => match.item.id === selected),
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
  if (item.entry === undefined) return communityRow(item, item.mod)
  const { entry } = item
  const row: CatalogRow = {
    id: entry.id,
    name: item.name,
    marketplace: sanitize(entry.marketplace, { max: NAME_MAX }),
    kind,
    blurb: item.blurb,
    source: sourceLabel(entry),
  }
  return {
    ...row,
    ...(entry.installs === undefined ? {} : { installs: entry.installs }),
    ...(entry.version === undefined ? {} : { version: sanitize(entry.version, { max: 20 }) }),
  }
}

/** A community mod's row: what validate read in it is known before installing. */
const communityRow = (item: Indexed, mod: CommunityMod): CatalogRow => {
  const installId = installIdOf(mod)
  return {
    id: item.id,
    name: item.name,
    marketplace: mod.repo,
    kind: 'mod',
    blurb: item.blurb,
    source: item.id,
    stars: mod.stars,
    notable: capabilitiesOf(mod).notable,
    community: {
      repo: mod.repo,
      path: mod.path,
      commit: mod.commit,
      check: mod.check,
      ...(installId === undefined ? {} : { installId }),
    },
  }
}

/** `1.5k`, `12k`, `3.4M`: install counts in a fixed narrow column. */
export const formatCount = (count: number): string => {
  if (count < 1000) return String(count)
  if (count < 10_000) return `${(Math.floor(count / 100) / 10).toFixed(1).replace(/\.0$/, '')}k`
  if (count < 1_000_000) return `${Math.floor(count / 1000)}k`
  return `${(Math.floor(count / 100_000) / 10).toFixed(1).replace(/\.0$/, '')}M`
}
