// The community index: mods published anywhere on public GitHub, found by
// CI (scripts/build-mods.ts) and read in one request, so Discover can offer
// mods from repositories the person hasn't added as a marketplace. Each mod
// is what `claude plugin validate` reported for it at one commit; installing
// still reviews it. The file is external input, checked whole: one malformed
// part rejects it. Words (events, calls, variable names) are stored once and
// named by their place in `words`, which keeps the file a third of the size.

import { isPluginName } from './ids.ts'
import { isRecord, parseJson } from './json.ts'
import { fail, ok, type Result } from './result.ts'

/** Where clients read it: beside the catalogue index, on the branch CI force-pushes. */
export const COMMUNITY_URL =
  'https://raw.githubusercontent.com/ayagmar/claude-modmgr/catalog-index/mods-v1.json'
export const COMMUNITY_VERSION = 1
/** A body past this is not parsed (about 3,000 mods make 1.4 MB). */
export const COMMUNITY_MAX_BYTES = 4 * 1024 * 1024
export const COMMUNITY_MAX_MODS = 20_000
const WORDS_MAX = 20_000
export const WORD_MAX = 100
export const WORDS_PER_LIST = 200
export const NAME_MAX = 64
export const DESCRIPTION_MAX = 300
const PATH_MAX = 200

/** What `claude plugin validate` said: no issue, warnings only, or errors. */
export const CHECKS = ['passed', 'warnings', 'failed'] as const
export type Check = (typeof CHECKS)[number]

export type CommunityMod = {
  /** `owner/repo` on GitHub. */
  readonly repo: string
  /** The plugin's folder in the repository, `/`-joined; empty at its root. */
  readonly path: string
  /** The commit validated. */
  readonly commit: string
  readonly name: string
  readonly description: string
  readonly stars: number
  /** The repository's last push (ms since the epoch). */
  readonly pushed: number
  /**
   * The marketplace at the repository's root that lists this plugin from its
   * own folder: `claude plugin install <plugin> --marketplace <repo>` installs it.
   */
  readonly market?: { readonly name: string; readonly plugin: string }
  readonly check: Check
  readonly events: readonly string[]
  readonly calls: readonly string[]
  readonly envReads: readonly string[]
}

export type CommunityFile = {
  readonly v: number
  /** When CI built it (ms since the epoch). */
  readonly at: number
  readonly mods: readonly CommunityMod[]
}

const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/
const SEGMENT = /^[A-Za-z0-9_.@+-]{1,100}$/
const COMMIT = /^[0-9a-f]{40}$/

export const isRepo = (value: unknown): value is string =>
  typeof value === 'string' &&
  REPO.test(value) &&
  value.split('/').every(part => part !== '.' && part !== '..')

/** A folder inside a repository: plain segments, none `.` or `..`, or empty for its root. */
export const isRepoPath = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= PATH_MAX &&
  (value === '' ||
    value.split('/').every(segment => SEGMENT.test(segment) && segment !== '.' && segment !== '..'))

/**
 * A mod kept in its repository's `.claude` folder: one that project uses for
 * itself, loaded from a clone rather than published for others.
 */
export const isProjectMod = (path: string): boolean =>
  path === '.claude' || path.startsWith('.claude/')

/** One string to name a mod by: `owner/repo` or `owner/repo/path`. */
export const communityKey = (mod: Pick<CommunityMod, 'repo' | 'path'>): string =>
  mod.path === '' ? mod.repo : `${mod.repo}/${mod.path}`

/**
 * A plugin's page on GitHub: its repository's at the root, else its folder at
 * `commit` (a commit, a branch, or `HEAD` for the default branch).
 */
export const communityLink = (
  mod: Pick<CommunityMod, 'repo' | 'path'> & { readonly commit: string },
): string =>
  mod.path === ''
    ? `https://github.com/${mod.repo}`
    : `https://github.com/${mod.repo}/tree/${mod.commit}/${mod.path}`

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && Array.from(value).length <= max

const malformed = () => fail('parse', 'the community index has a malformed mod')

const wordsAt = (value: unknown, words: readonly string[]): string[] | undefined => {
  if (!Array.isArray(value) || value.length > WORDS_PER_LIST) return undefined
  const out: string[] = []
  for (const at of value) {
    const word = isCount(at) ? words[at] : undefined
    if (word === undefined) return undefined
    out.push(word)
  }
  return out
}

const parseMod = (value: unknown, words: readonly string[]): CommunityMod | undefined => {
  if (!isRecord(value)) return undefined
  const { repo, path, commit, name, description, stars, pushed, market, check } = value
  if (!isRepo(repo) || !isRepoPath(path)) return undefined
  if (typeof commit !== 'string' || !COMMIT.test(commit)) return undefined
  if (!isText(name, NAME_MAX) || name.length === 0 || !isText(description, DESCRIPTION_MAX)) {
    return undefined
  }
  if (!isCount(stars) || !isCount(pushed)) return undefined
  if (!(CHECKS as readonly unknown[]).includes(check)) return undefined
  const events = wordsAt(value.events, words)
  const calls = wordsAt(value.calls, words)
  const envReads = wordsAt(value.envReads, words)
  if (events === undefined || calls === undefined || envReads === undefined) return undefined
  const mod = {
    repo,
    path,
    commit,
    name,
    description,
    stars,
    pushed,
    check: check as Check,
    events,
    calls,
    envReads,
  }
  if (market === undefined) return mod
  if (!isRecord(market) || !isPluginName(market.name) || !isPluginName(market.plugin)) {
    return undefined
  }
  return { ...mod, market: { name: market.name, plugin: market.plugin } }
}

export const parseCommunity = (text: string): Result<CommunityFile> => {
  if (text.length > COMMUNITY_MAX_BYTES) return fail('parse', 'the community index is too large')
  const value = parseJson(text)
  if (!isRecord(value)) return fail('parse', 'the community index is not an object')
  if (value.v !== COMMUNITY_VERSION) {
    return fail('parse', `community index version ${String(value.v)}`)
  }
  if (!isCount(value.at)) return fail('parse', 'the community index has no build time')
  const words = value.words
  if (
    !Array.isArray(words) ||
    words.length > WORDS_MAX ||
    !words.every(word => isText(word, WORD_MAX))
  ) {
    return fail('parse', 'the community index has malformed words')
  }
  if (!Array.isArray(value.mods)) return fail('parse', 'the community index has no mods')
  if (value.mods.length > COMMUNITY_MAX_MODS) {
    return fail('parse', 'the community index lists too many mods')
  }
  const mods: CommunityMod[] = []
  const keys = new Set<string>()
  for (const entry of value.mods) {
    const mod = parseMod(entry, words)
    if (mod === undefined) return malformed()
    const key = communityKey(mod)
    if (keys.has(key)) return fail('parse', 'the community index lists a mod twice')
    keys.add(key)
    mods.push(mod)
  }
  return ok({ v: COMMUNITY_VERSION, at: value.at, mods })
}

/** The file CI writes: mods most starred first, each word stored once. */
export const communityText = (at: number, mods: readonly CommunityMod[]): string => {
  const words: string[] = []
  const places = new Map<string, number>()
  const place = (word: string): number => {
    const known = places.get(word)
    if (known !== undefined) return known
    places.set(word, words.length)
    words.push(word)
    return words.length - 1
  }
  const sorted = [...mods].sort(
    (a, b) => b.stars - a.stars || communityKey(a).localeCompare(communityKey(b)),
  )
  const out = sorted.map(mod => ({
    repo: mod.repo,
    path: mod.path,
    commit: mod.commit,
    name: mod.name,
    description: mod.description,
    stars: mod.stars,
    pushed: mod.pushed,
    ...(mod.market === undefined ? {} : { market: mod.market }),
    check: mod.check,
    events: mod.events.map(place),
    calls: mod.calls.map(place),
    envReads: mod.envReads.map(place),
  }))
  return `${JSON.stringify({ v: COMMUNITY_VERSION, at, words, mods: out })}\n`
}
