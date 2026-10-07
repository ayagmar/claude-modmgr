// The long-lived services of one module instance (C2, review M4): built once
// at its first `session.start`, on that dispatch's ports, and kept in
// register.tsx's module scope. A reload of modmgr builds a new one; the old
// one's in-flight work finishes on its own and then stops (it no longer owns
// the queue).

import type { Config } from '../domain/config.ts'
import type { Ports } from '../ports.ts'
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
  /** Job ids unique across modules: the owner, then a counter. */
  newJobId(): string
  dispose(): void
}

export const createRuntime = (ports: Ports, config: Config, owner: string): Runtime => {
  const debug = (text: string): void => ports.ui.debug(text)
  const store = createStore(ports, { debug })
  const registry = createRegistry(ports, store, debug)
  const runner = createRunner(ports, {
    owner,
    store,
    isInstalled: async id => {
      if (!registry.isLoaded()) await registry.refresh()
      return registry.entry(id) !== undefined
    },
    onSettled: () => registry.refresh(),
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
    newJobId() {
      counter += 1
      return `${owner}-${counter}`
    },
    dispose() {
      runner.dispose()
      void store.flush()
    },
  }
}

/** A short random id for a module instance. */
export const newOwnerId = (random: () => number = Math.random): string =>
  Math.floor(random() * 36 ** 8)
    .toString(36)
    .padStart(8, '0')
