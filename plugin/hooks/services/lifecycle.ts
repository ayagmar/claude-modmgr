// The ordered fan-out for events modmgr hooks once (a module may hook an event
// only once without a matcher). Sequencing
// lives here, not in register.tsx, so it is tested.
//
// `session.start` must stay under 5 ms of blocking work: it registers
// `/mods` and takes the job queue over, then hands everything else to a clock
// timer. It runs again when modmgr's own module reloads, so every step is
// idempotent.

import { RELOADED_WITH_MODMGR, takeOver, tookOverReload } from '../domain/jobs.ts'
import { readPrefs } from '../domain/store-schema.ts'
import { probeAndRecord } from './capability-probe.ts'
import { echoLine } from './job-runner.ts'
import type { Runtime } from './runtime.ts'

export const MODS_DESCRIPTION = 'Discover, inspect, toggle and update mods'

export const onSessionStart = async (rt: Runtime): Promise<void> => {
  const { ports } = rt
  let fresh = false
  let reloaded = false
  // Side by side: each is a host round trip, and session.start blocks the session.
  const takeQueue = async (): Promise<void> => {
    const now = await ports.clock.now()
    await ports.state.update('queue', queue => {
      fresh = queue.owner === ''
      const next = takeOver(queue, rt.owner, now)
      reloaded = tookOverReload(queue, next)
      return next
    })
  }
  await Promise.all([ports.command.registerMods(), takeQueue()])
  // The reload that restarted this module applied what the batch changed.
  if (reloaded) {
    await ports.state.update('attention', attention => ({ ...attention, reloadPending: false }))
    // Said for a while, as the runner's own echo is.
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
      // Until it has been seen, a session that draws opens on a word of welcome;
      // leaving it marks it seen. A `-p` run draws nothing.
      const draws = (await ports.session.surfaces().catch(() => [])).length > 0
      const welcome = draws && !prefs.firstRunDone
      await ports.state.update('view', view => ({
        ...view,
        tab: prefs.tab,
        sort: prefs.sort,
        ...(welcome ? { stack: ['welcome' as const] } : {}),
      }))
    }
    // A reloaded module says again what the last one left on the status line.
    await rt.chrome.sync()
    const probe = await probeAndRecord(ports)
    if (!probe.process) {
      await rt.registry.refresh()
      rt.runner.kick()
      // Re-armed by every module from the stored time: a reload loses timers.
      await rt.updater.arm()
      // A reloaded modmgr with a tab showing reads what it needs again (module memory). A
      // fresh session only restores the tab: it is read when the dialog opens.
      if (!how.fresh) await rt.showTab((await ports.state.read('view')).tab)
    }
  } catch (error) {
    ports.ui.debug(`modmgr: start-up failed: ${String(error)}`)
  }
}

/**
 * The turns running now, by id: a subagent's run raises no
 * `turn.start` and its `turn.complete` carries `agentId` (d.ts TurnCompleteFields),
 * so only the main loop's own start and end count. The detector probes, and
 * the update scheduler fetches, only while none runs.
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

/**
 * A notice the session appended (`session.append`, door `notice`): while it
 * hot-reloads a folder, the engine says there when a plugin's hook or module
 * failed. Dev counts them; nothing is answered or changed.
 */
export const onNotice = (
  rt: Runtime | undefined,
  content: readonly { readonly type: string; readonly [field: string]: unknown }[],
): void => {
  if (rt === undefined) return
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      void rt.dev.notice(block.text).catch(() => undefined)
    }
  }
}
