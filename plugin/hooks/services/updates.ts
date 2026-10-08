// The update scheduler: every `updateCheckHours` (from the
// store's last check, so across sessions too), while no turn runs and traffic
// is allowed, it queues `claude plugin marketplace update <name>` for each
// marketplace an installed mod comes from (the queue serialises it with other
// CLI writes and the status line says it). When a refresh ends, `check()`
// reads those marketplaces' files and records what can update; the registry
// draws it (`↑`, `attention.updates`). A reload of modmgr builds a new
// scheduler, which re-arms from the stored time.

import { parseMarketplaces } from '../domain/cli-results.ts'
import { joinPath, manifestOf, marketplaceFolderOf } from '../domain/dev.ts'
import { parseMarketplaceName, splitPluginId } from '../domain/ids.ts'
import { isActive, type JobSpec } from '../domain/jobs.ts'
import { originOf } from '../domain/mods.ts'
import {
  foundUpdates,
  type ListedEntry,
  marketplaceEntriesOf,
  nextCheckIn,
} from '../domain/updates.ts'
import type { Ports } from '../ports.ts'
import { runCli } from './cli.ts'
import { enqueue } from './job-runner.ts'
import type { Registry } from './registry.ts'
import type { StoreService } from './store.ts'

export type UpdatesPorts = Pick<Ports, 'state' | 'fs' | 'clock' | 'process' | 'session'>

/** A first check waits this long after start-up, off the session's busiest moment. */
export const FIRST_CHECK_DELAY_MS = 60_000
/** A check due while a turn runs is tried again this much later. */
export const BUSY_RETRY_MS = 60_000

export type Updater = {
  /** Schedules the next check from the last one's time (again after a reload of modmgr). */
  arm(): Promise<void>
  /** Queues the marketplace refreshes now, when allowed; the scheduled tick and Health's "check now". */
  run(): Promise<'queued' | 'busy' | 'off' | 'nothing'>
  /** Reads the marketplaces' files and records what can update (no network). */
  check(): Promise<void>
  /** Forgets what a check found for `id`: the CLI found it up to date. */
  forget(id: string): void
  dispose(): void
}

export type UpdaterDeps = {
  readonly store: Pick<StoreService, 'get' | 'update'>
  readonly registry: Pick<Registry, 'listed' | 'refresh' | 'isLoaded'>
  readonly hours: number
  /** The main turns running now (`rt.turns`): checks wait for none. */
  readonly turns: ReadonlySet<string>
  /** Whether network use is off (the traffic switch). */
  readonly trafficOff: () => Promise<boolean>
  readonly newJobId: () => string
  readonly kick: () => void
  readonly debug?: (text: string) => void
}

export const createUpdater = (ports: UpdatesPorts, deps: UpdaterDeps): Updater => {
  const debug = deps.debug ?? (() => {})
  let timer: { cancel(): void } | undefined
  let disposed = false
  let checking: Promise<void> | undefined
  let again = false

  /** The marketplaces installed mods come from (a folder marketplace has no updates: it runs from its folder). */
  const marketplacesOfMods = (): string[] => {
    const names = deps.registry
      .listed()
      .filter(({ entry, mod }) => mod === true && originOf(entry) === 'marketplace')
      .map(({ entry }) => splitPluginId(entry.id).marketplace)
    return [...new Set(names)].sort()
  }

  const schedule = (delay: number): void => {
    timer?.cancel()
    if (disposed) return
    timer = ports.clock.after(delay, () => {
      timer = undefined
      void tick()
    })
  }

  /** Checks off for this module: no timer at all, not one that finds them off. */
  const isOff = async (): Promise<boolean> => deps.hours <= 0 || (await deps.trafficOff())

  const tick = async (): Promise<void> => {
    const outcome = await run().catch(error => {
      debug(`modmgr: update check failed: ${String(error)}`)
      return 'failed' as const
    })
    if (outcome === 'busy') schedule(BUSY_RETRY_MS)
    else if (outcome === 'failed') await arm()
  }

  const run = async (): Promise<'queued' | 'busy' | 'off' | 'nothing'> => {
    if (await isOff()) return 'off'
    if (deps.turns.size > 0) return 'busy'
    // A reload under way or waiting goes first: a refresh would hold the queue.
    const { jobs } = await ports.state.read('queue')
    if (jobs.some(job => job.kind === 'reload' && isActive(job))) return 'busy'
    if (!deps.registry.isLoaded()) await deps.registry.refresh()
    const now = await ports.clock.now()
    // Said done now, so a failing network isn't asked again before the next period.
    deps.store.update('updates', updates => ({ ...updates, at: now }))
    const specs: JobSpec[] = marketplacesOfMods().flatMap(name =>
      parseMarketplaceName(name).ok ? [{ kind: 'marketplace-update', target: name }] : [],
    )
    // The next one is a period from now, whoever asked (the timer or "check now").
    await arm()
    if (specs.length === 0) return 'nothing'
    // One refresh at a time: none waiting or running.
    const queued = await enqueue(
      ports,
      { id: deps.newJobId(), specs, reload: false },
      () => deps.newJobId(),
      queue => !queue.jobs.some(job => job.kind === 'marketplace-update' && isActive(job)),
    )
    if (!queued) return 'nothing'
    deps.kick()
    return 'queued'
  }

  const arm = async (): Promise<void> => {
    if (await isOff()) {
      timer?.cancel()
      return
    }
    const now = await ports.clock.now()
    const lastAt = deps.store.get('updates').at
    const wait = nextCheckIn(lastAt, deps.hours, now)
    if (wait === undefined) {
      timer?.cancel()
      return
    }
    schedule(lastAt === undefined ? Math.max(wait, FIRST_CHECK_DELAY_MS) : wait)
  }

  const readText = (path: string): Promise<string | undefined> =>
    ports.fs.read(path).catch(() => undefined)

  const checkOnce = async (): Promise<void> => {
    const listed = await runCli(ports, { op: 'marketplaces' })
    const marketplaces = listed.ok ? parseMarketplaces(listed.value) : undefined
    if (marketplaces === undefined || !marketplaces.ok) {
      debug('modmgr: update check could not list the marketplaces')
      return
    }
    // Mods only: a row shows nothing else.
    const installed = deps.registry
      .listed()
      .filter(({ mod }) => mod === true)
      .map(({ entry }) => entry)
    const wanted = new Set(marketplacesOfMods())
    const entries = new Map<string, ReadonlyMap<string, ListedEntry>>()
    for (const marketplace of marketplaces.value.items) {
      const root = marketplace.installLocation
      if (!wanted.has(marketplace.name) || root === undefined) continue
      const text = await readText(joinPath(root, '.claude-plugin/marketplace.json'))
      if (text === undefined) continue
      const listed = marketplaceEntriesOf(text)
      // An installed mod's own plugin.json, in the clone, says the version the CLI compares.
      for (const entry of installed) {
        const { name, marketplace: from } = splitPluginId(entry.id)
        const item = listed.get(name)
        if (from !== marketplace.name || item?.source.kind !== 'relative') continue
        const folder = marketplaceFolderOf(text, name)
        if (folder === undefined) continue
        const manifest = await readText(
          joinPath(joinPath(root, folder), '.claude-plugin/plugin.json'),
        )
        const version = manifest === undefined ? undefined : manifestOf(manifest)?.version
        if (version !== undefined) listed.set(name, { ...item, manifestVersion: version })
      }
      entries.set(marketplace.name, listed)
    }
    const found = foundUpdates(installed, entries)
    deps.store.update('updates', updates => ({ ...updates, found }))
    await deps.registry.refresh()
  }

  return {
    arm,
    run,
    check() {
      if (checking !== undefined) {
        again = true
        return checking
      }
      checking = (async () => {
        do {
          again = false
          try {
            await checkOnce()
          } catch (error) {
            debug(`modmgr: update check failed: ${String(error)}`)
          }
        } while (again)
      })().finally(() => {
        checking = undefined
      })
      return checking
    },
    forget(id) {
      deps.store.update('updates', updates => {
        if (updates.found[id] === undefined) return updates
        const { [id]: _gone, ...found } = updates.found
        return { ...updates, found }
      })
    },
    dispose() {
      disposed = true
      timer?.cancel()
    },
  }
}
