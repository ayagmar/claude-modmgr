// The ordered fan-out for events modmgr hooks once (F37, review M3). Sequencing
// lives here, not in register.tsx, so it is tested.
//
// `session.start` must stay under 5 ms of blocking work (PLAN §6): it registers
// `/mods` and takes the job queue over, then hands everything else to a clock
// timer. It runs again when modmgr's own module reloads (F31), so every step is
// idempotent.

import { RELOADED_WITH_MODMGR, takeOver, tookOverReload } from '../domain/jobs.ts'
import { readPrefs } from '../domain/store-schema.ts'
import { probeAndRecord } from './capability-probe.ts'
import { echoLine } from './job-runner.ts'
import type { Runtime } from './runtime.ts'

export const MODS_DESCRIPTION = 'Discover, inspect, toggle and update mods'

export const onSessionStart = async (rt: Runtime): Promise<void> => {
  const { ports } = rt
  await ports.command.registerMods()
  const now = await ports.clock.now()
  let fresh = false
  let reloaded = false
  await ports.state.update('queue', queue => {
    fresh = queue.owner === ''
    const next = takeOver(queue, rt.owner, now)
    reloaded = tookOverReload(queue, next)
    return next
  })
  // The reload that restarted this module applied what the batch changed (F54).
  if (reloaded) {
    await ports.state.update('attention', attention => ({ ...attention, reloadPending: false }))
    // Said for a while, as the runner's own echo is (review R-M4-4).
    await echoLine(ports, RELOADED_WITH_MODMGR)
  }
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
      // A reloaded modmgr with Discover showing reads its catalogue again (module memory).
      if ((await ports.state.read('view')).tab === 'discover') {
        await rt.catalog.load()
        await rt.catalog.show()
        rt.detector.start()
      }
    }
  } catch (error) {
    ports.ui.debug(`modmgr: start-up failed: ${String(error)}`)
  }
}

/**
 * The turns running now, by id (review R-M4-2): a subagent's run raises no
 * `turn.start` and its `turn.complete` carries `agentId` (d.ts TurnCompleteFields),
 * so only the main loop's own start and end count. The detector probes, and
 * M5b's scheduler fetches, only while none runs (PLAN §2.3, idle-only).
 */
export const onTurnStart = (rt: Runtime | undefined, turnId: string): void => {
  if (rt === undefined) return
  rt.turns.add(turnId)
  rt.detector.setBusy(true)
}

export const onTurnEnd = (
  rt: Runtime | undefined,
  turnId: string,
  agentId: string | undefined,
): void => {
  if (rt === undefined || agentId !== undefined) return
  rt.turns.delete(turnId)
  rt.detector.setBusy(rt.turns.size > 0)
}
