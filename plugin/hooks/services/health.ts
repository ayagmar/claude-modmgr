// What Health shows beyond the other state keys, gathered
// into `$.state` `health` when Health is opened or refreshed: hook-order notes
// (in load order), the last hook failures a `--debug` log names,
// the detector's budget, the store's size and the update checks.

import type { HealthFacts } from '../../types/index.d.ts'
import { chainNotes } from '../domain/chain.ts'
import type { Config } from '../domain/config.ts'
import { configDirOf, isSessionId, joinPath } from '../domain/dev.ts'
import { loggedFailures } from '../domain/health.ts'
import type { Ports } from '../ports.ts'
import type { Registry } from './registry.ts'
import type { StoreService } from './store.ts'
import { NO_TIMING, type Timing, timed } from './timing.ts'

export type HealthPorts = Pick<Ports, 'state' | 'fs' | 'env' | 'clock' | 'session'>

/** modmgr observes the session's notices and changes no row: no hook-order note names it. */
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
    readonly timing?: Timing
  },
): Health => {
  const debug = deps.debug ?? (() => {})
  let running: Promise<void> | undefined
  let again = false

  /**
   * The last failures this session's own debug log names (`<config>/debug/<session
   * id>.txt`, written only with `--debug`): not `latest`, which may be another session's.
   */
  const logged = async (): Promise<{
    log: HealthFacts['debugLog']
    failures: Record<string, string>
  }> => {
    const none = { log: { state: 'none' as const }, failures: {} }
    const [configDir, home, sessionId] = await Promise.all([
      ports.env.configDir().catch(() => undefined),
      ports.env.home().catch(() => undefined),
      ports.session.id().catch(() => ''),
    ])
    const config = configDirOf(configDir, home)
    if (config === undefined || !isSessionId(sessionId)) return none
    const folder = joinPath(config, 'debug')
    const name = `${sessionId}.txt`
    const entries = await ports.fs.list(folder).catch(() => [])
    if (!entries.some(entry => entry.name === name)) return none
    const path = joinPath(folder, name)
    // Past 4 MiB the engine won't read it in one piece: say so, never "nothing failed".
    const text = await ports.fs.read(path).catch(() => undefined)
    return text === undefined
      ? { log: { state: 'too-big', path }, failures: {} }
      : { log: { state: 'read', path }, failures: loggedFailures(text) }
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
      debugLog: log.log,
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
            await timed(deps.timing ?? NO_TIMING, 'health facts', once)
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
