// The mod detector: turns a catalogue entry's source into a
// probe plan, and the fetched files into a kind. Fetching, budgets and caching
// live in services/detector.ts; every decision lives here.

import type { CatalogKind } from '../../types/index.d.ts'
import type { CatalogEntry } from './cli-results.ts'
import { isRecord, parseJson } from './json.ts'

export const RAW_ORIGIN = 'https://raw.githubusercontent.com/'
/** `$.http.fetch` reads the whole body, so this cap is checked after the read. */
export const MAX_BODY = 64 * 1024

export type ProbePlan =
  | {
      readonly kind: 'remote'
      /** The commit the catalogue pins; the cache is keyed by it. */
      readonly sha: string
      /** `https://raw.githubusercontent.com/<owner>/<repo>/<sha>/<path>/`, ending in `/`. */
      readonly base: string
    }
  | {
      readonly kind: 'local'
      /** Relative to the marketplace's folder, `/`-joined, no `.` or `..` segment. */
      readonly path: string
    }
  | { readonly kind: 'unknown'; readonly reason: string }

const SEGMENT = /^[A-Za-z0-9_.-]+$/
const SHA = /^[0-9a-f]{40}$/

/** `https://github.com/<owner>/<repo>[.git]` → `[owner, repo]`. */
export const githubRepo = (url: string): [string, string] | undefined => {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url)
  const owner = match?.[1]
  const repo = match?.[2]
  if (owner === undefined || repo === undefined) return undefined
  if (!isSafeSegment(owner) || !isSafeSegment(repo)) return undefined
  return [owner, repo]
}

const isSafeSegment = (segment: string): boolean =>
  SEGMENT.test(segment) && segment !== '.' && segment !== '..'

/**
 * Splits a repository-relative path into URL-encoded segments, or `undefined`
 * when it is absolute, empty-segmented or climbs (`..`).
 */
export const safeSegments = (path: string): string[] | undefined => {
  const trimmed = path.replace(/^\.\//, '').replace(/\/+$/, '')
  if (trimmed === '' || trimmed === '.') return []
  if (trimmed.startsWith('/') || /[\0\r\n\\]/.test(trimmed)) return undefined
  const segments = trimmed.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..'))
    return undefined
  return segments.map(encodeURIComponent)
}

const remote = (
  owner: string,
  repo: string,
  sha: string,
  segments: readonly string[],
): ProbePlan => ({
  kind: 'remote',
  sha,
  base: `${RAW_ORIGIN}${owner}/${repo}/${sha}/${segments.map(s => `${s}/`).join('')}`,
})

export const planProbe = (entry: Pick<CatalogEntry, 'source'>): ProbePlan => {
  const source = entry.source
  switch (source.kind) {
    case 'relative': {
      const segments = safeSegments(source.path)
      return segments === undefined
        ? { kind: 'unknown', reason: 'unsafe relative path' }
        : { kind: 'local', path: segments.map(decodeURIComponent).join('/') }
    }
    case 'url':
    case 'git-subdir': {
      const repo = githubRepo(source.url)
      if (repo === undefined) return { kind: 'unknown', reason: 'not a GitHub repository' }
      if (source.sha === undefined || !SHA.test(source.sha)) {
        return { kind: 'unknown', reason: 'no pinned commit' }
      }
      const segments = source.kind === 'git-subdir' ? safeSegments(source.path) : []
      if (segments === undefined) return { kind: 'unknown', reason: 'unsafe subdirectory' }
      return remote(repo[0], repo[1], source.sha, segments)
    }
    case 'github': {
      const [owner, name, ...rest] = source.repo.split('/')
      if (owner === undefined || name === undefined || rest.length > 0) {
        return { kind: 'unknown', reason: 'malformed repo' }
      }
      if (!isSafeSegment(owner) || !isSafeSegment(name)) {
        return { kind: 'unknown', reason: 'malformed repo' }
      }
      if (source.sha === undefined || !SHA.test(source.sha)) {
        return { kind: 'unknown', reason: 'no pinned commit' }
      }
      return remote(owner, name, source.sha, [])
    }
    default:
      return { kind: 'unknown', reason: `source kind ${source.kind}` }
  }
}

export type FetchedFile = { readonly status: number; readonly text?: string }

/** What to do after a fetch: stop with a kind, fetch another file, or retry later. */
export type ProbeStep =
  | { readonly done: CatalogKind }
  | { readonly fetch: string; readonly stage: 'manifest' | 'followed' }
  | { readonly retry: 'rate-limited' | 'server' }

const retryable = (status: number): ProbeStep | undefined => {
  if (status === 429 || status === 403) return { retry: 'rate-limited' }
  if (status >= 500) return { retry: 'server' }
  return undefined
}

const body = (file: FetchedFile): unknown =>
  file.text === undefined || file.text.length > MAX_BODY ? undefined : parseJson(file.text)

/** A hooks.json: `modules` → a mod; a `hooks` table → command hooks. */
export const kindOfHooksJson = (value: unknown): CatalogKind => {
  if (!isRecord(value)) return 'unknown'
  if (Array.isArray(value.modules) && value.modules.length > 0) return 'mod'
  if (isRecord(value.hooks) || Array.isArray(value.modules)) return 'hooks'
  return 'unknown'
}

/**
 * A 200 whose body is too long or isn't JSON reads `unknown` and is cached at
 * that commit: the same files at the same commit would answer the same.
 */
export const afterHooksJson = (file: FetchedFile, plan: { base: string }): ProbeStep => {
  const retry = retryable(file.status)
  if (retry) return retry
  if (file.status === 404)
    return { fetch: `${plan.base}.claude-plugin/plugin.json`, stage: 'manifest' }
  if (file.status !== 200) return { done: 'unknown' }
  return { done: kindOfHooksJson(body(file)) }
}

/**
 * The manifest's `hooks` field: a path to a hooks file (followed once, inside
 * the plugin), an inline hooks table, or absent (plain).
 */
export const afterManifest = (file: FetchedFile, plan: { base: string }): ProbeStep => {
  const retry = retryable(file.status)
  if (retry) return retry
  if (file.status !== 200) return { done: 'unknown' }
  const manifest = body(file)
  if (!isRecord(manifest)) return { done: 'unknown' }
  const hooks = manifest.hooks
  if (hooks === undefined) return { done: 'plain' }
  if (isRecord(hooks)) return { done: kindOfHooksJson(hooks) === 'mod' ? 'mod' : 'hooks' }
  const path = typeof hooks === 'string' ? hooks : Array.isArray(hooks) ? hooks[0] : undefined
  if (typeof path !== 'string') return { done: 'hooks' }
  const segments = safeSegments(path)
  if (segments === undefined || segments.length === 0) return { done: 'hooks' }
  // A URL keeps the segments encoded; a folder on disk reads them as written.
  const local = !plan.base.startsWith(RAW_ORIGIN)
  const joined = (local ? segments.map(decodeURIComponent) : segments).join('/')
  return { fetch: `${plan.base}${joined}`, stage: 'followed' }
}

export const afterFollowed = (file: FetchedFile): ProbeStep => {
  const retry = retryable(file.status)
  if (retry) return retry
  if (file.status !== 200) return { done: 'hooks' }
  const kind = kindOfHooksJson(body(file))
  return { done: kind === 'unknown' ? 'hooks' : kind }
}

/**
 * One entry's probe from its base: hooks.json, then the manifest and the file
 * it names when needed. `fetchFile` does the I/O (a GET, or a read from disk);
 * `more` says whether another request may go out (a remote budget). The
 * detector and the index build (scripts/build-index.ts) both walk it, so the
 * two classify alike. Undefined when the budget ran out mid-walk.
 */
export const walkProbe = async (
  base: string,
  remote: boolean,
  fetchFile: (location: string) => Promise<FetchedFile>,
  more: () => boolean = () => true,
): Promise<CatalogKind | 'retry' | undefined> => {
  let step: ProbeStep = afterHooksJson(await fetchFile(`${base}hooks/hooks.json`), { base })
  for (let hops = 0; hops < 2 && 'fetch' in step; hops += 1) {
    if (remote && !more()) return undefined
    // The followed path's segments are URL-encoded; a local read wants them as named.
    const location = remote ? step.fetch : base + decodeURIComponent(step.fetch.slice(base.length))
    const file = await fetchFile(location)
    step = step.stage === 'manifest' ? afterManifest(file, { base }) : afterFollowed(file)
  }
  if ('retry' in step) return 'retry'
  return 'done' in step ? step.done : 'unknown'
}

/** Exponential backoff with a cap: attempt 1 waits 4 s, then 8 s, 16 s … 5 min. */
export const backoffMs = (attempt: number): number =>
  Math.min(300_000, 2000 * 2 ** Math.max(0, Math.min(attempt, 20)))

/**
 * What a cached kind is good for: the pinned commit of a remote source, or the
 * version of a local one (its marketplace folder or clone moves with it). A
 * cached `[key, kind]` whose key no longer matches is probed again.
 */
export const probeKey = (plan: ProbePlan, version: string | undefined): string | undefined =>
  plan.kind === 'remote' ? plan.sha : plan.kind === 'local' ? `local:${version ?? '?'}` : undefined

/**
 * A local plan's folder: its marketplace's folder joined with the checked
 * relative path, ending in `/` like a remote base. Undefined without a root.
 */
export const localBase = (root: string | undefined, path: string): string | undefined => {
  if (root === undefined || !root.startsWith('/')) return undefined
  const head = root.replace(/\/+$/, '')
  return path === '' ? `${head}/` : `${head}/${path}/`
}
