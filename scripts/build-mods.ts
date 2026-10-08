// Builds the community index (plugin/hooks/domain/community.ts): every mod
// found on public GitHub, with what `claude plugin validate` reports for it.
// Candidates are the repositories GitHub search finds (scripts/mods/search.ts),
// the ones the last published index listed, and the candidate list of
// awesome-claude-code-mods (CC0), which holds repositories code search hasn't
// indexed yet. Each is cloned shallow, its symbolic links checked out as plain
// files, and read (scripts/mods/inspect.ts): no mod code runs. A repository
// that can't be read this time keeps what the last index said of it. It
// refuses to write a file that lost too many mods, so a bad run can't replace
// a good index. CI (.github/workflows/index.yml) runs it daily with a token
// that can only read; its logic takes the network and the checkout as
// arguments, so a test runs it on fixtures.
//
//   GITHUB_TOKEN=… node scripts/build-mods.ts <out.json>

import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import {
  COMMUNITY_MAX_BYTES,
  COMMUNITY_URL,
  type CommunityMod,
  communityText,
  isRepo,
  parseCommunity,
} from '../plugin/hooks/domain/community.ts'
import { isRecord } from '../plugin/hooks/domain/json.ts'
import {
  type Checkout,
  inspectCheckout,
  modRoots,
  type RepoFacts,
  skipsRepo,
} from './mods/inspect.ts'
import {
  CODE_QUERIES,
  createSearcher,
  RECENT_QUERIES,
  type SearchAnswer,
  type SearchKind,
  TOPIC_QUERIES,
} from './mods/search.ts'

/** awesome-claude-code-mods' candidate repositories, one `owner/repo` a line (CC0). */
export const SEEDS_URL =
  'https://raw.githubusercontent.com/karanb192/awesome-claude-code-mods/main/data/repos.txt'
const CONCURRENCY = 6
const METADATA_BATCH = 50
/** Recent repositories of the broad queries checked in one build (most are not mods: a fresh clone tells). */
const RECENT_MAX = 1000
const DAY = 24 * 60 * 60 * 1000
/** Past this share of the last index's mods lost, nothing is written. */
export const MAX_DROP = 0.2
/** About 2% of mods fail validate; past this share the build's own reading broke. */
export const MAX_FAILED = 0.25

/** What GitHub's GraphQL API says of a repository; undefined when it is gone or private. */
export type RepoMeta = RepoFacts & {
  /** As GitHub spells it now (a renamed repository answers to its old name). */
  readonly repo: string
  readonly archived: boolean
  /** The repository it was forked from. */
  readonly parent?: string
}

export type ModsDeps = {
  readonly search: (kind: SearchKind, query: string, page: number) => Promise<SearchAnswer>
  /** A GraphQL query's `data`, or undefined when it failed. */
  readonly graphql: (query: string) => Promise<unknown>
  /** A public file's text, or undefined. */
  readonly fetchText: (url: string) => Promise<string | undefined>
  /** The mods a repository holds, or undefined when it couldn't be read this time. */
  readonly inspect: (repo: string, facts: RepoFacts) => Promise<CommunityMod[] | undefined>
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
  readonly log: (line: string) => void
}

export type Built = { readonly text: string } | { readonly refused: string }

const key = (repo: string): string => repo.toLowerCase()

export const parseRepoList = (text: string): string[] =>
  text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#') && isRepo(line))

const FIELDS =
  'nameWithOwner stargazerCount pushedAt description isArchived isPrivate parent { nameWithOwner }'

export const metadataQuery = (repos: readonly string[]): string =>
  `query { ${repos
    .map((repo, i) => {
      const [owner, name] = repo.split('/')
      return `r${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${FIELDS} }`
    })
    .join(' ')} }`

export const toMeta = (node: unknown): RepoMeta | undefined => {
  if (!isRecord(node) || node.isPrivate === true) return undefined
  const { nameWithOwner, stargazerCount, pushedAt, description, isArchived, parent } = node
  if (!isRepo(nameWithOwner) || typeof stargazerCount !== 'number') return undefined
  const pushed = typeof pushedAt === 'string' ? Date.parse(pushedAt) : Number.NaN
  const from = isRecord(parent) && isRepo(parent.nameWithOwner) ? parent.nameWithOwner : undefined
  return {
    repo: nameWithOwner,
    stars: Math.max(0, Math.floor(stargazerCount)),
    pushed: Number.isFinite(pushed) ? pushed : 0,
    description: typeof description === 'string' ? description : '',
    archived: isArchived === true,
    ...(from === undefined ? {} : { parent: from }),
  }
}

/** Runs `work` over `items`, `limit` at a time. */
const pool = async <T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>) => {
  const queue = [...items]
  const worker = async (): Promise<void> => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item)
  }
  await Promise.all(Array.from({ length: limit }, worker))
}

export const buildMods = async (deps: ModsDeps): Promise<Built> => {
  const started = deps.now()
  const previousText = await deps.fetchText(COMMUNITY_URL)
  const previousParsed = previousText === undefined ? undefined : parseCommunity(previousText)
  const previous = previousParsed?.ok ? previousParsed.value : undefined
  if (previousText !== undefined && !previous) deps.log('the published index is unreadable')
  const seeds = parseRepoList((await deps.fetchText(SEEDS_URL)) ?? '')

  // Search: a query that fails is logged and the build goes on with what it has.
  const searcher = createSearcher({ search: deps.search, sleep: deps.sleep, log: deps.log })
  const found: string[] = []
  const run = async (label: string, search: () => Promise<string[]>) => {
    try {
      const repos = await search()
      found.push(...repos)
      deps.log(`${label}: ${new Set(repos.map(key)).size} repositories`)
    } catch (error) {
      deps.log(`${label}: failed (${String(error instanceof Error ? error.message : error)})`)
    }
  }
  for (const query of CODE_QUERIES) await run(query, () => searcher.code(query))
  for (const query of TOPIC_QUERIES) await run(query, () => searcher.repositories(query))
  const window = { from: (previous?.at ?? deps.now() - 7 * DAY) - 2 * DAY, to: deps.now() }
  const recent: string[] = []
  for (const query of RECENT_QUERIES) {
    await run(`${query} (recent)`, async () => {
      const repos = await searcher.repositories(query, window)
      recent.push(...repos)
      return repos
    })
  }

  const candidates = new Map<string, string>()
  const add = (repos: readonly string[]) => {
    for (const repo of repos)
      if (isRepo(repo) && !candidates.has(key(repo))) candidates.set(key(repo), repo)
  }
  add((previous?.mods ?? []).map(mod => mod.repo))
  add(seeds)
  add(found.filter(repo => !recent.includes(repo)))
  add([...new Set(recent)].slice(0, RECENT_MAX))

  // Metadata in batches; a repository GitHub no longer serves publicly is dropped.
  const metas = new Map<string, RepoMeta>()
  const names = [...candidates.values()]
  for (let i = 0; i < names.length; i += METADATA_BATCH) {
    const chunk = names.slice(i, i + METADATA_BATCH)
    const data = await deps.graphql(metadataQuery(chunk))
    chunk.forEach((repo, j) => {
      const meta = toMeta(isRecord(data) ? data[`r${j}`] : undefined)
      if (meta !== undefined) metas.set(key(repo), meta)
    })
  }
  // A fork of another candidate copies its mods: the original counts.
  const repos = new Map<string, RepoMeta>()
  for (const meta of metas.values()) {
    if (meta.archived || skipsRepo(meta.repo)) continue
    if (meta.parent !== undefined && candidates.has(key(meta.parent))) continue
    repos.set(key(meta.repo), meta)
  }

  deps.log(`reading ${repos.size} of ${candidates.size} candidates`)
  const kept = new Map<string, CommunityMod[]>()
  for (const mod of previous?.mods ?? [])
    kept.set(key(mod.repo), [...(kept.get(key(mod.repo)) ?? []), mod])
  const mods: CommunityMod[] = []
  let unread = 0
  let done = 0
  await pool([...repos.values()], CONCURRENCY, async meta => {
    const read = await deps.inspect(meta.repo, meta)
    done += 1
    if (done % 200 === 0) deps.log(`read ${done} of ${repos.size}, ${mods.length} mods so far`)
    if (read !== undefined) {
      mods.push(...read)
      return
    }
    unread += 1
    // The last index's word for it, with today's stars.
    const last = kept.get(key(meta.repo)) ?? []
    mods.push(
      ...last.map(mod => ({ ...mod, repo: meta.repo, stars: meta.stars, pushed: meta.pushed })),
    )
  })

  const text = communityText(deps.now(), mods)
  const checks: Record<string, number> = {}
  for (const mod of mods) checks[mod.check] = (checks[mod.check] ?? 0) + 1
  deps.log(
    [
      `candidates ${candidates.size} (seeds ${seeds.length}, last index ${new Set((previous?.mods ?? []).map(m => key(m.repo))).size}), public ${repos.size}`,
      `mods ${mods.length} in ${new Set(mods.map(mod => key(mod.repo))).size} repositories; ${mods.filter(mod => mod.market).length} installable by marketplace; unread ${unread}`,
      `checks ${JSON.stringify(checks)}`,
      `search requests ${searcher.requests()}, ${((deps.now() - started) / 1000).toFixed(0)} s`,
      `size ${text.length} B (${gzipSync(text).length} B gzipped)`,
    ].join('\n'),
  )
  if (mods.length === 0) return { refused: 'no mods found: nothing written' }
  if ((checks.failed ?? 0) > mods.length * MAX_FAILED) {
    return { refused: `${checks.failed} of ${mods.length} mods fail validate: nothing written` }
  }
  const before = previous?.mods.length ?? 0
  if (mods.length < before * (1 - MAX_DROP)) {
    return { refused: `${mods.length} mods against ${before} last time: nothing written` }
  }
  // What clients would refuse is never published.
  const check = parseCommunity(text)
  if (!check.ok) return { refused: `the index would be refused: ${check.error.message}` }
  return { text }
}

// The real network, git and CLI.

const GITHUB_API = 'https://api.github.com/'
const TIMEOUT_MS = 60_000
const READ_MAX = 1024 * 1024

const githubHeaders = (token: string): Record<string, string> => ({
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'modmgr-index',
})

const githubSearch =
  (token: string) =>
  async (kind: SearchKind, query: string, page: number): Promise<SearchAnswer> => {
    const url = `${GITHUB_API}search/${kind}?${new URLSearchParams({ q: query, per_page: '100', page: String(page) })}`
    try {
      const response = await fetch(url, {
        headers: githubHeaders(token),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      const body: unknown = await response.json().catch(() => undefined)
      if (!response.ok || !isRecord(body) || !Array.isArray(body.items)) {
        const retryAfter = Number(response.headers.get('retry-after'))
        const reset = Number(response.headers.get('x-ratelimit-reset'))
        const waitSeconds =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter
            : response.headers.get('x-ratelimit-remaining') === '0' && Number.isFinite(reset)
              ? Math.max(0, reset - Date.now() / 1000)
              : undefined
        const message =
          isRecord(body) && typeof body.message === 'string' ? body.message : 'no results'
        return {
          status: response.status,
          message,
          ...(waitSeconds === undefined ? {} : { waitSeconds }),
        }
      }
      const repos = body.items.flatMap(item => {
        const repository = isRecord(item) && kind === 'code' ? item.repository : item
        return isRecord(repository) && typeof repository.full_name === 'string'
          ? [repository.full_name]
          : []
      })
      return {
        page: {
          total: typeof body.total_count === 'number' ? body.total_count : 0,
          incomplete: body.incomplete_results === true,
          repos,
        },
      }
    } catch (error) {
      return { status: 503, message: String(error) }
    }
  }

const githubGraphql =
  (token: string) =>
  async (query: string): Promise<unknown> => {
    try {
      const response = await fetch(`${GITHUB_API}graphql`, {
        method: 'POST',
        headers: githubHeaders(token),
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      const body: unknown = await response.json().catch(() => undefined)
      // A batch naming a missing repository still answers the others.
      return isRecord(body) ? body.data : undefined
    } catch {
      return undefined
    }
  }

const fetchText = async (url: string): Promise<string | undefined> => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok) return undefined
    const text = await response.text()
    return text.length > COMMUNITY_MAX_BYTES ? undefined : text
  } catch {
    return undefined
  }
}

type Ran = { readonly code: number; readonly stdout: string; readonly stderr: string }

const runChild = (
  command: string,
  args: readonly string[],
  options: { cwd?: string; env: NodeJS.ProcessEnv; timeout: number },
): Promise<Ran> =>
  new Promise(resolve => {
    execFile(
      command,
      args,
      { ...options, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, killSignal: 'SIGKILL' },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1
        resolve({ code, stdout, stderr })
      },
    )
  })

/** A shallow clone, read and validated; undefined when git couldn't fetch it. */
export const inspectRepo =
  (work: string, env: NodeJS.ProcessEnv) =>
  async (repo: string, facts: RepoFacts): Promise<CommunityMod[] | undefined> => {
    const dir = mkdtempSync(join(work, 'repo-'))
    const git = (args: readonly string[], timeout = 180_000) =>
      runChild('git', ['-C', dir, ...args], { env, timeout })
    try {
      const clone = await runChild(
        'git',
        [
          'clone',
          '-q',
          '--depth',
          '1',
          '--filter=blob:none',
          '--no-checkout',
          '-c',
          'core.symlinks=false',
          `https://github.com/${repo}.git`,
          dir,
        ],
        { env, timeout: 180_000 },
      )
      if (clone.code !== 0) return undefined
      const head = await git(['rev-parse', 'HEAD'])
      const commit = head.stdout.trim()
      if (head.code !== 0 || !/^[0-9a-f]{40}$/.test(commit)) return []
      const files = (await git(['ls-tree', '-r', '-z', '--name-only', 'HEAD'])).stdout
        .split('\0')
        .filter(Boolean)
      // Read the hooks files from git first: most candidates hold no mod and are never checked out.
      const blobs = new Map<string, string>()
      for (const file of files.filter(path => path.endsWith('hooks/hooks.json')).slice(0, 200)) {
        const shown = await git(['show', `HEAD:${file}`])
        if (shown.code === 0) blobs.set(file, shown.stdout)
      }
      if (modRoots({ files, read: path => blobs.get(path) }).length === 0) return []
      if ((await git(['checkout', '-q', 'HEAD'], 300_000)).code !== 0) return undefined
      const checkout: Checkout = {
        repo,
        commit,
        files,
        read: path => {
          try {
            const full = join(dir, path)
            const stat = statSync(full)
            return stat.isFile() && stat.size <= READ_MAX ? readFileSync(full, 'utf8') : undefined
          } catch {
            return undefined
          }
        },
        validate: async path => {
          const ran = await runChild('claude', ['plugin', 'validate', '--json', path], {
            cwd: dir,
            env,
            timeout: 60_000,
          })
          return { exitCode: ran.code, stdout: ran.stdout, stderr: ran.stderr }
        },
      }
      // Awaited here: the finally below removes the checkout validate reads.
      return await inspectCheckout(checkout, facts)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

if (import.meta.main) {
  const out = process.argv[2]
  const token = process.env.GITHUB_TOKEN
  if (out === undefined || token === undefined || token === '') {
    console.error('usage: GITHUB_TOKEN=… node scripts/build-mods.ts <out.json>')
    process.exit(2)
  }
  const work = mkdtempSync(join(tmpdir(), 'modmgr-mods-'))
  const config = mkdtempSync(join(tmpdir(), 'modmgr-mods-config-'))
  // git and the CLI never see the token, and nothing prompts.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_CONFIG_DIR: config,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_LFS_SKIP_SMUDGE: '1',
  }
  delete env.GITHUB_TOKEN
  delete env.GH_TOKEN
  delete env.CLAUDECODE
  try {
    const built = await buildMods({
      search: githubSearch(token),
      graphql: githubGraphql(token),
      fetchText,
      inspect: inspectRepo(work, env),
      now: Date.now,
      sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
      log: line => console.error(line),
    })
    if ('refused' in built) {
      console.error(built.refused)
      process.exitCode = 1
    } else {
      writeFileSync(out, built.text)
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
    rmSync(config, { recursive: true, force: true })
  }
}
