// What Health shows beyond the other state keys (PLAN §2.5, C15), gathered
// into `$.state` `health` when Health is opened or refreshed: hook-order notes
// (F3's load order), the last hook failures a `--debug` log names (C6, F35),
// the detector's budget, the store's size and the update checks.

import type { HealthFacts } from '../../types/index.d.ts'
import { chainNotes } from '../domain/chain.ts'
import type { Config } from '../domain/config.ts'
import { configDirOf, joinPath } from '../domain/dev.ts'
import { loggedFailures } from '../domain/health.ts'
import type { Ports } from '../ports.ts'
import type { Registry } from './registry.ts'
import type { StoreService } from './store.ts'

export type HealthPorts = Pick<Ports, 'state' | 'fs' | 'env' | 'clock'>

/** modmgr observes the session's notices and changes no row (C14): no hook-order note names it. */
const SELF = 'modmgr'

export type Health = {
  /** Gathers the facts again (a call during one queues one more). */
  refresh(): Promise<void>
}

export const createHealth = (
  ports: HealthPorts,
  deps: {
    readonly registry: Pick<Registry, 'chainMods'>
    readonly store: Pick<StoreService, 'get' | 'bytes' | 'isFull'>
    readonly detector: { spent(): number }
    readonly budget: number
    readonly config: Config
    readonly trafficOff: () => Promise<boolean>
    readonly debug?: (text: string) => void
  },
): Health => {
  const debug = deps.debug ?? (() => {})
  let running: Promise<void> | undefined
  let again = false

  /** The last failures a `--debug` session's log names (`<config>/debug/latest`, F35). */
  const logged = async (): Promise<{ found: boolean; failures: Record<string, string> }> => {
    const [configDir, home] = await Promise.all([
      ports.env.configDir().catch(() => undefined),
      ports.env.home().catch(() => undefined),
    ])
    const config = configDirOf(configDir, home)
    if (config === undefined) return { found: false, failures: {} }
    const folder = joinPath(config, 'debug')
    const entries = await ports.fs.list(folder).catch(() => [])
    if (!entries.some(entry => entry.name === 'latest')) return { found: false, failures: {} }
    // A log past 4 MiB can't be read in one piece: the pointer stays, the lines don't.
    const text = await ports.fs.read(joinPath(folder, 'latest')).catch(() => '')
    return { found: true, failures: loggedFailures(text) }
  }

  const once = async (): Promise<void> => {
    const { config } = deps
    const [log, trafficOff, now] = await Promise.all([
      logged(),
      deps.trafficOff(),
      ports.clock.now(),
    ])
    const remoteWhy = !config.detectRemote
      ? 'detectRemote is off in its options'
      : trafficOff
        ? 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC is set'
        : undefined
    const updatesOff =
      config.updateCheckHours <= 0
        ? 'updateCheckHours is 0'
        : trafficOff
          ? 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC is set'
          : undefined
    const lastCheck = deps.store.get('updates').at
    const facts: HealthFacts = {
      at: now,
      chain: chainNotes(deps.registry.chainMods().filter(mod => mod.name !== SELF)).map(note => ({
        event: note.event,
        text: note.text,
      })),
      logged: log.failures,
      debugLog: log.found,
      detector: {
        spent: deps.detector.spent(),
        budget: deps.budget,
        remote: remoteWhy === undefined,
        ...(remoteWhy === undefined ? {} : { why: remoteWhy }),
      },
      cache: { bytes: deps.store.bytes(), full: deps.store.isFull() },
      updates: {
        every: config.updateCheckHours,
        ...(lastCheck === undefined ? {} : { at: lastCheck }),
        ...(updatesOff === undefined ? {} : { off: updatesOff }),
      },
    }
    await ports.state.update('health', () => facts)
  }

  return {
    refresh() {
      if (running !== undefined) {
        again = true
        return running
      }
      running = (async () => {
        do {
          again = false
          try {
            await once()
          } catch (error) {
            debug(`modmgr: health refresh failed: ${String(error)}`)
          }
        } while (again)
      })().finally(() => {
        running = undefined
      })
      return running
    },
  }
}
