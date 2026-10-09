// Finds repositories that may hold mods through GitHub's search API: code
// search for the files a mod has, repository search for the topics and words
// mod authors use. GitHub answers at most 1,000 results per query, so a query
// past that is split (code by file size, repositories by push date) until each
// part fits. Requests go one at a time with a pause, and a rate limit waits for
// the time GitHub names. The method follows awesome-claude-code-mods'
// (github.com/karanb192/awesome-claude-code-mods, CC0).

export type SearchKind = 'code' | 'repositories'

export type SearchPage = {
  readonly total: number
  readonly incomplete: boolean
  /** `owner/repo` of each result, as GitHub spells it. */
  readonly repos: readonly string[]
}

/** One page of a search, or why there is none. */
export type SearchAnswer =
  | { readonly page: SearchPage }
  | { readonly status: number; readonly waitSeconds?: number; readonly message: string }

export type SearchDeps = {
  readonly search: (kind: SearchKind, query: string, page: number) => Promise<SearchAnswer>
  readonly sleep: (ms: number) => Promise<void>
  readonly log: (line: string) => void
}

/** Files only mods have: the switch that once turned mods on, and a hooks.json with modules. */
export const CODE_QUERIES = [
  'CLAUDE_CODE_ENABLE_FUNCTION_HOOKS',
  '"modules" filename:hooks.json path:hooks',
]
/** Small enough to read whole every day. */
export const TOPIC_QUERIES = [
  'topic:claude-code-mod',
  'topic:claude-code-mods',
  'topic:claude-mods',
  'topic:function-hooks',
]
/** Too broad to read whole: only repositories pushed since the last build. */
export const RECENT_QUERIES = [
  'claude mod in:name,description',
  'claude mods in:name,description',
  'topic:claude-code-plugin',
]

const PER_PAGE = 100
const CAP = 1000
/** GitHub doesn't index code files larger than this. */
const MAX_FILE_BYTES = 384 * 1024
/** Search allows 10 code and 30 repository requests a minute. */
export const PAUSE_MS: Readonly<Record<SearchKind, number>> = { code: 6500, repositories: 2200 }
const ATTEMPTS = 5
/** What all rate-limit waits of one build may add up to. */
const WAIT_BUDGET_MS = 20 * 60 * 1000

const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')

export const createSearcher = (deps: SearchDeps) => {
  let waited = 0
  let requests = 0

  const page = async (kind: SearchKind, query: string, n: number): Promise<SearchPage> => {
    for (let attempt = 1; ; attempt += 1) {
      if (requests > 0) await deps.sleep(PAUSE_MS[kind])
      requests += 1
      const answer = await deps.search(kind, query, n)
      if ('page' in answer && !answer.page.incomplete) return answer.page
      const status = 'page' in answer ? 200 : answer.status
      const message = 'page' in answer ? 'incomplete results' : answer.message
      const limited = status === 403 || status === 429
      if (!(limited || status >= 500 || 'page' in answer) || attempt === ATTEMPTS) {
        throw new Error(`${kind} search "${query}" page ${n}: ${status} ${message}`)
      }
      const named = 'page' in answer ? 0 : (answer.waitSeconds ?? 0) * 1000
      const delay = Math.max(named, Math.min(60_000 * 2 ** (attempt - 1), 480_000))
      if (waited + delay > WAIT_BUDGET_MS) {
        throw new Error(`${kind} search "${query}": rate-limit waits past the budget`)
      }
      deps.log(
        `${kind} search "${query}" page ${n}: ${status} ${message}; waiting ${delay / 1000} s`,
      )
      waited += delay
      await deps.sleep(delay)
    }
  }

  /** Every result of a query that fits under the cap, or undefined when it doesn't. */
  const whole = async (kind: SearchKind, query: string): Promise<string[] | undefined> => {
    const first = await page(kind, query, 1)
    if (first.total > CAP) return undefined
    const repos = [...first.repos]
    for (let n = 2; n <= Math.ceil(first.total / PER_PAGE); n += 1) {
      repos.push(...(await page(kind, query, n)).repos)
    }
    return repos
  }

  const bySize = async (query: string, lo: number, hi: number): Promise<string[]> => {
    const scoped = `${query} size:${lo}..${hi}`
    const found = await whole('code', scoped)
    if (found !== undefined) return found
    if (lo === hi) throw new Error(`code search "${scoped}" is still past ${CAP} results`)
    const mid = Math.floor((lo + hi) / 2)
    return [...(await bySize(query, lo, mid)), ...(await bySize(query, mid + 1, hi))]
  }

  const byPush = async (query: string, from: number, to: number): Promise<string[]> => {
    const scoped = `${query} pushed:${iso(from)}..${iso(to)}`
    const found = await whole('repositories', scoped)
    if (found !== undefined) return found
    if (to - from < 60_000) throw new Error(`repository search "${scoped}" is still past ${CAP}`)
    const mid = Math.floor((from + to) / 2)
    return [...(await byPush(query, from, mid)), ...(await byPush(query, mid + 1000, to))]
  }

  return {
    /** Repositories with a file a code query matches. */
    async code(query: string): Promise<string[]> {
      return (await whole('code', query)) ?? bySize(query, 0, MAX_FILE_BYTES - 1)
    },
    /** Repositories a repository query matches, pushed between `from` and `to` when given. */
    async repositories(query: string, window?: { from: number; to: number }): Promise<string[]> {
      if (window !== undefined) return byPush(query, window.from, window.to)
      const found = await whole('repositories', query)
      if (found === undefined) throw new Error(`repository search "${query}" is past ${CAP}`)
      return found
    },
    requests: () => requests,
  }
}
