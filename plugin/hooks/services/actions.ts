// What the pane's Buttons, its Input, the band and the focus ring do (C2):
// each reads and writes `$.state` through the dispatch's own ports, then asks
// the module's runtime to run what it queued (`kick`). No job ever runs here.
// Every action catches its own failure: a press must never throw into the host.

import type { RenderSurface } from 'claude-code'
import type { ReviewRequest, Tab, View } from '../../types/index.d.ts'
import {
  acceptReview,
  awaitingAcceptance,
  foundKey,
  foundRow,
  installReview,
  isInstallScope,
  MARKETPLACE_KEY,
  marketplaceReview,
  nextKind,
  nextSort,
  withScope,
} from '../domain/discover.ts'
import { enqueueReload, prune, stillUndoes, undoNeedsReview, undoPlan } from '../domain/jobs.ts'
import {
  closedView,
  escapeStep,
  FILTER_KEY,
  filterRows,
  holdsToasts,
  neighbourOf,
  PANE_ID,
  paneOpen,
  popOverlay,
  pruneStaged,
  pushOverlay,
  removeReview,
  rowKey,
  selectedRow,
  specsOf,
  stagedChanges,
  stageToggle,
  summaryOf,
  titleOf,
  toggleOverlay,
  toggleReview,
  topOverlay,
  undoReview,
  updateReview,
  whyLocked,
  whyNoRemove,
  whyNoUpdate,
} from '../domain/view.ts'
import type { Ports } from '../ports.ts'
import { enqueue } from './job-runner.ts'
import type { Runtime } from './runtime.ts'

export type ActionPorts = Pick<Ports, 'state' | 'ui'>

/** The parts of the module's runtime an action reaches; absent before the first `session.start`. */
export type ActionRuntime = Pick<
  Runtime,
  'registry' | 'runner' | 'newJobId' | 'chrome' | 'catalog' | 'detector'
>

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
  /** `u`: reviews updating the selected mod, or `id`. */
  update(id?: string): Promise<void>
  /** `a`: reviews updating every mod the CLI can update. */
  updateAll(): Promise<void>
  /** `x`: reviews removing the selected mod, or `id`. */
  remove(id?: string): Promise<void>
  /** `d` on a remove's review: keep the mod's data (the default) or delete it too. */
  keepData(): Promise<void>
  /** Opens the review of what is staged. */
  apply(): Promise<void>
  /** `y` on the review: queues the batch and its reload. */
  confirm(): Promise<void>
  /** `n` on the review. */
  cancel(): Promise<void>
  /** Queues the inverse of the last batch; one that reinstalls is reviewed first. */
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
  /** The ring landed on a Discover row: it becomes the selection (the window follows). */
  focusFound(id: string): Promise<void>
  /** Enter on a Discover row: its detail (a local entry is read with `validate` first). */
  openFound(id: string): Promise<void>
  /** `i`: reviews installing the selected catalogue entry, or `id`. */
  install(id?: string): Promise<void>
  /** The install review's scope Select. */
  scope(value: string): Promise<void>
  /** `k`: the next kind filter. */
  cycleKind(): Promise<void>
  /** `o`: the next sort. */
  cycleSort(): Promise<void>
  /** `v`: reviews the declared command a stopped install or update showed. */
  acceptShown(): Promise<void>
  /** `m`: asks for a marketplace to add. */
  addMarketplace(): Promise<void>
  /** The marketplace field's Enter: reviews adding it, or says why it can't be one. */
  submitMarketplace(text: string): Promise<void>
  /** The footer's close: the same `ui.close` as Esc, origin `plugin`. */
  close(): Promise<void>
  /** Hides the band's current line. */
  dismiss(line: string): Promise<void>
  cancelJob(id: string): Promise<void>
  /**
   * Esc and the close mark (`ui.close`, origin `person`): true keeps the pane
   * open. `hadKeys` is whether the pane held the keys when it was last drawn
   * on the terminal. Esc hands the keys back to the prompt before the hook runs
   * (F45), so the cascade answers only when the pane had them then and has them
   * no more; the close mark and ctrl+x x leave them with the pane (F49) and
   * close. A kept pane re-takes the keys.
   */
  closing(origin: 'person' | 'plugin' | 'unload', hadKeys: boolean): Promise<boolean>
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

  /**
   * Opens (or re-opens) the dialog with its manners and the current title: a
   * re-open sets both anew (F22), so every open says them. Toasts are held
   * only while nothing runs (C8).
   */
  const openDialog = async (how: { focus: boolean; idle?: boolean }): Promise<void> => {
    const [attention, queue, mods, view] = await Promise.all([
      state.read('attention'),
      state.read('queue'),
      state.read('mods'),
      state.read('view'),
    ])
    const idle = how.idle ?? holdsToasts(queue, view)
    const title = titleOf(summaryOf({ attention, queue, mods }))
    await ui.open(paneOpen({ focus: how.focus, hold: idle, mods: mods.length, title }))
  }

  /** Queues a batch and its reload; `when` guards it against a queue that moved since it was read. */
  const queueBatch = async (
    specs: Parameters<typeof enqueue>[1]['specs'],
    when?: Parameters<typeof enqueue>[3],
  ): Promise<'queued' | 'stale' | 'starting'> => {
    if (rt === undefined) {
      await notice('modmgr is still starting; try again in a moment')
      return 'starting'
    }
    const queued = await enqueue(
      ports,
      { id: rt.newJobId(), specs, reload: true },
      () => rt.newJobId(),
      when,
    )
    if (!queued) return 'stale'
    // These are the dispatch's writes, not the runtime's: say so to the status line (R-M3b-12).
    rt.chrome.schedule()
    // A pane left open while jobs run must not hold other plugins' toasts (C8).
    if ((await ui.panes()).some(pane => pane.id === PANE_ID)) {
      await openDialog({ focus: false, idle: false })
    }
    rt.runner.kick()
    return 'queued'
  }

  /** Re-takes the keys after an Esc the cascade answered (the selected row's autoFocus takes the ring). */
  const retake = (): Promise<void> => openDialog({ focus: true })

  /**
   * Puts the ring on the first of `keys` the pane draws (F46: a ring whose
   * Button a redraw removed goes nowhere). `$.ui.focus` awaits an element the
   * redraw is about to draw; a denial or a refusal tries the next key.
   */
  const ringTo = async (...keys: readonly string[]): Promise<void> => {
    for (const key of keys) {
      const moved = await ui.focus(PANE_ID, key).catch(() => ({ deny: 'refused' }))
      if (!('deny' in moved) || moved.deny === undefined) return
    }
  }

  /** The ring back on the selected row once no overlay is on top. */
  const ringToSelection = async (): Promise<void> => {
    const [view, mods, page] = await Promise.all([
      state.read('view'),
      state.read('mods'),
      state.read('catalogPage'),
    ])
    if (view.stack.length > 0) return
    if (view.tab === 'discover') {
      const found = foundRow(view, page)
      if (found !== undefined) await ringTo(foundKey(found.id))
      return
    }
    const row = selectedRow(view, mods)
    if (row !== undefined) await ringTo(rowKey(row.id))
  }

  /**
   * Discover's window follows its search and selection. The catalogue is module
   * memory: a reloaded modmgr starts without it, so it is read on demand (once).
   */
  const showCatalog = async (): Promise<void> => {
    if (rt === undefined) return
    await rt.catalog.load()
    await rt.catalog.show()
  }

  /** The ring onto what an overlay offers first: its safe default (review: cancel). */
  const ringToOverlay = async (): Promise<void> => {
    const view = await state.read('view')
    const top = topOverlay(view)
    if (top === undefined) return ringToSelection()
    if (top === 'review') return ringTo('act:cancel')
    if (top === 'marketplace') return ringTo(MARKETPLACE_KEY)
    if (top === 'detail' && view.tab === 'discover') return ringTo('act:install', 'act:copy')
    if (top === 'detail') return ringTo('act:toggle', 'act:copy')
    return ringTo(top === 'help' ? 'act:help' : 'act:jobs')
  }

  const dropReview = async (): Promise<void> => {
    await state.update('review', () => null)
  }

  /** Puts a review on top, the ring on its safe default (cancel). */
  const openReview = async (review: ReviewRequest): Promise<void> => {
    await state.update('review', () => review)
    await setView(current => pushOverlay(quiet(current), 'review'))
    await ringToOverlay()
  }

  /** The row an action names, or the selected one. */
  const rowFor = async (id: string | undefined) => {
    const [view, mods] = await Promise.all([state.read('view'), state.read('mods')])
    return id === undefined ? selectedRow(view, mods) : mods.find(item => item.id === id)
  }

  return {
    tab: safely('tab', async tab => {
      await setView(view => ({ ...quiet(view), tab, stack: [] }))
      if (tab === 'discover' && rt !== undefined) {
        // Read at the first visit, then at most every few hours (PLAN §2.3).
        await rt.catalog.load()
        await rt.catalog.show()
        rt.detector.start()
      }
      await ringToSelection()
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
      await ringToOverlay()
      // Opening the detail is seeing what its update added (PLAN §2.2).
      await rt?.registry.acknowledge(id)
    }),

    back: safely('back', async () => {
      const view = await state.read('view')
      if (topOverlay(view) === 'review') await dropReview()
      await setView(current => popOverlay(quiet(current)))
      await ringToOverlay()
    }),

    toggle: safely('toggle', async id => {
      const row = await rowFor(id)
      if (row === undefined) return
      const locked = whyLocked(row)
      if (locked !== undefined) {
        await notice(`${row.name}: ${locked}`)
        return
      }
      await setView(current => stageToggle(quiet(current), row))
    }),

    update: safely('update', async id => {
      const row = await rowFor(id)
      if (row === undefined) return
      const why = whyNoUpdate(row)
      if (why !== undefined) {
        await notice(`${row.name}: ${why}`)
        return
      }
      await openReview(updateReview([row]))
    }),

    updateAll: safely('update all', async () => {
      const mods = await state.read('mods')
      const rows = mods.filter(row => whyNoUpdate(row) === undefined)
      if (rows.length === 0) {
        await notice('None of these mods updates through the CLI')
        return
      }
      await openReview(updateReview(rows))
    }),

    remove: safely('remove', async id => {
      const row = await rowFor(id)
      if (row === undefined) return
      const why = whyNoRemove(row)
      if (why !== undefined) {
        await notice(`${row.name}: ${why}`)
        return
      }
      await openReview(removeReview(row, rt?.registry.facts(row.id)))
    }),

    keepData: safely('keep data', async () => {
      await state.update('review', review =>
        review?.action === 'remove' ? { ...review, keepData: review.keepData === false } : review,
      )
    }),

    apply: safely('apply', async () => {
      const [view, mods] = await Promise.all([state.read('view'), state.read('mods')])
      const changes = stagedChanges(view, mods)
      if (changes.length === 0) {
        await setView(current => pruneStaged({ ...current, notice: 'Nothing is staged' }, mods))
        return
      }
      await openReview(toggleReview(changes, id => rt?.registry.facts(id)))
    }),

    confirm: safely('confirm', async () => {
      // Taken by compare-and-set: of two presses before the redraw (a hotkey and
      // an Enter), one gets the review and the other finds none (review R-M3a-2).
      let taken: ReviewRequest | null = null
      await state.update('review', review => {
        taken = review
        return null
      })
      const review = taken as ReviewRequest | null
      if (review === null) return
      // An undo reviewed is queued only while its batch is still the one to undo (R-M3b-8).
      const { undoes } = review
      const queued = await queueBatch(
        specsOf(review),
        undoes === undefined ? undefined : queue => stillUndoes(queue.jobs, undoes),
      )
      if (queued === 'starting') {
        await state.update('review', current => current ?? review)
        return
      }
      const ids = new Set(review.targets.map(target => target.id))
      // A removed mod's detail goes with it, and the selection moves on, or the
      // ring would land on a row the refresh is about to take away (R-M3b-8).
      const gone = review.targets.find(target => target.op === 'remove')?.id
      // An entry installed leaves the catalogue: its Discover detail goes too.
      const installed = review.action === 'install'
      const mods = await state.read('mods')
      await setView(view => {
        const staged = Object.fromEntries(
          Object.entries(view.staged).filter(([id]) => !ids.has(id)),
        )
        const stack = view.stack.filter(
          overlay =>
            overlay !== 'review' && !((gone !== undefined || installed) && overlay === 'detail'),
        )
        const next = gone === undefined ? undefined : neighbourOf(view, mods, gone)
        const moved = next === undefined ? {} : { selected: next.id }
        const said =
          queued === 'stale'
            ? { notice: 'The last batch changed since this undo was shown; nothing was queued' }
            : {}
        return { ...quiet(view), staged, stack, ...moved, ...said }
      })
      if (gone !== undefined) await select((await state.read('view')).selected)
      await ringToOverlay()
    }),

    cancel: safely('cancel', async () => {
      await dropReview()
      await setView(view => ({
        ...quiet(view),
        stack: view.stack.filter(overlay => overlay !== 'review'),
      }))
      await ringToOverlay()
    }),

    undo: safely('undo', async () => {
      const [queue, mods] = await Promise.all([state.read('queue'), state.read('mods')])
      const plan = undoPlan(queue.jobs)
      if (plan.kind === 'none') {
        await notice(plan.reason)
        return
      }
      // A reinstall runs the mod's code again: reviewed, as an install is.
      if (undoNeedsReview(plan)) {
        await openReview(undoReview(plan, mods, id => rt?.registry.facts(id)))
        return
      }
      // Two presses read one queue: only the first still finds this batch to undo (R-M3b-2).
      const queued = await queueBatch(
        plan.steps.map(step => step.spec),
        current => stillUndoes(current.jobs, plan.batch),
      )
      if (queued === 'queued') await notice(`Undoing the last batch (${plan.steps.length})`)
    }),

    refresh: safely('refresh', async () => {
      if (rt === undefined) return
      if ((await state.read('view')).tab === 'discover') {
        await rt.catalog.load({ force: true })
        rt.detector.start()
        return
      }
      await rt.registry.refresh()
      // A row the refresh flipped under a staged entry no longer changes (review R-M3a-3).
      const mods = await state.read('mods')
      await setView(view => pruneStaged(view, mods))
    }),

    reload: safely('reload', async () => {
      if (rt === undefined) return
      const batch = rt.newJobId()
      const id = rt.newJobId()
      await state.update('queue', queue => ({
        ...queue,
        jobs: prune(enqueueReload(queue.jobs, id, batch)),
      }))
      rt.chrome.schedule()
      rt.runner.kick()
    }),

    overlay: safely('overlay', async which => {
      await setView(view => toggleOverlay(quiet(view), which))
      await ringToOverlay()
    }),

    filter: safely('filter', async text => {
      if ((await state.read('view')).tab === 'discover') {
        await setView(current => ({ ...quiet(current), search: text.slice(0, 100) }))
        await showCatalog()
        return
      }
      const view = await setView(current => ({ ...quiet(current), query: text.slice(0, 100) }))
      // The split's detail follows the row the filter leaves selected.
      await select(selectedRow(view, await state.read('mods'))?.id)
    }),

    focusFilter: safely('focus filter', async () => {
      await ui.focus(PANE_ID, FILTER_KEY).catch(() => undefined)
    }),

    edge: safely('edge', async which => {
      if ((await state.read('view')).tab === 'discover') {
        await rt?.catalog.load()
        const id = rt?.catalog.edge(which)
        if (id === undefined) return
        await setView(current => ({ ...quiet(current), found: id }))
        await showCatalog()
        await ui.focus(PANE_ID, foundKey(id)).catch(() => undefined)
        return
      }
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
      await openDialog({ focus: true })
    }),

    focusFound: safely('focus found', async id => {
      const view = await state.read('view')
      if (view.found === id) return
      await setView(current => ({ ...quiet(current), found: id }))
      await showCatalog()
      // A local entry beside the list (the split) says what it can do too; read once.
      if (rt?.catalog.folderOf(id) !== undefined) await rt.catalog.inspect(id)
    }),

    openFound: safely('open found', async id => {
      await setView(view => pushOverlay({ ...quiet(view), found: id }, 'detail'))
      await showCatalog()
      await ringToOverlay()
      // A local entry is read now: the detail and the review say what it can do.
      await rt?.catalog.inspect(id)
    }),

    install: safely('install', async id => {
      if (rt === undefined) return
      await rt.catalog.load()
      const [view, page] = await Promise.all([state.read('view'), state.read('catalogPage')])
      const found = id ?? foundRow(view, page)?.id
      const entry = found === undefined ? undefined : rt.catalog.entry(found)
      if (entry === undefined) {
        await notice(
          found === undefined ? 'Select an entry to install' : `${found} is no longer listed`,
        )
        return
      }
      const inspection = await rt.catalog.inspect(entry.id)
      await openReview(installReview(entry, 'user', inspection))
    }),

    scope: safely('scope', async value => {
      if (!isInstallScope(value)) return
      await state.update('review', review => (review === null ? null : withScope(review, value)))
    }),

    cycleKind: safely('kind', async () => {
      await setView(view => ({ ...quiet(view), kind: nextKind(view.kind) }))
      await showCatalog()
    }),

    cycleSort: safely('sort', async () => {
      await setView(view => ({ ...quiet(view), sort: nextSort(view.sort) }))
      await showCatalog()
    }),

    acceptShown: safely('accept', async () => {
      const queue = await state.read('queue')
      const stopped = awaitingAcceptance(queue.jobs)
      const review = stopped === undefined ? undefined : acceptReview(stopped)
      if (review === undefined) {
        await notice('Nothing waits for a command to be reviewed')
        return
      }
      await openReview(review)
    }),

    addMarketplace: safely('add marketplace', async () => {
      await setView(view => pushOverlay(quiet(view), 'marketplace'))
      await ringToOverlay()
    }),

    submitMarketplace: safely('submit marketplace', async text => {
      const asked = marketplaceReview(text)
      if ('error' in asked) {
        await notice(asked.error)
        return
      }
      await setView(view => ({
        ...view,
        stack: view.stack.filter(overlay => overlay !== 'marketplace'),
      }))
      await openReview(asked.review)
    }),

    close: safely('close', async () => {
      await ui.close(PANE_ID)
    }),

    dismiss: safely('dismiss', async line => {
      await state.update('attention', attention => ({ ...attention, dismissed: line }))
      // A dismissal quiets the status line and the title too (R-M3b-3).
      rt?.chrome.schedule()
    }),

    cancelJob: safely('cancel job', async id => {
      await rt?.runner.cancel(id)
    }),

    async closing(origin, hadKeys) {
      try {
        const stillHasKeys =
          (await ui.panes()).find(pane => pane.id === PANE_ID)?.isFocused === true
        debug(`modmgr: close from ${origin}, keys at last draw ${hadKeys}, now ${stillHasKeys}`)
        if (origin === 'person' && hadKeys && !stillHasKeys) {
          const view = await state.read('view')
          const step = escapeStep(view, true)
          if (step.kind !== 'close') {
            if (step.kind === 'pop' && topOverlay(view) === 'review') await dropReview()
            await setView(current => {
              const now = escapeStep(current, true)
              return now.kind === 'close' ? current : quiet(now.view)
            })
            if (step.kind === 'clear-query') await showCatalog()
            await retake()
            await ringToOverlay()
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
