// What the pane's Buttons, its Input, the band and the focus ring do:
// each reads and writes `$.state` through the dispatch's own ports, then asks
// the module's runtime to run what it queued (`kick`). No job ever runs here.
// Every action catches its own failure: a press must never throw into the host.

import type { RenderSurface } from 'claude-code'
import type { DevRow, ReviewRequest, Tab, View } from '../../types/index.d.ts'
import { type DevRunKind, devKey, devRowOf, lastRun } from '../domain/dev.ts'
import {
  acceptReview,
  awaitingAcceptance,
  communityInstallReview,
  foundKey,
  foundRow,
  installReview,
  isInstallScope,
  MARKETPLACE_KEY,
  marketplaceReview,
  nextSort,
  withScope,
} from '../domain/discover.ts'
import { type HealthItem, healthItemsOf, healthKey } from '../domain/health.ts'
import {
  enqueueReload,
  isActive,
  prune,
  stillUndoes,
  undoNeedsReview,
  undoPlan,
} from '../domain/jobs.ts'
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
  scrolledAt,
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
  | 'registry'
  | 'showTab'
  | 'runner'
  | 'newJobId'
  | 'chrome'
  | 'catalog'
  | 'detector'
  | 'dev'
  | 'health'
  | 'updater'
  | 'store'
>

/** What Health's "check now" says, by what the scheduler did. */
const CHECK_SAID: Readonly<Record<'queued' | 'busy' | 'off' | 'nothing', string>> = {
  queued: 'Checking the marketplaces for updates…',
  busy: 'Busy now (a turn or a reload); try again in a moment',
  off: 'Update checks are off',
  nothing: 'No installed mod comes from a marketplace that updates',
}

export type Actions = {
  tab(tab: Tab): Promise<void>
  /** The focus ring landed on a row: it becomes the selection (the split's detail follows). */
  focusRow(id: string): Promise<void>
  /** Enter on a row: its detail. */
  open(id: string): Promise<void>
  /**
   * Enter on a row whose detail is already beside the list: the ring moves onto
   * the detail's first key. Nothing is pushed, so Esc has nothing hidden to pop.
   */
  toDetail(): Promise<void>
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
  /**
   * The wheel, j and k, the page keys: moves the selection `by` rows (negative: up),
   * the ring with it; over a review, its lines, no further than `last`.
   */
  scroll(by: number, last?: number): Promise<void>
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
  /** `o`: the next sort. */
  cycleSort(): Promise<void>
  /** `k`: Discover lists only your marketplaces' entries, or everything again. */
  toggleMine(): Promise<void>
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
  /** The ring landed on a Dev row: it becomes Dev's selection (the split's detail follows). */
  focusDev(key: string): Promise<void>
  /** Enter on a Dev row: its detail. */
  openDev(key: string): Promise<void>
  /** `v` / `t` on Dev: validates (`--strict`) or tests the selected dev mod, or `key`. */
  devRun(kind: DevRunKind, key?: string): Promise<void>
  /** `p` on Dev: how to share the selected dev mod, or `key`. */
  share(key?: string): Promise<void>
  /** The ring landed on a Health item: it becomes Health's selection. */
  focusHealth(key: string): Promise<void>
  /** A Health item's fix: its button in the detail. */
  fix(key: string): Promise<void>
  /** Enter on a Health item, stacked: the item whole (its row is clipped), its fix a button. */
  openHealth(key: string): Promise<void>
  /**
   * Esc and the close mark (`ui.close`, origin `person`): true keeps the pane
   * open. `hadKeys` is whether the pane held the keys when it was last drawn
   * on the terminal. Esc hands the keys back to the prompt before the hook runs
   * is raised, so the cascade answers only when the pane had them then and has them
   * no more; the close mark and ctrl+x x leave them with the pane and
   * close. A kept pane re-takes the keys. `ringAway`: the ring was on a key
   * rather than the list or its field, so this Esc brings it back to the list.
   */
  closing(
    origin: 'person' | 'plugin' | 'unload',
    hadKeys: boolean,
    ringAway?: boolean,
  ): Promise<boolean>
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
   * re-open sets both anew, so every open says them. Toasts are held
   * only while nothing runs.
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
    await ui.open(
      paneOpen({ focus: how.focus, hold: idle, mods: mods.length, title, dock: view.dock }),
    )
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
    // These are the dispatch's writes, not the runtime's: say so to the status line.
    rt.chrome.schedule()
    // A pane left open while jobs run must not hold other plugins' toasts.
    if ((await ui.panes()).some(pane => pane.id === PANE_ID)) {
      await openDialog({ focus: false, idle: false })
    }
    rt.runner.kick()
    return 'queued'
  }

  /** Re-takes the keys after an Esc the cascade answered (the selected row's autoFocus takes the ring). */
  const retake = (): Promise<void> => openDialog({ focus: true })

  /**
   * Puts the ring on the first of `keys` the pane draws (a ring whose
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
    if (view.tab === 'dev') {
      const row = devRowOf(view.dev, (await state.read('dev')).rows)
      if (row !== undefined) await ringTo(devKey(row.key))
      return
    }
    if (view.tab === 'health') {
      const items = await healthItems()
      const item = items.find(each => each.key === view.health) ?? items[0]
      if (item !== undefined) await ringTo(healthKey(item.key))
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

  /**
   * Moves the selection to the row `choose` picks, given how many rows the tab
   * lists and the selected one's index (held to the ends), and the ring with it.
   * Health's few items have no rows to page through.
   */
  const moveSelection = async (choose: (count: number, at: number) => number): Promise<void> => {
    const pick = (count: number, at: number) => Math.max(0, Math.min(count - 1, choose(count, at)))
    const view = await state.read('view')
    if (view.tab === 'health') {
      const items = await healthItems()
      const current = items.findIndex(each => each.key === view.health)
      const item = items[pick(items.length, Math.max(0, current))]
      if (item === undefined || item === items[current]) return
      await setView(shown => ({ ...quiet(shown), health: item.key }))
      await ui.focus(PANE_ID, healthKey(item.key)).catch(() => undefined)
      return
    }
    if (view.tab === 'dev') {
      const { rows } = await state.read('dev')
      const current = devRowOf(view.dev, rows)
      const row = rows[pick(rows.length, current === undefined ? 0 : rows.indexOf(current))]
      if (row === undefined || row === current) return
      await setView(shown => ({ ...quiet(shown), dev: row.key }))
      await ui.focus(PANE_ID, devKey(row.key)).catch(() => undefined)
      return
    }
    if (view.tab === 'discover') {
      await rt?.catalog.load()
      const id = rt?.catalog.pick(view.found, pick)
      if (id === undefined || id === view.found) return
      await setView(shown => ({ ...quiet(shown), found: id }))
      await showCatalog()
      await ui.focus(PANE_ID, foundKey(id)).catch(() => undefined)
      return
    }
    const mods = await state.read('mods')
    const rows = filterRows(mods, view.query)
    const current = selectedRow(view, mods)
    const row = rows[pick(rows.length, current === undefined ? 0 : rows.indexOf(current))]
    if (row === undefined || row === current) return
    await setView(shown => ({ ...quiet(shown), selected: row.id }))
    await select(row.id)
    // The row may be drawn only after the redraw this write causes; focus awaits it.
    await ui.focus(PANE_ID, rowKey(row.id)).catch(() => undefined)
  }

  /** The ring onto what an overlay offers first: its safe default (review: cancel). */
  const ringToOverlay = async (): Promise<void> => {
    const view = await state.read('view')
    const top = topOverlay(view)
    if (top === undefined) return ringToSelection()
    if (top === 'review') return ringTo('act:cancel')
    if (top === 'marketplace') return ringTo(MARKETPLACE_KEY)
    if (top === 'detail' && view.tab === 'discover') return ringTo('act:install', 'act:copy')
    if (top === 'detail' && view.tab === 'dev') return ringTo('act:validate', 'act:copy')
    if (top === 'detail' && view.tab === 'health') return ringTo('act:fix', 'act:back')
    if (top === 'share') return ringTo('act:copy')
    if (top === 'welcome') return ringTo('act:start')
    if (top === 'detail') return ringTo('act:toggle', 'act:copy')
    return ringTo(top === 'help' ? 'act:help' : 'act:jobs')
  }

  const dropReview = async (): Promise<void> => {
    await state.update('review', () => null)
  }

  /** Puts a review on top, the ring on its safe default (cancel). */
  const openReview = async (review: ReviewRequest): Promise<void> => {
    await state.update('review', () => review)
    // A new review starts at its top.
    await setView(current => pushOverlay(quiet(current), 'review'))
    await ringToOverlay()
  }

  /** Health's items as the pane draws them. */
  const healthItems = async (): Promise<HealthItem[]> => {
    const [mods, attention, degraded, sync, detect, queue, facts] = await Promise.all([
      state.read('mods'),
      state.read('attention'),
      state.read('degraded'),
      state.read('sync'),
      state.read('detect'),
      state.read('queue'),
      state.read('health'),
    ])
    return healthItemsOf({ mods, attention, degraded, sync, detect, queue, facts })
  }

  /** The welcome on the stack is being left: it isn't said again. */
  const seenWelcome = (view: View): void => {
    if (!view.stack.includes('welcome')) return
    rt?.store.update('prefs', prefs =>
      prefs.firstRunDone ? prefs : { ...prefs, firstRunDone: true },
    )
  }

  /** The tab and sort a next session opens with (the store's prefs, written in a batch). */
  const remember = (view: View): void => {
    rt?.store.update('prefs', prefs =>
      prefs.tab === view.tab && prefs.sort === view.sort
        ? prefs
        : { ...prefs, tab: view.tab, sort: view.sort },
    )
  }

  /** The Dev row an action names, or the selected one. */
  const devRowFor = async (key: string | undefined): Promise<DevRow | undefined> => {
    const [view, dev] = await Promise.all([state.read('view'), state.read('dev')])
    return key === undefined ? devRowOf(view.dev, dev.rows) : dev.rows.find(row => row.key === key)
  }

  /** The row an action names, or the selected one. */
  const rowFor = async (id: string | undefined) => {
    const [view, mods] = await Promise.all([state.read('view'), state.read('mods')])
    return id === undefined ? selectedRow(view, mods) : mods.find(item => item.id === id)
  }

  const actions: Actions = {
    tab: safely('tab', async tab => {
      // A review on the stack and in state go together.
      await dropReview()
      const view = await setView(current => ({ ...quiet(current), tab, stack: [] }))
      remember(view)
      await rt?.showTab(tab)
      await ringToSelection()
    }),

    focusRow: safely('focus', async id => {
      const view = await state.read('view')
      if (view.selected === id) return
      await setView(current => ({ ...quiet(current), selected: id }))
      await select(id)
    }),

    toDetail: safely('to detail', async () => {
      const { tab } = await state.read('view')
      if (tab === 'discover') return ringTo('act:install', 'act:copy')
      if (tab === 'dev') return ringTo('act:validate', 'act:copy')
      return ringTo('act:toggle', 'act:copy')
    }),

    open: safely('open', async id => {
      await setView(view => pushOverlay({ ...quiet(view), selected: id }, 'detail'))
      await select(id)
      await ringToOverlay()
      // Opening the detail is seeing what its update added.
      await rt?.registry.acknowledge(id)
    }),

    back: safely('back', async () => {
      const view = await state.read('view')
      if (topOverlay(view) === 'review') await dropReview()
      seenWelcome(view)
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
      // an Enter), one gets the review and the other finds none.
      let taken: ReviewRequest | null = null
      await state.update('review', review => {
        taken = review
        return null
      })
      const review = taken as ReviewRequest | null
      if (review === null) return
      // An undo reviewed is queued only while its batch is still the one to undo.
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
      // ring would land on a row the refresh is about to take away.
      const gone = review.targets.find(target => target.op === 'remove')?.id
      // An entry installed leaves the catalogue: its Discover detail goes too.
      const installed = review.action === 'install' && (await state.read('view')).tab === 'discover'
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
      // Two presses read one queue: only the first still finds this batch to undo.
      const queued = await queueBatch(
        plan.steps.map(step => step.spec),
        current => stillUndoes(current.jobs, plan.batch),
      )
      if (queued === 'queued') await notice(`Undoing the last batch (${plan.steps.length})`)
    }),

    refresh: safely('refresh', async () => {
      if (rt === undefined) return
      const { tab } = await state.read('view')
      if (tab === 'dev' || tab === 'health') {
        await rt.registry.refresh()
        await rt.showTab(tab)
        return
      }
      if (tab === 'discover') {
        await rt.catalog.load({ force: true })
        rt.detector.start()
        return
      }
      await rt.registry.refresh()
      // A row the refresh flipped under a staged entry no longer changes.
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
      await moveSelection(count => (which === 'first' ? 0 : count - 1))
    }),

    scroll: safely('scroll', async (by, last = 0) => {
      const view = await state.read('view')
      const top = topOverlay(view)
      // Over an overlay the wheel scrolls it, as far as its last line; the list isn't under it.
      if (top !== undefined) {
        const from = scrolledAt(view, top)
        const at = Math.max(0, Math.min(last, from + by))
        if (at !== from) await setView(current => ({ ...current, overlayAt: { overlay: top, at } }))
        return
      }
      await moveSelection((_count, at) => at + by)
    }),

    copy: safely('copy', async (text, surface) => {
      const copied = await ui.copy(text, surface)
      await notice(copied.isCopied ? `Copied ${text}` : `Couldn't copy: ${copied.reason}`)
    }),

    openPane: safely('open pane', async () => {
      await openDialog({ focus: true })
      // A restored tab is read when the dialog shows it.
      void rt?.showTab((await state.read('view')).tab)
    }),

    focusFound: safely('focus found', async id => {
      const view = await state.read('view')
      if (view.found === id) return
      const { offset } = await state.read('catalogPage')
      await setView(current => ({ ...quiet(current), found: id }))
      await showCatalog()
      // The window around the selection moved: the engine keeps the ring at its
      // place among the rows, now another row's, so it goes back onto this one.
      // Not awaited: this runs inside the ring's own move.
      if ((await state.read('catalogPage')).offset !== offset) {
        void ui.focus(PANE_ID, foundKey(id)).catch(() => undefined)
      }
      // A local entry beside the list (the split) says what it can do too: read in
      // the background, never on the ring's path; the redraw follows.
      void rt?.catalog.inspect(id)
    }),

    openFound: safely('open found', async id => {
      await setView(view => pushOverlay({ ...quiet(view), found: id }, 'detail'))
      await showCatalog()
      await ringToOverlay()
      // A local entry is read now: the detail redraws when it lands.
      void rt?.catalog.inspect(id)
    }),

    install: safely('install', async id => {
      if (rt === undefined) return
      await rt.catalog.load()
      const [view, page] = await Promise.all([state.read('view'), state.read('catalogPage')])
      const found = id ?? foundRow(view, page)?.id
      const mod = found === undefined ? undefined : rt.catalog.mod(found)
      if (mod !== undefined) {
        const review = communityInstallReview(mod, 'user')
        if (review === undefined) {
          await notice(`No marketplace lists ${mod.name}: c copies its link`)
          return
        }
        await openReview(review)
        return
      }
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

    cycleSort: safely('sort', async () => {
      remember(await setView(view => ({ ...quiet(view), sort: nextSort(view.sort) })))
      await showCatalog()
    }),

    toggleMine: safely('mine', async () => {
      await setView(view => ({ ...quiet(view), mine: view.mine !== true }))
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
      // A dismissal quiets the status line and the title too.
      rt?.chrome.schedule()
    }),

    cancelJob: safely('cancel job', async id => {
      await rt?.runner.cancel(id)
    }),

    focusDev: safely('focus dev', async key => {
      const view = await state.read('view')
      if (view.dev === key) return
      await setView(current => ({ ...quiet(current), dev: key }))
    }),

    openDev: safely('open dev', async key => {
      await setView(view => pushOverlay({ ...quiet(view), dev: key }, 'detail'))
      await ringToOverlay()
    }),

    devRun: safely('dev run', async (kind, key) => {
      const row = await devRowFor(key)
      if (row === undefined) return
      const { path } = row
      // One validate (or test) of a folder at a time: a second press says so.
      const running = lastRun((await state.read('queue')).jobs, kind, path)
      if (running !== undefined && isActive(running)) {
        await notice(
          `${row.name}: ${kind === 'test' ? 'its tests are' : 'it is being validated'} already`,
        )
        return
      }
      await queueBatch(
        [{ kind, target: row.id ?? row.name, args: { path } }],
        queue =>
          !queue.jobs.some(job => isActive(job) && job.kind === kind && job.args?.path === path),
      )
    }),

    share: safely('share', async key => {
      const row = await devRowFor(key)
      if (row === undefined || rt === undefined) return
      if ((await rt.dev.share(row.key)) === undefined) return
      await setView(view => pushOverlay({ ...quiet(view), dev: row.key }, 'share'))
      await ringToOverlay()
    }),

    openHealth: safely('open health', async key => {
      await setView(view => pushOverlay({ ...quiet(view), health: key }, 'detail'))
      await ringToOverlay()
    }),

    focusHealth: safely('focus health', async key => {
      const view = await state.read('view')
      if (view.health === key) return
      await setView(current => ({ ...quiet(current), health: key }))
    }),

    fix: safely('fix', async key => {
      const item = (await healthItems()).find(each => each.key === key)
      const fix = item?.fix
      if (fix === undefined || rt === undefined) return
      // The item's detail, when it was open, has done its job.
      await setView(current => ({
        ...quiet(current),
        health: key,
        stack: current.stack.filter(overlay => overlay !== 'detail'),
      }))
      switch (fix.kind) {
        case 'open':
          // What a mod can do, and its errors, are in its Installed detail.
          await setView(view => ({ ...view, tab: 'installed', stack: [] }))
          await actions.open(fix.id)
          return
        case 'update':
          await actions.update(fix.id)
          return
        case 'copy':
          await actions.copy(fix.text)
          return
        case 'reload':
          await actions.reload()
          return
        case 'refresh':
          await actions.refresh()
          return
        case 'clear-cache': {
          const cleared = await rt.store.clearCaches()
          await notice(
            cleared.ok ? 'Cache cleared' : `Couldn't clear the cache: ${cleared.error.message}`,
          )
          await rt.health.refresh()
          return
        }
        case 'check-updates': {
          const outcome = await rt.updater.run()
          await notice(CHECK_SAID[outcome])
          await rt.health.refresh()
          return
        }
      }
    }),

    async closing(origin, hadKeys, ringAway = false) {
      try {
        const stillHasKeys =
          (await ui.panes()).find(pane => pane.id === PANE_ID)?.isFocused === true
        debug(`modmgr: close from ${origin}, keys at last draw ${hadKeys}, now ${stillHasKeys}`)
        const before = await state.read('view')
        // Closed or popped, the welcome was on screen: seen.
        seenWelcome(before)
        if (origin === 'person' && hadKeys && !stillHasKeys) {
          const view = before
          const step = escapeStep(view, true, ringAway)
          if (step.kind !== 'close') {
            if (step.kind === 'pop' && topOverlay(view) === 'review') await dropReview()
            if (step.kind !== 'to-list') {
              await setView(current => {
                const now = escapeStep(current, true, ringAway)
                return now.kind === 'pop' || now.kind === 'clear-query' ? quiet(now.view) : current
              })
            }
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
  return actions
}
