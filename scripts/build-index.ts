// Builds the hosted catalogue index (plugin/hooks/domain/catalog-index.ts):
// every remote entry of the official catalogues (a local one is read by each
// client from its own clone), classified with the detector's own decisions
// (planProbe, walkProbe, probeKey), written as `{ v, at, entries }`.
// It reads the catalogues with the CLI on a throwaway CLAUDE_CONFIG_DIR, the
// way modmgr does, and fetches from raw.githubusercontent.com politely: a few
// at a time, every request paused after a 429/403/5xx. It refuses to write a
// file when too much was left unclassified, so a bad run can't replace a good
// index. CI (.github/workflows/index.yml) runs it daily; its logic takes the
// CLI and the network as arguments, so a test runs it on fixtures.
//
//   node scripts/build-index.ts <out.json>
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import type { CatalogKind } from '../plugin/hooks/domain/catalog.ts'
import { indexText, parseIndex } from '../plugin/hooks/domain/catalog-index.ts'
import {
  type CatalogEntry,
  type CliRun,
  parseAvailable,
} from '../plugin/hooks/domain/cli-results.ts'
import {
  backoffMs,
  type FetchedFile,
  MAX_BODY,
  planProbe,
  probeKey,
  walkProbe,
} from '../plugin/hooks/domain/detector.ts'
import { parsePluginId } from '../plugin/hooks/domain/ids.ts'
import type { DetectEntry } from '../plugin/hooks/domain/store-schema.ts'

/** The marketplaces the index covers: what a fresh config lists, and the official one. */
export const MARKETPLACES = ['anthropics/claude-plugins-official']
const CONCURRENCY = 8
const RETRIES = 5
const TIMEOUT_MS = 30_000
/** Past this share of checkable entries left unclassified, nothing is written. */
export const MAX_MISSING = 0.05

export type BuildDeps = {
  /** `claude` on a throwaway config dir. */
  readonly cli: (args: readonly string[]) => CliRun
  /** A GET of a catalogue file, its size limited (`fetchFile`). */
  readonly fetch: (url: string) => Promise<FetchedFile>
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
  readonly log: (line: string) => void
}

/** The file to publish, or why there is none. */
export type Built = { readonly text: string } | { readonly refused: string }

/** A GET for at most MAX_BODY bytes (a Range request); a range answered (206) reads as 200. */
export const fetchFile = async (url: string): Promise<FetchedFile> => {
  try {
    const response = await fetch(url, {
      headers: { Range: `bytes=0-${MAX_BODY}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    // An empty file can't satisfy a range (416).
    const text = response.status === 416 ? '' : await response.text()
    const status = response.status === 206 || response.status === 416 ? 200 : response.status
    return text.length > MAX_BODY ? { status } : { status, text }
  } catch {
    return { status: 503 }
  }
}

type Work = { readonly entry: CatalogEntry; readonly key: string; attempt: number }

export const buildIndex = async (deps: BuildDeps): Promise<Built> => {
  const started = deps.now()
  for (const source of MARKETPLACES) {
    const added = deps.cli(['plugin', 'marketplace', 'add', source])
    if (added.exitCode !== 0) throw new Error(`marketplace add ${source}: ${added.stderr.trim()}`)
  }
  const available = parseAvailable(deps.cli(['plugin', 'list', '--json', '--available']))
  if (!available.ok) throw new Error(`list --available: ${available.error.message}`)
  const entries = available.value.available.items

  const queue: Work[] = []
  for (const entry of entries) {
    // The client rejects a file with an id it can't read: such an entry is left out.
    if (!parsePluginId(entry.id).ok) continue
    // Clients read a local entry from their own clone, for free: only remote ones are published.
    const plan = planProbe(entry)
    const key = probeKey(plan, entry.version)
    if (plan.kind === 'remote' && key !== undefined) queue.push({ entry, key, attempt: 0 })
  }
  const checkable = queue.length
  const found = new Map<string, DetectEntry>()
  let pausedUntil = 0
  let requests = 0

  const classify = async (work: Work): Promise<CatalogKind | 'retry' | undefined> => {
    const plan = planProbe(work.entry)
    if (plan.kind !== 'remote') return undefined
    return walkProbe(plan.base, true, url => {
      requests += 1
      return deps.fetch(url)
    })
  }

  const worker = async (): Promise<void> => {
    for (let work = queue.shift(); work !== undefined; work = queue.shift()) {
      const wait = pausedUntil - deps.now()
      if (wait > 0) await deps.sleep(wait)
      const kind = await classify(work)
      if (kind === 'retry') {
        work.attempt += 1
        pausedUntil = deps.now() + backoffMs(work.attempt)
        if (work.attempt <= RETRIES) queue.push(work)
        continue
      }
      // `unknown` isn't published (clients don't take it): it counts as missing.
      if (kind !== undefined && kind !== 'unknown') found.set(work.entry.id, [work.key, kind])
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  const missing = checkable - found.size
  const counts: Record<string, number> = {}
  for (const [, kind] of found.values()) counts[kind] = (counts[kind] ?? 0) + 1
  const text = indexText(deps.now(), found)
  deps.log(
    [
      `entries ${entries.length}, checkable ${checkable}, classified ${found.size}, missing ${missing}`,
      `kinds ${JSON.stringify(counts)}`,
      `requests ${requests}, ${((deps.now() - started) / 1000).toFixed(0)} s`,
      `size ${text.length} B (${gzipSync(text).length} B gzipped)`,
    ].join('\n'),
  )
  if (checkable === 0 || missing / checkable > MAX_MISSING) {
    return { refused: `too much left unclassified (${missing} of ${checkable}): nothing written` }
  }
  // What clients would refuse is never published.
  const check = parseIndex(text)
  if (!check.ok) return { refused: `the index would be refused: ${check.error.message}` }
  return { text }
}

if (import.meta.main) {
  const out = process.argv[2]
  if (out === undefined) {
    console.error('usage: node scripts/build-index.ts <out.json>')
    process.exit(2)
  }
  const config = mkdtempSync(join(tmpdir(), 'modmgr-index-'))
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CONFIG_DIR: config }
  delete env.CLAUDECODE
  try {
    const built = await buildIndex({
      cli: args => {
        const run = spawnSync('claude', args, {
          env,
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        })
        return { exitCode: run.status ?? 1, stdout: run.stdout ?? '', stderr: run.stderr ?? '' }
      },
      fetch: fetchFile,
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
    rmSync(config, { recursive: true, force: true })
  }
}
