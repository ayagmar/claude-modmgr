// The long-lived services of one module instance (C2, review M4): built once
// at its first `session.start`, on that dispatch's ports, and kept in
// register.tsx's module scope. A reload of modmgr builds a new one; the old
// one's in-flight work finishes on its own and then stops (it no longer owns
// the queue).

import { type Config, trafficOff } from '../domain/config.ts'
import type { StateKey } from '../domain/state.ts'
import type { Ports, StatePort } from '../ports.ts'
import { type Catalog, createCatalog } from './catalog.ts'
import { type Chrome, createChrome } from './chrome.ts'
import { createDetector, type Detector } from './detector.ts'
import { createRunner, type Runner } from './job-runner.ts'
import { createRegistry, type Registry } from './registry.ts'
import { createStore, type StoreService } from './store.ts'

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
  const chrome = createChrome(base, debug)
  // The runtime's own writes (the runner's, the registry's) keep the status line current.
  const ports: Ports = {
    ...base,
    state: observedState(base.state, SUMMARY_KEYS, () => chrome.schedule()),
  }
  const store = createStore(ports, { debug })
  const registry = createRegistry(ports, store, debug)
  const catalog = createCatalog(ports, store, debug)
  const detector = createDetector(ports, {
    store,
    catalog,
    debug,
    remoteAllowed: async () => {
      if (!config.detectRemote) return false
      const traffic = await ports.env.nonessentialTraffic().catch(() => undefined)
      return !trafficOff(traffic)
    },
  })
  /** A marketplace or an install changes what the catalogue lists. */
  const recatalog = (): void => {
    if (!catalog.isLoaded()) return
    void catalog.load({ force: true }).then(() => detector.start())
  }
  const runner = createRunner(ports, {
    owner,
    store,
    isInstalled: async id => {
      if (!registry.isLoaded()) await registry.refresh()
      return registry.entry(id) !== undefined
    },
    onSettled: () => registry.refresh(),
    onFinished: job => {
      const lists = ['install', 'remove', 'marketplace-add', 'marketplace-update']
      if (job.state === 'ok' && lists.includes(job.kind)) recatalog()
    },
    debug,
  })
  let counter = 0
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
    newJobId() {
      counter += 1
      return `${owner}-${counter}`
    },
    dispose() {
      runner.dispose()
      detector.dispose()
      void store.flush()
    },
  }
}

/** A short random id for a module instance. */
export const newOwnerId = (random: () => number = Math.random): string =>
  Math.floor(random() * 36 ** 8)
    .toString(36)
    .padStart(8, '0')
