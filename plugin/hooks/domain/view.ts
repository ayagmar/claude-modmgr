// The pane's logic as pure functions (PLAN §5): which rows show, the staged
// toggles and the review they become, the Esc cascade, the band's line and
// the status line. services/actions.ts applies them to `$.state`; ui/ draws
// what they return.

import type {
  Attention,
  Job,
  JobQueue,
  ModRow,
  Overlay,
  ReviewRequest,
  Scope,
  View,
} from '../../types/index.d.ts'
import { argvOf, commandOfJob } from './argv.ts'
import { notableText } from './capabilities.ts'
import type { JobSpec } from './jobs.ts'
import { sanitize } from './sanitize.ts'

/** The one pane modmgr opens. */
export const PANE_ID = 'modmgr'
export const PANE_TITLE = 'mods'

/** From this many body columns the list and the detail sit side by side (PLAN §5.2). */
export const SPLIT_MIN_COLUMNS = 100

export type Layout = 'stacked' | 'split'

/** The filter field's key. */
export const FILTER_KEY = 'filter'

/** A row's Button key: what `ui.focus` and `ui.press` name. */
export const ROW_PREFIX = 'row:'
export const rowKey = (id: string): string => `${ROW_PREFIX}${id}`
/** The mod id a focused element names, when it is a row. */
export const rowOfKey = (key: string | undefined): string | undefined =>
  key?.startsWith(ROW_PREFIX) === true ? key.slice(ROW_PREFIX.length) : undefined

export const layoutFor = (bodyColumns: number): Layout =>
  bodyColumns >= SPLIT_MIN_COLUMNS ? 'split' : 'stacked'

/** How a dialog open asks (C8): `holdToasts` only while nothing streams. */
export type PaneOpen = {
  readonly id: string
  readonly title: string
  readonly closeOnEscape: true
  readonly focus?: true
  readonly holdToasts?: true
  readonly rows?: number
}

/**
 * Rows a dialog asks for inline: the list plus its chrome, at least 14 (a
 * detail or a review is taller than a short list), never more than 24.
 */
export const rowsFor = (mods: number): number => Math.min(24, Math.max(14, mods + 6))

export const paneOpen = (how: {
  readonly focus: boolean
  readonly hold: boolean
  readonly mods: number
  readonly title?: string
}): PaneOpen => ({
  id: PANE_ID,
  title: how.title ?? PANE_TITLE,
  closeOnEscape: true,
  rows: rowsFor(how.mods),
  ...(how.focus ? { focus: true as const } : {}),
  ...(how.hold ? { holdToasts: true as const } : {}),
})

// ---- rows -------------------------------------------------------------------

/** Installed rows matching the filter: by name or id, case-insensitive. */
export const filterRows = (rows: readonly ModRow[], query: string): ModRow[] => {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...rows]
  return rows.filter(
    row => row.name.toLowerCase().includes(needle) || row.id.toLowerCase().includes(needle),
  )
}

/** The rows `[start, end)` a window of `size` shows. */
export type Window = { readonly start: number; readonly end: number }

/**
 * A window of `size` rows over `count`, centred on `index` where the list
 * allows, so the rows on either side of the focused one are always drawn and
 * the arrows walk onto them (the ring moves only between drawn elements).
 */
export const windowAround = (count: number, index: number, size: number): Window => {
  const rows = Math.max(1, Math.floor(size))
  if (count <= rows) return { start: 0, end: Math.max(0, count) }
  const at = Math.min(Math.max(0, index), count - 1)
  const start = Math.min(Math.max(0, at - Math.floor((rows - 1) / 2)), count - rows)
  return { start, end: start + rows }
}

/** `6–15 of 40`, or undefined when every row shows. */
export const pagerLabel = (window: Window, count: number): string | undefined =>
  window.start === 0 && window.end >= count
    ? undefined
    : `${window.start + 1}–${window.end} of ${count}`

/** The selected row's index among `rows`, 0 when it isn't there. */
export const selectedIndex = (rows: readonly ModRow[], selected: string | undefined): number => {
  const index = rows.findIndex(row => row.id === selected)
  return index < 0 ? 0 : index
}

/**
 * The row the pane shows as selected and every action acts on (review
 * R-M3a-1): the selection when the filter shows it, else the first row shown.
 * One resolver, so the drawing and a press never disagree.
 */
export const selectedRow = (view: View, mods: readonly ModRow[]): ModRow | undefined => {
  const rows = filterRows(mods, view.query)
  return rows.find(row => row.id === view.selected) ?? rows[0]
}

// ---- staging ----------------------------------------------------------------

/**
 * Stages a toggle of `row`: flips what it will be after apply. Staging it
 * back to its current state un-stages it. A row the CLI can't toggle (F17) is
 * left alone.
 */
export const stageToggle = (view: View, row: ModRow): View => {
  if (!row.toggleable) return view
  const { [row.id]: current, ...rest } = view.staged
  const target = !(current ?? row.enabled)
  return { ...view, staged: target === row.enabled ? rest : { ...rest, [row.id]: target } }
}

export type Change = { readonly row: ModRow; readonly enable: boolean }

/** The staged toggles that still change something, in row order. */
export const stagedChanges = (view: View, rows: readonly ModRow[]): Change[] =>
  rows.flatMap(row => {
    const enable = view.staged[row.id]
    return enable === undefined || enable === row.enabled || !row.toggleable
      ? []
      : [{ row, enable }]
  })

/** The ids whose staged entry still changes something: what rows and the detail mark as staged. */
export const stagedIds = (view: View, rows: readonly ModRow[]): ReadonlySet<string> =>
  new Set(stagedChanges(view, rows).map(change => change.row.id))

/** Drops staged entries that no longer change anything (a refresh moved under them). */
export const pruneStaged = (view: View, rows: readonly ModRow[]): View => {
  const kept = Object.fromEntries(stagedChanges(view, rows).map(c => [c.row.id, c.enable]))
  return Object.keys(kept).length === Object.keys(view.staged).length
    ? view
    : { ...view, staged: kept }
}

/** Why a row can't be toggled from here, in the person's terms (PLAN §2.1); undefined when it can. */
export const whyLocked = (row: ModRow): string | undefined => {
  if (row.toggleable) return undefined
  if (row.scope === 'managed') return "managed by your organisation; it can't be turned off here"
  if (row.origin === 'env-dir')
    return 'loaded from CLAUDE_CODE_PLUGIN_DIRS; take it out of that variable and restart to stop loading it'
  if (row.origin === 'plugin-dir')
    return 'loaded with --plugin-dir; leave the flag out of your launch command to stop loading it'
  return "this session loaded it from its launch command; it can't be toggled here"
}

const toggleScope = (scope: Scope | undefined): 'user' | 'project' | 'local' | undefined =>
  scope === 'user' || scope === 'project' || scope === 'local' ? scope : undefined

/** What a review needs to know about one mod beyond its row. */
export type ReviewFacts = {
  readonly notable: readonly string[]
  readonly parts?: { readonly skills: number; readonly agents: number; readonly mcp: number }
}

/** The review a batch of toggles opens (PLAN §5.3): one confirm for the whole batch. */
export const toggleReview = (
  changes: readonly Change[],
  facts: (id: string) => ReviewFacts | undefined,
): ReviewRequest => {
  const notable: string[] = []
  const also = { skills: 0, agents: 0, mcp: 0 }
  for (const { row, enable } of changes) {
    const known = facts(row.id)
    if (enable) {
      for (const id of known?.notable ?? []) notable.push(`${row.name}: ${notableText(id)}`)
    } else if (known?.parts !== undefined) {
      also.skills += known.parts.skills
      also.agents += known.parts.agents
      also.mcp += known.parts.mcp
    }
  }
  const review: ReviewRequest = {
    action: 'toggle',
    targets: changes.map(({ row, enable }) => {
      const scope = toggleScope(row.scope)
      return scope === undefined ? { id: row.id, enable } : { id: row.id, scope, enable }
    }),
    notable,
    changesRepoFile: changes.some(({ row }) => row.scope === 'project' || row.scope === 'local'),
  }
  return also.skills + also.agents + also.mcp > 0 ? { ...review, alsoDisables: also } : review
}

/** The jobs a confirmed toggle review queues (the batch's reload is added by `enqueue`). */
export const specsOf = (review: ReviewRequest): JobSpec[] =>
  review.targets.map(target => {
    const kind = target.enable === false ? 'disable' : 'enable'
    const scope = toggleScope(target.scope)
    return scope === undefined
      ? { kind, target: target.id }
      : { kind, target: target.id, args: { scope } }
  })

/** The CLI line a job runs, for the review's "Runs" lines; undefined when it can't be built. */
export const commandLine = (spec: JobSpec): string | undefined => {
  const job: Job = { id: 'review', kind: spec.kind, state: 'queued', tail: [] }
  const command = commandOfJob({
    ...job,
    ...(spec.target === undefined ? {} : { target: spec.target }),
    ...(spec.args === undefined ? {} : { args: spec.args }),
  })
  return command.ok ? argvOf(command.value).join(' ') : undefined
}

/** `2 skills, 1 MCP server`; empty when there is nothing. */
export const partsLabel = (parts: {
  readonly skills: number
  readonly agents: number
  readonly mcp: number
}): string => {
  const say = (n: number, one: string, many: string) =>
    n === 0 ? [] : [`${n} ${n === 1 ? one : many}`]
  return [
    ...say(parts.skills, 'skill', 'skills'),
    ...say(parts.agents, 'agent', 'agents'),
    ...say(parts.mcp, 'MCP server', 'MCP servers'),
  ].join(', ')
}

// ---- overlays and Esc -------------------------------------------------------

export const topOverlay = (view: View): Overlay | undefined => view.stack.at(-1)

/** Pushes an overlay; one already on the stack moves to the top instead of repeating. */
export const pushOverlay = (view: View, overlay: Overlay): View => ({
  ...view,
  stack: [...view.stack.filter(item => item !== overlay), overlay],
})

export const popOverlay = (view: View): View =>
  view.stack.length === 0 ? view : { ...view, stack: view.stack.slice(0, -1) }

/** Opens an overlay, or closes it when it is already on top (the `h` and `j` keys). */
export const toggleOverlay = (view: View, overlay: Overlay): View =>
  topOverlay(view) === overlay ? popOverlay(view) : pushOverlay(view, overlay)

export type Escape =
  | { readonly kind: 'pop'; readonly view: View }
  | { readonly kind: 'clear-query'; readonly view: View }
  | { readonly kind: 'close' }

/**
 * What an Esc does (PLAN §5.2, review M10): while the pane holds the keys it
 * pops the top overlay, then clears the filter, then closes. An Esc at the
 * prompt (the pane not focused) always closes: the person can't see what a
 * cascade would pop.
 */
export const escapeStep = (view: View, paneFocused: boolean): Escape => {
  if (!paneFocused) return { kind: 'close' }
  if (view.stack.length > 0) return { kind: 'pop', view: popOverlay(view) }
  if (view.query !== '') return { kind: 'clear-query', view: { ...view, query: '' } }
  return { kind: 'close' }
}

/** The view a closed pane leaves: no overlays, no review half-done; staged toggles stay. */
export const closedView = (view: View): View => {
  const { notice: _notice, ...rest } = view
  return { ...rest, stack: [] }
}

// ---- jobs: the status line and the band ----------------------------------------

const describeJob = (job: Job): string => {
  const what = job.kind === 'reload' ? 'reload plugins' : job.kind
  return job.target === undefined ? what : `${what} ${sanitize(job.target, { max: 60 })}`
}

/** The jobs of the newest batch, oldest first. */
export const latestBatch = (jobs: readonly Job[]): Job[] => {
  const batch = jobs.findLast(job => job.batch !== undefined)?.batch
  return batch === undefined ? [] : jobs.filter(job => job.batch === batch)
}

export type Status = {
  readonly tone: 'busy' | 'ok' | 'error'
  readonly text: string
}

/**
 * One line about the newest batch: what runs now, or how it ended. A failure
 * stays until the next batch; a success shows only while `showDone` (the
 * band's echo of the reload, which the runner clears after a while: that write
 * is what redraws the pane, review R-M3a-4).
 */
export const statusOf = (queue: JobQueue, showDone: boolean): Status | undefined => {
  const jobs = latestBatch(queue.jobs)
  if (jobs.length === 0) return undefined
  const running = jobs.find(job => job.state === 'running')
  const work = jobs.filter(job => job.kind !== 'reload')
  const done = work.filter(job => job.state !== 'queued' && job.state !== 'running').length
  if (running !== undefined) {
    return running.kind === 'reload'
      ? { tone: 'busy', text: 'reloading plugins…' }
      : { tone: 'busy', text: `${describeJob(running)} (${done + 1} of ${work.length})…` }
  }
  if (jobs.some(job => job.state === 'queued')) {
    return work.every(job => job.state !== 'queued')
      ? { tone: 'busy', text: 'reload waits for the settings to settle…' }
      : { tone: 'busy', text: `${work.length} changes queued…` }
  }
  const failed = jobs.filter(job => job.state === 'failed' || job.state === 'interrupted')
  if (failed.length > 0) {
    const first = failed[0]
    const why = first?.error?.message === undefined ? '' : `: ${first.error.message}`
    return {
      tone: 'error',
      text: `${failed.length} of ${jobs.length} failed (${describeJob(first as Job)}${why})`,
    }
  }
  if (!showDone) return undefined
  const reload = jobs.find(job => job.kind === 'reload')
  if (work.length === 0) return { tone: 'ok', text: 'plugins reloaded' }
  const applied = `${work.length} ${work.length === 1 ? 'change' : 'changes'} applied`
  return {
    tone: 'ok',
    text: reload?.state === 'ok' ? `${applied}, plugins reloaded` : applied,
  }
}

export type Band = {
  /** What was said: a dismissal hides the band until this changes. */
  readonly key: string
  readonly text: string
  /** Offer `[l reload]`: a reload is owed and none is queued. */
  readonly reload: boolean
}

/**
 * The band's one line (PLAN §5.4, C8): shown only when something is
 * actionable and that very thing wasn't dismissed. `isWorking` is the band's
 * `e.props.isWorking`: a reload asked mid-turn waits for the turn to end.
 */
export const bandOf = (input: {
  readonly attention: Attention
  readonly queue: JobQueue
  readonly isWorking: boolean
}): Band | undefined => {
  const { attention, queue, isWorking } = input
  const reloadJob = queue.jobs.find(
    job => job.kind === 'reload' && (job.state === 'queued' || job.state === 'running'),
  )
  const busy = queue.jobs.find(job => job.kind !== 'reload' && job.state === 'running')
  const parts: string[] = []
  if (busy !== undefined) parts.push(`${describeJob(busy)}…`)
  if (reloadJob?.state === 'running') {
    parts.push(isWorking ? 'reload queued, runs when the turn ends' : 'reloading plugins…')
  }
  if (attention.updates > 0) {
    parts.push(`${attention.updates} ${attention.updates === 1 ? 'update' : 'updates'}`)
  }
  if (attention.capsChanged > 0) parts.push(`${attention.capsChanged} with new capabilities`)
  const reload = attention.reloadPending && reloadJob === undefined
  if (reload) parts.push('reload to apply')
  if (parts.length === 0) {
    if (attention.lastReload === undefined) return undefined
    parts.push(attention.lastReload)
  }
  const text = `mods · ${parts.join(' · ')}`
  if (attention.dismissed === text) return undefined
  return { key: text, text, reload }
}
