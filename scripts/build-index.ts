// Builds the hosted catalogue index (plugin/hooks/domain/catalog-index.ts):
// every entry of the official catalogues, classified with the detector's own
// decisions (planProbe, walkProbe, probeKey), written as `{ v, at, entries }`.
// It reads the catalogues with the CLI on a throwaway CLAUDE_CONFIG_DIR, the
// way modmgr does, and fetches from raw.githubusercontent.com politely: a few
// at a time, every request paused after a 429/403/5xx. It refuses to write a
// file when too much was left unclassified, so a bad run can't replace a good
// index. CI (.github/workflows/index.yml) runs it daily.
//
//   node scripts/build-index.ts <out.json>
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import type { CatalogKind } from '../plugin/hooks/domain/catalog.ts'
import { indexText, parseIndex } from '../plugin/hooks/domain/catalog-index.ts'
import {
  type CatalogEntry,
  type CliRun,
  parseAvailable,
  parseMarketplaces,
} from '../plugin/hooks/domain/cli-results.ts'
import {
  backoffMs,
  type FetchedFile,
  localBase,
  MAX_BODY,
  planProbe,
  probeKey,
  walkProbe,
} from '../plugin/hooks/domain/detector.ts'
import { parsePluginId } from '../plugin/hooks/domain/ids.ts'
import type { DetectEntry } from '../plugin/hooks/domain/store-schema.ts'

/** The marketplaces the index covers: what a fresh config lists, and the official one. */
const MARKETPLACES = ['anthropics/claude-plugins-official']
const CONCURRENCY = 8
const RETRIES = 5
const TIMEOUT_MS = 30_000
/** Past this share of checkable entries left unclassified, nothing is written. */
const MAX_MISSING = 0.05

const out = process.argv[2]
if (out === undefined) {
  console.error('usage: node scripts/build-index.ts <out.json>')
  process.exit(2)
}

const config = mkdtempSync(join(tmpdir(), 'modmgr-index-'))
const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CONFIG_DIR: config }
delete env.CLAUDECODE

const cli = (args: string[]): CliRun => {
  const run = spawnSync('claude', args, { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return { exitCode: run.status ?? 1, stdout: run.stdout ?? '', stderr: run.stderr ?? '' }
}

const started = Date.now()
let entries: CatalogEntry[]
let roots: Map<string, string>
try {
  for (const source of MARKETPLACES) {
    const added = cli(['plugin', 'marketplace', 'add', source])
    if (added.exitCode !== 0) throw new Error(`marketplace add ${source}: ${added.stderr.trim()}`)
  }
  const available = parseAvailable(cli(['plugin', 'list', '--json', '--available']))
  if (!available.ok) throw new Error(`list --available: ${available.error.message}`)
  const listed = parseMarketplaces(cli(['plugin', 'marketplace', 'list', '--json']))
  if (!listed.ok) throw new Error(`marketplace list: ${listed.error.message}`)
  entries = available.value.available.items
  roots = new Map(
    listed.value.items.flatMap(item =>
      item.installLocation === undefined ? [] : [[item.name, item.installLocation] as const],
    ),
  )
} catch (error) {
  rmSync(config, { recursive: true, force: true })
  throw error
}

const fetchRemote = async (url: string): Promise<FetchedFile> => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    const text = await response.text()
    return text.length > MAX_BODY ? { status: response.status } : { status: response.status, text }
  } catch {
    return { status: 503 }
  }
}

const readLocal = async (path: string): Promise<FetchedFile> => {
  try {
    return { status: 200, text: readFileSync(path, 'utf8') }
  } catch {
    return { status: 404 }
  }
}

type Work = { readonly entry: CatalogEntry; readonly key: string; attempt: number }
const queue: Work[] = []
for (const entry of entries) {
  // The client rejects a file with an id it can't read: such an entry is left out.
  if (!parsePluginId(entry.id).ok) continue
  const key = probeKey(planProbe(entry), entry.version)
  if (key !== undefined) queue.push({ entry, key, attempt: 0 })
}
const checkable = queue.length
const found = new Map<string, DetectEntry>()
let pausedUntil = 0
let requests = 0

const classify = async (work: Work): Promise<CatalogKind | 'retry' | undefined> => {
  const plan = planProbe(work.entry)
  if (plan.kind === 'remote') {
    return walkProbe(plan.base, true, url => {
      requests += 1
      return fetchRemote(url)
    })
  }
  if (plan.kind !== 'local') return undefined
  const base = localBase(roots.get(work.entry.marketplace), plan.path)
  return base === undefined ? undefined : walkProbe(base, false, readLocal)
}

const worker = async (): Promise<void> => {
  for (let work = queue.shift(); work !== undefined; work = queue.shift()) {
    const wait = pausedUntil - Date.now()
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
    const kind = await classify(work)
    if (kind === 'retry') {
      work.attempt += 1
      pausedUntil = Date.now() + backoffMs(work.attempt)
      if (work.attempt <= RETRIES) queue.push(work)
      continue
    }
    if (kind !== undefined) found.set(work.entry.id, [work.key, kind])
  }
}

try {
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
} finally {
  rmSync(config, { recursive: true, force: true })
}

const missing = checkable - found.size
const counts: Record<string, number> = {}
for (const [, kind] of found.values()) counts[kind] = (counts[kind] ?? 0) + 1
const text = indexText(Date.now(), found)
console.error(
  [
    `entries ${entries.length}, checkable ${checkable}, classified ${found.size}, missing ${missing}`,
    `kinds ${JSON.stringify(counts)}`,
    `requests ${requests}, ${((Date.now() - started) / 1000).toFixed(0)} s`,
    `size ${text.length} B (${gzipSync(text).length} B gzipped)`,
  ].join('\n'),
)
if (checkable === 0 || missing / checkable > MAX_MISSING) {
  console.error(`too much left unclassified (${missing} of ${checkable}): nothing written`)
  process.exit(1)
}
// What clients would refuse is never published.
const check = parseIndex(text)
if (!check.ok) {
  console.error(`the index would be refused: ${check.error.message}`)
  process.exit(1)
}
writeFileSync(out, text)
