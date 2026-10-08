// The mod detector (PLAN §2.3, R14): finds which catalogue entries are mods
// without installing them. A remote entry is probed at its pinned commit on
// raw.githubusercontent.com; a local one (a folder inside its marketplace's
// clone or folder) is read from disk. Decisions are domain/detector.ts's; this
// runs them: first what the hosted index knows (one request), then the rest,
// the entries Discover shows first, six at a time, at most 600 network
// requests per session, only while no turn runs, backing off on 429/5xx, and
// writing the cache in batches of 50. The index and network probes are off
// under CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC or `detectRemote: false`;
// local reads stay on (no network).

import type { CatalogKind } from '../../types/index.d.ts'
import type { CatalogEntry } from '../domain/cli-results.ts'
import {
  backoffMs,
  type FetchedFile,
  localBase,
  MAX_BODY,
  planProbe,
  probeKey,
  walkProbe,
} from '../domain/detector.ts'
import { lruSetMany } from '../domain/lru.ts'
import { CAPS, type DetectEntry } from '../domain/store-schema.ts'
import type { Ports } from '../ports.ts'
import type { Catalog } from './catalog.ts'
import type { IndexSync } from './catalog-index.ts'
import type { StoreService } from './store.ts'

export const DETECT_CONCURRENCY = 6
/**
 * Network requests per session, about (PLAN §2.3: ≈ 50 s of idle probing, F28):
 * six workers check it before each entry, so the last few may overshoot by five.
 */
export const DETECT_BUDGET = 600
/** Results gathered before one cache write (each store write rewrites the file, F16). */
export const DETECT_FLUSH = 50
/** Tries of one entry after its first 429/403/5xx before it waits for the next session. */
export const DETECT_RETRIES = 3

export type DetectorPorts = Pick<Ports, 'http' | 'fs' | 'state' | 'clock'>

export type Detector = {
  /** Probes what the catalogue has that the cache doesn't know (no-op while running). */
  start(): void
  /** A turn started or ended: probing pauses while one runs. */
  setBusy(busy: boolean): void
  /** Resolves when the current run has finished. */
  whenIdle(): Promise<void>
  /** Network requests made this session. */
  spent(): number
  dispose(): void
}

type Work = { readonly entry: CatalogEntry; readonly key: string; attempt: number }

export const createDetector = (
  ports: DetectorPorts,
  deps: {
    readonly store: Pick<StoreService, 'get' | 'update'>
    readonly catalog: Pick<Catalog, 'entries' | 'rootOf' | 'invalidate' | 'show' | 'priority'>
    /** The hosted index: kinds for the official catalogues in one request, read before probing. */
    readonly index?: Pick<IndexSync, 'sync' | 'built'>
    /** Whether network probes may run now (config and the traffic switch). */
    readonly remoteAllowed: () => Promise<boolean>
    readonly debug?: (text: string) => void
    readonly budget?: number
  },
): Detector => {
  const debug = deps.debug ?? (() => {})
  const budget = deps.budget ?? DETECT_BUDGET
  let requests = 0
  let busy = false
  let disposed = false
  let running: Promise<void> | undefined
  // Asked to start while running: go again over what the catalogue lists then (R-M4-6).
  let restart = false
  let pausedUntil = 0
  let waiters: Array<() => void> = []
  let pending = new Map<string, DetectEntry>()

  const sleep = (ms: number): Promise<void> =>
    new Promise(resolve => {
      ports.clock.after(ms, resolve)
    })

  /** Waits while a turn runs. */
  const idle = async (): Promise<void> => {
    while (busy && !disposed) await new Promise<void>(resolve => waiters.push(resolve))
  }

  const progress = async (running: boolean): Promise<void> => {
    const entries = deps.catalog.entries()
    const cache = deps.store.get('detect')
    let checked = 0
    let found = 0
    // Only entries that can be checked count: a command source or an unpinned
    // repository never can, so "checked n/total" can reach its total (R-M4-6).
    let total = 0
    for (const entry of entries) {
      const key = probeKey(planProbe(entry), entry.version)
      if (key === undefined) continue
      total += 1
      const cached = cache[entry.id]
      if (cached === undefined || cached[0] !== key) continue
      checked += 1
      if (cached[1] === 'mod') found += 1
    }
    const indexAt = deps.index?.built()
    await ports.state.update('detect', () => ({
      checked,
      total,
      found,
      running,
      ...(indexAt === undefined ? {} : { indexAt }),
    }))
  }

  const flush = async (): Promise<void> => {
    if (pending.size === 0) return
    const results = [...pending.entries()]
    pending = new Map()
    deps.store.update('detect', cache => lruSetMany(cache, results, CAPS.detect))
    deps.catalog.invalidate()
    await deps.catalog.show()
    await progress(true)
  }

  /** One file: a remote GET (counted against the budget) or a local read. */
  const fetchFile = async (location: string, remote: boolean): Promise<FetchedFile> => {
    if (remote) {
      requests += 1
      try {
        const response = await ports.http.get(location)
        // The body is read whole by the host; anything past the cap is not parsed.
        return response.text.length > MAX_BODY
          ? { status: response.status }
          : { status: response.status, text: response.text }
      } catch (error) {
        debug(`modmgr: probe ${location} failed: ${String(error)}`)
        return { status: 503 }
      }
    }
    try {
      return { status: 200, text: await ports.fs.read(location) }
    } catch {
      return { status: 404 }
    }
  }

  /** The kind of one entry, `retry` when the host asked to slow down, or undefined to skip it. */
  const probe = async (
    work: Work,
    remoteOk: boolean,
  ): Promise<CatalogKind | 'retry' | undefined> => {
    const plan = planProbe(work.entry)
    const remote = plan.kind === 'remote'
    const base =
      plan.kind === 'remote'
        ? plan.base
        : plan.kind === 'local'
          ? localBase(deps.catalog.rootOf(work.entry.marketplace), plan.path)
          : undefined
    if (base === undefined || (remote && !remoteOk)) return undefined
    return walkProbe(
      base,
      remote,
      location => fetchFile(location, remote),
      () => requests < budget,
    )
  }

  const run = async (): Promise<void> => {
    do {
      restart = false
      await runOnce()
    } while (restart && !disposed)
  }

  const runOnce = async (): Promise<void> => {
    const remoteOk = await deps.remoteAllowed()
    // What the index already knows is not probed.
    if (remoteOk && deps.index !== undefined) {
      const merged = await deps.index.sync(deps.catalog.entries())
      if (merged > 0) {
        deps.catalog.invalidate()
        await deps.catalog.show()
      }
    }
    const cache = deps.store.get('detect')
    // Pending work by id, and the catalogue's order (most installed first) to fall back on.
    const pendingWork = new Map<string, Work>()
    const queue: Work[] = []
    for (const entry of deps.catalog.entries()) {
      const plan = planProbe(entry)
      const key = probeKey(plan, entry.version)
      if (key === undefined || cache[entry.id]?.[0] === key) continue
      if (plan.kind === 'remote' && !remoteOk) continue
      const work = { entry, key, attempt: 0 }
      pendingWork.set(entry.id, work)
      queue.push(work)
    }
    await progress(pendingWork.size > 0)
    if (pendingWork.size === 0) return
    /** What the person is looking at first, then the catalogue's order. */
    const take = (): Work | undefined => {
      for (const id of deps.catalog.priority()) {
        const work = pendingWork.get(id)
        if (work === undefined) continue
        pendingWork.delete(id)
        return work
      }
      for (let work = queue.shift(); work !== undefined; work = queue.shift()) {
        if (pendingWork.get(work.entry.id) !== work) continue
        pendingWork.delete(work.entry.id)
        return work
      }
      return undefined
    }
    const putBack = (work: Work): void => {
      pendingWork.set(work.entry.id, work)
      queue.push(work)
    }
    const worker = async (): Promise<void> => {
      for (;;) {
        await idle()
        const wait = pausedUntil - (await ports.clock.now())
        if (wait > 0) await sleep(wait)
        if (disposed) return
        const work = take()
        if (work === undefined) return
        const remote = planProbe(work.entry).kind === 'remote'
        if (remote && requests >= budget) continue
        const kind = await probe(work, remoteOk)
        if (kind === 'retry') {
          work.attempt += 1
          pausedUntil = (await ports.clock.now()) + backoffMs(work.attempt)
          if (work.attempt <= DETECT_RETRIES) putBack(work)
          continue
        }
        if (kind === undefined) continue
        pending.set(work.entry.id, [work.key, kind])
        if (pending.size >= DETECT_FLUSH) await flush()
      }
    }
    await Promise.all(Array.from({ length: DETECT_CONCURRENCY }, worker))
    await flush()
    await progress(false)
  }

  return {
    start() {
      if (disposed) return
      if (running !== undefined) {
        restart = true
        return
      }
      running = run()
        .catch(error => {
          debug(`modmgr: detector stopped: ${String(error)}`)
        })
        .finally(() => {
          running = undefined
        })
    },
    setBusy(value) {
      busy = value
      if (!busy) {
        const woken = waiters
        waiters = []
        for (const wake of woken) wake()
      }
    },
    whenIdle: () => running ?? Promise.resolve(),
    spent: () => requests,
    dispose() {
      disposed = true
      busy = false
      const woken = waiters
      waiters = []
      for (const wake of woken) wake()
    },
  }
}
