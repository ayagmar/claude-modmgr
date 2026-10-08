// The long-lived services of one module instance (C2, review M4): built once
// at its first `session.start`, on that dispatch's ports, and kept in
// register.tsx's module scope. A reload of modmgr builds a new one; the old
// one's in-flight work finishes on its own and then stops (it no longer owns
// the queue).

import type { Job, Tab } from '../../types/index.d.ts'
import { type Config, trafficOff } from '../domain/config.ts'
import type { StateKey } from '../domain/state.ts'
import type { Ports, StatePort } from '../ports.ts'
import { type Catalog, createCatalog } from './catalog.ts'
import { type Chrome, createChrome } from './chrome.ts'
import { createDetector, DETECT_BUDGET, type Detector } from './detector.ts'
import { createDev, type Dev } from './dev.ts'
import { createHealth, type Health } from './health.ts'
import { createRunner, type Runner } from './job-runner.ts'
import { createRegistry, type Registry } from './registry.ts'
import { createStore, type StoreService } from './store.ts'
import { type Timing, timingOf } from './timing.ts'
import { createUpdater, type Updater } from './updates.ts'

export type Runtime = {
  /** This module's queue owner id. */
  readonly owner: string
  readonly ports: Ports
  readonly config: Config
  readonly store: StoreService
  readonly registry: Registry
  readonly runner: Runner
  /** The status line and the pane title. */
  readonly chrome: Chrome
  /** Discover's catalogue (module memory). */
  readonly catalog: Catalog
  /** Finds which catalogue entries are mods, while no turn runs. */
  readonly detector: Detector
  /** Dev's mods under development and their failures. */
  readonly dev: Dev
  /** Checks for updates every `updateCheckHours`, while idle. */
  readonly updater: Updater
  /** Health's facts beyond the other keys. */
  readonly health: Health
  /** Says how long a step took, with `debugTimings` on (M6, `docs/PERF.md`). */
  readonly timing: Timing
  /** After a job ends (the runner's, or a text write's, C16): catalogue, analyses, updates. */
  jobFinished(job: Job): void
  /**
   * What a tab needs read when it is shown (a press, an open, a reloaded module
   * with it showing): Discover's catalogue and the detector, Dev's folders,
   * Health's facts. Never at a fresh start (review R-M6-2).
   */
  showTab(tab: Tab): Promise<void>
  /** The main loop's turns running now, by id (lifecycle `onTurnStart`/`onTurnEnd`). */
  readonly turns: Set<string>
  /** Job ids unique across modules: the owner, then a counter. */
  newJobId(): string
  dispose(): void
}

/** The keys the status line and the title are drawn from (domain/view.ts `summaryOf`). */
const SUMMARY_KEYS: ReadonlySet<StateKey> = new Set(['attention', 'queue', 'mods'])

/** A state port that calls `written` after each successful write of `keys`. */
export const observedState = (
  state: StatePort,
  keys: ReadonlySet<StateKey>,
  written: () => void,
): StatePort => ({
  read: key => state.read(key),
  async update(key, change) {
    const value = await state.update(key, change)
    if (keys.has(key)) written()
    return value
  },
})

export const createRuntime = (base: Ports, config: Config, owner: string): Runtime => {
  const debug = (text: string): void => base.ui.debug(text)
  const timing = timingOf(config.debugTimings, debug)
  const chrome = createChrome(base, debug)
  // The runtime's own writes (the runner's, the registry's) keep the status line current.
  const ports: Ports = {
    ...base,
    state: observedState(base.state, SUMMARY_KEYS, () => chrome.schedule()),
  }
  const store = createStore(ports, { debug })
  const registry = createRegistry(ports, store, debug, timing)
  const catalog = createCatalog(ports, store, debug, timing)
  const trafficIsOff = async (): Promise<boolean> =>
    trafficOff(await ports.env.nonessentialTraffic().catch(() => undefined))
  const detector = createDetector(ports, {
    store,
    catalog,
    debug,
    remoteAllowed: async () => config.detectRemote && !(await trafficIsOff()),
  })
  /** A marketplace or an install changes what the catalogue lists. */
  const recatalog = (): void => {
    if (!catalog.isLoaded()) return
    void catalog.load({ force: true }).then(() => detector.start())
  }
  /** After a job ends, the runner's or a text write's: what it changed is read again. */
  const jobFinished = (job: Job): void => {
    const lists = ['install', 'remove', 'marketplace-add', 'marketplace-update']
    if (job.state === 'ok' && lists.includes(job.kind)) recatalog()
    // A folder validated anew: Installed reads what it can do again (it may have changed
    // without a new version, C14).
    const path = job.args?.path
    if (job.kind === 'validate' && path !== undefined && registry.forget(path)) {
      void registry.refresh()
    }
    // A refreshed marketplace says what can update (PLAN §2.6).
    if (job.kind === 'marketplace-update' && job.state === 'ok') void updater.check()
    // The CLI found it current: what a check guessed goes, before the refresh that follows.
    if (job.kind === 'update' && job.unchanged === true && job.target !== undefined) {
      updater.forget(job.target)
    }
  }
  const runner = createRunner(ports, {
    owner,
    store,
    isInstalled: async id => {
      if (!registry.isLoaded()) await registry.refresh()
      return registry.entry(id) !== undefined
    },
    onSettled: () => registry.refresh(),
    onFinished: job => jobFinished(job),
    debug,
  })
  const dev = createDev(ports, registry, debug, timing)
  let counter = 0
  const newJobId = (): string => {
    counter += 1
    return `${owner}-${counter}`
  }
  const turns = new Set<string>()
  const updater = createUpdater(ports, {
    store,
    registry,
    hours: config.updateCheckHours,
    turns,
    trafficOff: trafficIsOff,
    newJobId,
    kick: () => runner.kick(),
    debug,
  })
  const health = createHealth(ports, {
    registry,
    store,
    detector,
    budget: DETECT_BUDGET,
    config,
    trafficOff: trafficIsOff,
    debug,
    timing,
  })
  return {
    owner,
    ports,
    config,
    store,
    registry,
    runner,
    chrome,
    catalog,
    detector,
    dev,
    updater,
    health,
    timing,
    jobFinished,
    async showTab(tab) {
      if (tab === 'discover') {
        // Read at the first visit, then at most every few hours (PLAN §2.3).
        await catalog.load()
        await catalog.show()
        detector.start()
      }
      // What a session loads from folders changes with its commands and reloads: read on each visit.
      if (tab === 'dev' || tab === 'health') await dev.refresh()
      if (tab === 'health') await health.refresh()
    },
    turns,
    newJobId,
    dispose() {
      runner.dispose()
      detector.dispose()
      updater.dispose()
      void store.flush()
    },
  }
}

/** A short random id for a module instance. */
export const newOwnerId = (random: () => number = Math.random): string =>
  Math.floor(random() * 36 ** 8)
    .toString(36)
    .padStart(8, '0')
