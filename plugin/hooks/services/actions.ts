// What the pane's Buttons, its Input, the band and the focus ring do (C2):
// each reads and writes `$.state` through the dispatch's own ports, then asks
// the module's runtime to run what it queued (`kick`). No job ever runs here.
// Every action catches its own failure: a press must never throw into the host.

import type { RenderSurface } from 'claude-code'
import type { Tab, View } from '../../types/index.d.ts'
import { enqueueReload, prune, undoSpecs } from '../domain/jobs.ts'
import {
  closedView,
  escapeStep,
  FILTER_KEY,
  filterRows,
  PANE_ID,
  paneOpen,
  popOverlay,
  pruneStaged,
  pushOverlay,
  rowKey,
  specsOf,
  stagedChanges,
  stageToggle,
  toggleOverlay,
  toggleReview,
  topOverlay,
  whyLocked,
} from '../domain/view.ts'
import type { Ports } from '../ports.ts'
import { enqueue } from './job-runner.ts'
import type { Runtime } from './runtime.ts'

export type ActionPorts = Pick<Ports, 'state' | 'ui'>

/** The parts of the module's runtime an action reaches; absent before the first `session.start`. */
export type ActionRuntime = Pick<Runtime, 'registry' | 'runner' | 'newJobId'>

export type Actions = {
  tab(tab: Tab): Promise<void>
  /** The focus ring landed on a row: it becomes the selection (the split's detail follows). */
  focusRow(id: string): Promise<void>
  /** Enter on a row: its detail. */
  open(id: string): Promise<void>
  /** Pops the top overlay (a review popped is a review cancelled). */
  back(): Promise<void>
  /** Stages a toggle of the selected mod, or of `id`. */
  toggle(id?: string): Promise<void>
  /** Opens the review of what is staged. */
  apply(): Promise<void>
  /** `y` on the review: queues the batch and its reload. */
  confirm(): Promise<void>
  /** `n` on the review. */
  cancel(): Promise<void>
  /** Queues the inverse of the last batch. */
  undo(): Promise<void>
  refresh(): Promise<void>
  /** Queues a reload on its own (the band's `[l reload]`). */
  reload(): Promise<void>
  overlay(which: 'help' | 'jobs'): Promise<void>
  filter(text: string): Promise<void>
  /** `f`: the ring onto the filter field. */
  focusFilter(): Promise<void>
  /** Moves the selection to the first or last row the filter shows, and the ring with it. */
  edge(which: 'first' | 'last'): Promise<void>
  copy(text: string, surface?: RenderSurface): Promise<void>
  /** Opens the dialog from the band. */
  openPane(): Promise<void>
  /** The footer's close: the same `ui.close` as Esc, origin `plugin`. */
  close(): Promise<void>
  /** Hides the band's current line. */
  dismiss(line: string): Promise<void>
  cancelJob(id: string): Promise<void>
  /** Esc and the close mark (`ui.close`, origin `person`): true keeps the pane open. */
  closing(origin: 'person' | 'plugin' | 'unload'): Promise<boolean>
}

export const createActions = (
  ports: ActionPorts,
  rt: ActionRuntime | undefined,
  debug: (text: string) => void = text => ports.ui.debug(text),
): Actions => {
  const { state, ui } = ports
  const setView = (change: (view: View) => View) => state.update('view', change)
  const notice = (text: string) => setView(view => ({ ...view, notice: text }))
  const quiet = (view: View): View => {
    if (view.notice === undefined) return view
    const { notice: _gone, ...rest } = view
    return rest
  }

  /** Runs an action, logging (never throwing) what fails. */
  const safely =
    <A extends unknown[]>(name: string, fn: (...args: A) => Promise<void>) =>
    async (...args: A): Promise<void> => {
      try {
        await fn(...args)
      } catch (error) {
        debug(`modmgr: ${name} failed: ${String(error)}`)
      }
    }

  const select = async (id: string | undefined): Promise<void> => {
    await rt?.registry.select(id)
  }

  const queueBatch = async (specs: Parameters<typeof enqueue>[1]['specs']): Promise<boolean> => {
    if (rt === undefined) {
      await notice('modmgr is still starting; try again in a moment')
      return false
    }
    await enqueue(ports, { id: rt.newJobId(), specs, reload: true }, () => rt.newJobId())
    // A pane left open while jobs stream must not hold other plugins' toasts (C8).
    const mods = await state.read('mods')
    if ((await ui.panes()).some(pane => pane.id === PANE_ID)) {
      await ui.open(paneOpen({ focus: false, hold: false, mods: mods.length }))
    }
    rt.runner.kick()
    return true
  }

  const dropReview = async (): Promise<void> => {
    await state.update('review', () => null)
  }

  return {
    tab: safely('tab', async tab => {
      await setView(view => ({ ...quiet(view), tab, stack: [] }))
    }),

    focusRow: safely('focus', async id => {
      const view = await state.read('view')
      if (view.selected === id) return
      await setView(current => ({ ...quiet(current), selected: id }))
      await select(id)
    }),

    open: safely('open', async id => {
      await setView(view => pushOverlay({ ...quiet(view), selected: id }, 'detail'))
      await select(id)
    }),

    back: safely('back', async () => {
      const view = await state.read('view')
      if (topOverlay(view) === 'review') await dropReview()
      await setView(current => popOverlay(quiet(current)))
    }),

    toggle: safely('toggle', async id => {
      const [view, mods] = await Promise.all([state.read('view'), state.read('mods')])
      const target = id ?? view.selected
      const row = mods.find(item => item.id === target)
      if (row === undefined) return
      const locked = whyLocked(row)
      if (locked !== undefined) {
        await notice(`${row.name}: ${locked}`)
        return
      }
      await setView(current => stageToggle(quiet(current), row))
    }),

    apply: safely('apply', async () => {
      const [view, mods] = await Promise.all([state.read('view'), state.read('mods')])
      const changes = stagedChanges(view, mods)
      if (changes.length === 0) {
        await setView(current => pruneStaged({ ...current, notice: 'Nothing is staged' }, mods))
        return
      }
      const review = toggleReview(changes, id => rt?.registry.facts(id))
      await state.update('review', () => review)
      await setView(current => pushOverlay(quiet(current), 'review'))
    }),

    confirm: safely('confirm', async () => {
      const review = await state.read('review')
      if (review === null) return
      const done = await queueBatch(specsOf(review))
      if (!done) return
      await dropReview()
      const ids = new Set(review.targets.map(target => target.id))
      await setView(view => {
        const staged = Object.fromEntries(
          Object.entries(view.staged).filter(([id]) => !ids.has(id)),
        )
        const stack = view.stack.filter(overlay => overlay !== 'review')
        return { ...quiet(view), staged, stack }
      })
    }),

    cancel: safely('cancel', async () => {
      await dropReview()
      await setView(view => ({
        ...quiet(view),
        stack: view.stack.filter(overlay => overlay !== 'review'),
      }))
    }),

    undo: safely('undo', async () => {
      const queue = await state.read('queue')
      const undo = undoSpecs(queue.jobs)
      if (undo === undefined) {
        await notice('Nothing to undo')
        return
      }
      if (await queueBatch(undo.specs)) {
        await notice(`Undoing the last batch (${undo.specs.length})`)
      }
    }),

    refresh: safely('refresh', async () => {
      await rt?.registry.refresh()
    }),

    reload: safely('reload', async () => {
      if (rt === undefined) return
      const batch = rt.newJobId()
      const id = rt.newJobId()
      await state.update('queue', queue => ({
        ...queue,
        jobs: prune(enqueueReload(queue.jobs, id, batch)),
      }))
      rt.runner.kick()
    }),

    overlay: safely('overlay', async which => {
      await setView(view => toggleOverlay(quiet(view), which))
    }),

    filter: safely('filter', async text => {
      await setView(view => ({ ...quiet(view), query: text.slice(0, 100) }))
    }),

    focusFilter: safely('focus filter', async () => {
      await ui.focus(PANE_ID, FILTER_KEY).catch(() => undefined)
    }),

    edge: safely('edge', async which => {
      const [view, mods] = await Promise.all([state.read('view'), state.read('mods')])
      const rows = filterRows(mods, view.query)
      const row = which === 'first' ? rows[0] : rows.at(-1)
      if (row === undefined) return
      await setView(current => ({ ...quiet(current), selected: row.id }))
      await select(row.id)
      // The row may be drawn only after the redraw this write causes; focus awaits it.
      await ui.focus(PANE_ID, rowKey(row.id)).catch(() => undefined)
    }),

    copy: safely('copy', async (text, surface) => {
      const copied = await ui.copy(text, surface)
      await notice(copied.isCopied ? `Copied ${text}` : `Couldn't copy: ${copied.reason}`)
    }),

    openPane: safely('open pane', async () => {
      const [mods, queue] = await Promise.all([state.read('mods'), state.read('queue')])
      const busy = queue.jobs.some(job => job.state === 'running' || job.state === 'queued')
      await ui.open(paneOpen({ focus: true, hold: !busy, mods: mods.length }))
    }),

    close: safely('close', async () => {
      await ui.close(PANE_ID)
    }),

    dismiss: safely('dismiss', async line => {
      await state.update('attention', attention => ({ ...attention, dismissed: line }))
    }),

    cancelJob: safely('cancel job', async id => {
      await rt?.runner.cancel(id)
    }),

    async closing(origin) {
      try {
        if (origin === 'person') {
          const focused = (await ui.panes()).find(pane => pane.id === PANE_ID)?.isFocused === true
          const view = await state.read('view')
          const step = escapeStep(view, focused)
          if (step.kind !== 'close') {
            if (step.kind === 'pop' && topOverlay(view) === 'review') await dropReview()
            await setView(current => {
              const now = escapeStep(current, focused)
              return now.kind === 'close' ? current : quiet(now.view)
            })
            return true
          }
        }
        await dropReview()
        await setView(view => closedView(view))
      } catch (error) {
        debug(`modmgr: close failed: ${String(error)}`)
      }
      return false
    },
  }
}
