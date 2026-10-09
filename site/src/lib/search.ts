// The page's mod search, shared by the build (the first page, prerendered)
// and the browser (every keystroke after). Pure: no DOM, no fetch. The data
// is the community index cut to what a result shows (mods.json.ts writes it
// as rows of arrays, about a third of the size of objects); a query matches a
// mod when every word appears in its name, description or repository.

/** What a mod can reach, as bits (capabilities.ts's REACH_ORDER). */
export const REACH_BITS = {
  machine: 1,
  network: 2,
  session: 4,
  model: 8,
  tools: 16,
  plugins: 32,
  display: 64,
} as const
export type ReachName = keyof typeof REACH_BITS

/** The notable combinations, as bits (capabilities.ts's NOTABLE_IDS). */
export const NOTABLE_BITS = {
  'runs-programs': 1,
  'reads-and-sends': 2,
  'secret-env': 4,
  'changes-model-input': 8,
  'judges-plugins': 16,
  'starts-model-calls': 32,
} as const
export type NotableName = keyof typeof NOTABLE_BITS

/** One row of mods.json: what a result shows, positionally. */
export type Row = [
  name: string,
  description: string,
  repo: string,
  path: string,
  stars: number,
  /** Days since the epoch of its repository's last push. */
  pushed: number,
  reach: number,
  notable: number,
  /** 0 passes validate, 1 with warnings, 2 fails. */
  check: 0 | 1 | 2,
  /** `<plugin>@<marketplace>` when the marketplace at its repository's root lists it, else empty. */
  install: string,
]

export type Mod = {
  readonly name: string
  readonly description: string
  readonly repo: string
  readonly path: string
  readonly stars: number
  readonly pushed: number
  readonly reach: number
  readonly notable: number
  readonly check: 0 | 1 | 2
  readonly plugin?: string
  readonly marketplace?: string
}

export type Data = { readonly at: number; readonly rows: readonly Row[] }

export const toMod = (row: Row): Mod => {
  const [name, description, repo, path, stars, pushed, reach, notable, check, install] = row
  const at = install.indexOf('@')
  const base = { name, description, repo, path, stars, pushed, reach, notable, check }
  return at < 0
    ? base
    : { ...base, plugin: install.slice(0, at), marketplace: install.slice(at + 1) }
}

export type Index = {
  readonly mods: readonly Mod[]
  /** Lowercased `name`, then the rest a query scans, per mod. */
  readonly names: readonly string[]
  readonly haystacks: readonly string[]
  /** Each mod's turn within its repository (0 for its first, in name order). */
  readonly turns: readonly number[]
}

/**
 * A repository's mods share its stars, so one that ships dozens would fill the
 * top of the popular order on its own: each repository gives one mod a turn.
 * Discover orders community mods the same way (plugin/hooks/domain/catalog.ts).
 */
const turnsOf = (mods: readonly Mod[], names: readonly string[]): number[] => {
  const byName = mods
    .map((_, i) => i)
    .sort((a, b) => (names[a] as string).localeCompare(names[b] as string) || a - b)
  const seen = new Map<string, number>()
  const turns = mods.map(() => 0)
  for (const i of byName) {
    const repo = (mods[i] as Mod).repo.toLowerCase()
    const turn = seen.get(repo) ?? 0
    turns[i] = turn
    seen.set(repo, turn + 1)
  }
  return turns
}

export const indexOf = (mods: readonly Mod[]): Index => {
  const names = mods.map(mod => mod.name.toLowerCase())
  return {
    mods,
    names,
    haystacks: mods.map(mod =>
      `${mod.name} ${mod.description} ${mod.repo} ${mod.path}`.toLowerCase(),
    ),
    turns: turnsOf(mods, names),
  }
}

/** `relevance` with no words is `popular`: by stars, one mod per repository first. */
export const SORTS = ['relevance', 'popular', 'stars', 'recent', 'name'] as const
export type Sort = (typeof SORTS)[number]

export type Query = {
  readonly text: string
  readonly sort: Sort
  /** Mods must reach none of these (REACH_BITS). */
  readonly without?: number
  /** Mods must have none of these notable capabilities (NOTABLE_BITS). */
  readonly withoutNotable?: number
  /** Only mods a marketplace installs. */
  readonly installable?: boolean
  /** Leave out mods that fail validate. */
  readonly working?: boolean
}

export const words = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/\s+/)
    .filter(word => word.length > 0)
    .slice(0, 8)

/** Lower ranks first: the name is the word, starts with it, holds it, or only the rest does. */
const rankOf = (name: string, first: string): number => {
  if (name === first) return 0
  if (name.startsWith(first)) return 1
  if (name.includes(first)) return 2
  return 3
}

/** The places in `index.mods` of every mod the query matches, in its sort's order. */
export const search = (index: Index, query: Query): number[] => {
  const terms = words(query.text)
  const without = query.without ?? 0
  const withoutNotable = query.withoutNotable ?? 0
  const matched: number[] = []
  for (let i = 0; i < index.mods.length; i += 1) {
    const mod = index.mods[i] as Mod
    if ((mod.reach & without) !== 0) continue
    if ((mod.notable & withoutNotable) !== 0) continue
    if (query.installable === true && mod.plugin === undefined) continue
    if (query.working === true && mod.check === 2) continue
    const haystack = index.haystacks[i] as string
    if (terms.every(term => haystack.includes(term))) matched.push(i)
  }
  const mods = index.mods
  const byStars = (a: number, b: number) => (mods[b] as Mod).stars - (mods[a] as Mod).stars || a - b
  const sort = query.sort === 'relevance' && terms.length === 0 ? 'popular' : query.sort
  if (sort === 'relevance') {
    const first = terms[0] ?? ''
    const ranks = new Map(matched.map(i => [i, rankOf(index.names[i] as string, first)]))
    return matched.sort((a, b) => (ranks.get(a) ?? 3) - (ranks.get(b) ?? 3) || byStars(a, b))
  }
  if (sort === 'popular') {
    const turns = index.turns
    return matched.sort((a, b) => (turns[a] as number) - (turns[b] as number) || byStars(a, b))
  }
  if (sort === 'stars') return matched.sort(byStars)
  if (sort === 'recent') {
    return matched.sort(
      (a, b) => (mods[b] as Mod).pushed - (mods[a] as Mod).pushed || byStars(a, b),
    )
  }
  return matched.sort(
    (a, b) => (index.names[a] as string).localeCompare(index.names[b] as string) || a - b,
  )
}

export type Page = {
  /** 1-based, within 1..pages. */
  readonly page: number
  readonly pages: number
  readonly total: number
  /** Places in `index.mods` on this page. */
  readonly items: readonly number[]
  /** The 1-based place of the first item among all matches (0 when none). */
  readonly from: number
}

export const pageOf = (matched: readonly number[], page: number, size: number): Page => {
  const pages = Math.max(1, Math.ceil(matched.length / size))
  const at = Math.min(Math.max(1, Math.floor(page) || 1), pages)
  const start = (at - 1) * size
  return {
    page: at,
    pages,
    total: matched.length,
    items: matched.slice(start, start + size),
    from: matched.length === 0 ? 0 : start + 1,
  }
}

/** Page numbers to offer around the current one: first, last, and a window, gaps as 0. */
export const pageLinks = (page: number, pages: number, around = 1): number[] => {
  const shown = new Set([1, pages])
  for (let n = page - around; n <= page + around; n += 1) if (n >= 1 && n <= pages) shown.add(n)
  const sorted = [...shown].sort((a, b) => a - b)
  const out: number[] = []
  for (const n of sorted) {
    const last = out.at(-1)
    if (last !== undefined && n - last === 2) out.push(n - 1)
    else if (last !== undefined && n - last > 2) out.push(0)
    out.push(n)
  }
  return out
}

/** Where a mod's files are on GitHub. */
export const linkOf = (mod: Pick<Mod, 'repo' | 'path'>): string =>
  mod.path === ''
    ? `https://github.com/${mod.repo}`
    : `https://github.com/${mod.repo}/tree/HEAD/${mod.path}`

/** What to type in Claude Code to install it, or how to load it from a clone. */
export const installLineOf = (mod: Mod): string => {
  if (mod.plugin !== undefined) return `/plugin install ${mod.plugin} --marketplace ${mod.repo}`
  const folder = mod.repo.split('/')[1] ?? mod.repo
  return `git clone https://github.com/${mod.repo} && claude --plugin-dir ${folder}${mod.path === '' ? '' : `/${mod.path}`}`
}

/** `1.2k`, `34k`: stars in a narrow column. */
export const shortCount = (n: number): string => {
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(Math.floor(n / 100) / 10).toFixed(1).replace(/\.0$/, '')}k`
  return `${Math.floor(n / 1000)}k`
}
