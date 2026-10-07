// The ordered fan-out for events modmgr hooks once (F37, review M3). Sequencing
// lives here, not in register.tsx, so it is tested.
//
// `session.start` must stay under 5 ms of blocking work (PLAN §6): it registers
// `/mods` and takes the job queue over, then hands everything else to a clock
// timer. It runs again when modmgr's own module reloads (F31), so every step is
// idempotent.

import { takeOver } from '../domain/jobs.ts'
import { readPrefs } from '../domain/store-schema.ts'
import { probeAndRecord } from './capability-probe.ts'
import type { Runtime } from './runtime.ts'

export const MODS_DESCRIPTION = 'Discover, inspect, toggle and update mods'

export const onSessionStart = async (rt: Runtime): Promise<void> => {
  const { ports } = rt
  await ports.command.registerMods()
  const now = await ports.clock.now()
  let fresh = false
  await ports.state.update('queue', queue => {
    fresh = queue.owner === ''
    return takeOver(queue, rt.owner, now)
  })
  ports.clock.after(0, () => {
    void background(rt, { fresh })
  })
}

/**
 * The rest of start-up, off the blocking path: the store, preferences (first
 * start of the session only; a reloaded module keeps the view it finds), the
 * capability probe, the installed list, and any queued jobs.
 */
export const background = async (rt: Runtime, how: { fresh: boolean }): Promise<void> => {
  const { ports } = rt
  try {
    await rt.store.load()
    if (how.fresh) {
      const prefs = readPrefs(rt.store.get('prefs'))
      await ports.state.update('view', view => ({
        ...view,
        tab: prefs.tab,
        sort: prefs.sort,
        kind: prefs.kind,
      }))
    }
    // A reloaded module says again what the last one left on the status line.
    await rt.chrome.sync()
    const probe = await probeAndRecord(ports)
    if (!probe.process) {
      await rt.registry.refresh()
      rt.runner.kick()
    }
  } catch (error) {
    ports.ui.debug(`modmgr: start-up failed: ${String(error)}`)
  }
}

/**
 * A turn started or ended (`turn.start`, `turn.complete`): the detector probes
 * only while none runs (PLAN §2.3, idle-only), and resumes when it ends.
 */
export const onTurn = (rt: Runtime | undefined, busy: boolean): void => {
  rt?.detector.setBusy(busy)
}
