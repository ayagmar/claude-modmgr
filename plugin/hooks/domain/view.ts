// The pane's logic as pure functions: which rows show, the staged
// toggles and the review they become, the Esc cascade, the band's line and
// the status line. services/actions.ts applies them to `$.state`; ui/ draws
// what they return.

import type {
  Attention,
  Job,
  JobQueue,
  ModRow,
  Overlay,
  ReviewOp,
  ReviewRequest,
  ReviewTarget,
  Scope,
  View,
} from '../../types/index.d.ts'
import { argvOf, commandOfJob } from './argv.ts'
import { notableText } from './capabilities.ts'
import { capsLine } from './caps-history.ts'
import { isActive, type JobSpec, NEEDS_RELOAD, type UndoStep } from './jobs.ts'
import { sanitize } from './sanitize.ts'

/** The name part of a plugin id (`turn-band` of `turn-band@fixtures`). */
export const nameOf = (id: string): string => {
  const at = id.indexOf('@')
  return at < 0 ? id : id.slice(0, at)
}

/** The one pane modmgr opens. */
export const PANE_ID = 'modmgr'
export const PANE_TITLE = 'mods'

/** From this many body columns the list and the detail sit side by side. */
export const SPLIT_MIN_COLUMNS = 80

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

/** The list's columns beside the detail: about two fifths, never cramped or sprawling. */
export const listColumnsFor = (bodyColumns: number): number =>
  Math.max(28, Math.min(46, Math.floor(bodyColumns * 0.4)))

/** How a dialog open asks: `holdToasts` only while nothing streams. */
export type PaneOpen = {
  readonly id: string
  readonly title: string
  readonly closeOnEscape: true
  readonly focus?: true
  readonly holdToasts?: true
  readonly rows?: number
  readonly columns?: number
}

/**
 * Rows a dialog asks for inline: the list plus its chrome, at least 14 (a
 * detail or a review is taller than a short list), never more than 24.
 */
export const rowsFor = (mods: number): number => Math.min(24, Math.max(14, mods + 6))

/** Columns a docked dialog asks for: room for the list and the detail side by side. */
export const DOCK_COLUMNS = 96

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
  columns: DOCK_COLUMNS,
  ...(how.focus ? { focus: true as const } : {}),
  ...(how.hold ? { holdToasts: true as const } : {}),
})

/**
 * Whether an open of the dialog holds other plugins' toasts: only while
 * nothing runs or waits and the job log isn't on top, since a pane that stays
 * open must not silence them for long.
 */
export const holdsToasts = (queue: JobQueue, view: View): boolean =>
  !queue.jobs.some(isActive) && view.stack.at(-1) !== 'jobs'

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

/**
 * A window of `size` rows over `count` that stays where it was (`previous`, its
 * first row) while `index` moves inside it, and shifts only as far as needed
 * when `index` reaches its edge, keeping one row beyond the selection drawn. So
 * the highlight moves down a still list, as in any list, instead of the list
 * moving under it at every key. With no previous window it centres on `index`.
 */
export const windowFollowing = (
  previous: number | undefined,
  count: number,
  index: number,
  size: number,
): Window => {
  const rows = Math.max(1, Math.floor(size))
  if (count <= rows) return { start: 0, end: Math.max(0, count) }
  if (previous === undefined) return windowAround(count, index, rows)
  const at = Math.min(Math.max(0, index), count - 1)
  const margin = rows >= 4 ? 1 : 0
  let start = Math.min(Math.max(0, previous), count - rows)
  if (at < start + margin) start = at - margin
  else if (at > start + rows - 1 - margin) start = at - (rows - 1 - margin)
  start = Math.min(Math.max(0, start), count - rows)
  return { start, end: start + rows }
}

/** `6–15 of 40`, or undefined when every row shows. */
export const pagerLabel = (window: Window, count: number): string | undefined =>
  window.start === 0 && window.end >= count
    ? undefined
    : `${(window.start + 1).toLocaleString('en-US')}–${window.end.toLocaleString('en-US')} of ${count.toLocaleString('en-US')}`

/** The row the selection moves to when `id` goes: the next one shown, else the one before. */
export const neighbourOf = (
  view: View,
  mods: readonly ModRow[],
  id: string,
): ModRow | undefined => {
  const rows = filterRows(mods, view.query)
  const at = rows.findIndex(row => row.id === id)
  if (at < 0) return undefined
  return rows[at + 1] ?? rows[at - 1]
}

/** The selected row's index among `rows`, 0 when it isn't there. */
export const selectedIndex = (rows: readonly ModRow[], selected: string | undefined): number => {
  const index = rows.findIndex(row => row.id === selected)
  return index < 0 ? 0 : index
}

/**
 * The row the pane shows as selected and every action acts on: the selection
 * when the filter shows it, else the first row shown.
 * One resolver, so the drawing and a press never disagree.
 */
export const selectedRow = (view: View, mods: readonly ModRow[]): ModRow | undefined => {
  const rows = filterRows(mods, view.query)
  return rows.find(row => row.id === view.selected) ?? rows[0]
}

// ---- staging ----------------------------------------------------------------

/**
 * Stages a toggle of `row`: flips what it will be after apply. Staging it
 * back to its current state un-stages it. A row the CLI can't toggle is
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

/** Why a row can't be toggled from here, in the person's terms; undefined when it can. */
export const whyLocked = (row: ModRow): string | undefined => {
  if (row.toggleable) return undefined
  if (row.scope === 'managed') return "managed by your organisation; it can't be turned off here"
  if (row.origin === 'env-dir')
    return 'loaded from CLAUDE_CODE_PLUGIN_DIRS; take it out of that variable and restart to stop loading it'
  if (row.origin === 'plugin-dir')
    return 'loaded with --plugin-dir; leave the flag out of your launch command to stop loading it'
  return "this session loaded it from its launch command; it can't be toggled here"
}

const cliScope = (scope: Scope | undefined): 'user' | 'project' | 'local' | undefined =>
  scope === 'user' || scope === 'project' || scope === 'local' ? scope : undefined

/** Why the CLI can't update a row, in the person's terms; undefined when it can. */
export const whyNoUpdate = (row: ModRow): string | undefined => {
  if (row.scope === 'managed') return 'managed by your organisation; it updates with their settings'
  if (row.origin === 'folder-marketplace') return 'runs from its marketplace folder: no updates'
  if (row.origin === 'skills-dir')
    return 'lives in your skills folder; it changes when its files do'
  return whyLocked(row)
}

/** Why the CLI can't remove a row; undefined when it can. */
export const whyNoRemove = (row: ModRow): string | undefined => {
  if (row.scope === 'managed') return "managed by your organisation; it can't be removed here"
  if (row.origin === 'skills-dir') return 'lives in your skills folder; delete its folder there'
  return whyLocked(row)
}

/** What a review needs to know about one mod beyond its row. */
export type ReviewFacts = {
  readonly notable: readonly string[]
  readonly parts?: { readonly skills: number; readonly agents: number; readonly mcp: number }
  /** Its data folder's size, when it has one. */
  readonly dataBytes?: number
}

type Parts = { skills: number; agents: number; mcp: number }

const addParts = (into: Parts, parts: ReviewFacts['parts']): void => {
  if (parts === undefined) return
  into.skills += parts.skills
  into.agents += parts.agents
  into.mcp += parts.mcp
}

const withParts = (review: ReviewRequest, parts: Parts): ReviewRequest =>
  parts.skills + parts.agents + parts.mcp > 0 ? { ...review, parts } : review

const targetOf = (row: ModRow, op: ReviewOp): ReviewTarget => {
  const scope = cliScope(row.scope)
  return {
    id: row.id,
    op,
    ...(scope === undefined ? {} : { scope }),
    ...(row.version === undefined ? {} : { version: row.version }),
  }
}

const touchesRepo = (scope: Scope | undefined): boolean => scope === 'project' || scope === 'local'

/** The review a batch of toggles opens: one confirm for the whole batch. */
export const toggleReview = (
  changes: readonly Change[],
  facts: (id: string) => ReviewFacts | undefined,
): ReviewRequest => {
  const notable: string[] = []
  const parts = { skills: 0, agents: 0, mcp: 0 }
  for (const { row, enable } of changes) {
    const known = facts(row.id)
    if (enable) {
      for (const id of known?.notable ?? []) notable.push(`${row.name}: ${notableText(id)}`)
    } else {
      addParts(parts, known?.parts)
    }
  }
  return withParts(
    {
      action: 'toggle',
      targets: changes.map(({ row, enable }) => targetOf(row, enable ? 'enable' : 'disable')),
      notable,
      changesRepoFile: changes.some(({ row }) => touchesRepo(row.scope)),
    },
    parts,
  )
}

/** The marketplace a plugin id names. */
export const marketplaceOf = (id: string): string => id.slice(id.indexOf('@') + 1)

/**
 * The review of updating `rows` (`u` one, `a` all): each marketplace is
 * refreshed first, then each mod updated, then one reload. It runs new code,
 * so it is always reviewed; it can't be undone.
 */
export const updateReview = (rows: readonly ModRow[]): ReviewRequest => {
  const marketplaces = [...new Set(rows.map(row => marketplaceOf(row.id)))].sort()
  return {
    action: 'update',
    targets: rows.map(row => targetOf(row, 'update')),
    notable: [],
    changesRepoFile: false,
    marketplaces,
  }
}

/**
 * The review of removing `row` (`x`): what goes, from which scope, its other
 * parts and its data, which is kept unless the person asks otherwise.
 */
export const removeReview = (row: ModRow, facts: ReviewFacts | undefined): ReviewRequest => {
  const parts = { skills: 0, agents: 0, mcp: 0 }
  addParts(parts, facts?.parts)
  const review: ReviewRequest = {
    action: 'remove',
    targets: [targetOf(row, 'remove')],
    notable: [],
    changesRepoFile: touchesRepo(row.scope),
    keepData: true,
  }
  return withParts(
    facts?.dataBytes === undefined ? review : { ...review, dataBytes: facts.dataBytes },
    parts,
  )
}

const UNDO_OP: Readonly<Partial<Record<JobSpec['kind'], ReviewOp>>> = {
  enable: 'enable',
  disable: 'disable',
  install: 'install',
  remove: 'remove',
}

/**
 * The review of an undo that reinstalls (the inverse of a remove): what comes
 * back, what it can do, and that a declared install command stops it.
 */
export const undoReview = (
  plan: { readonly batch: string; readonly steps: readonly UndoStep[] },
  rows: readonly ModRow[],
  facts: (id: string) => ReviewFacts | undefined,
): ReviewRequest => {
  const { steps } = plan
  const notable: string[] = []
  const parts = { skills: 0, agents: 0, mcp: 0 }
  const targets = steps.flatMap(({ spec, undoes }): ReviewTarget[] => {
    const op = UNDO_OP[spec.kind]
    if (op === undefined || spec.target === undefined) return []
    // A queue job's target is checked only when it runs: drawn, it is sanitised.
    const name = sanitize(rows.find(row => row.id === spec.target)?.name ?? nameOf(spec.target), {
      max: 40,
    })
    const known = facts(spec.target)
    if (op === 'install' || op === 'enable') {
      for (const id of known?.notable ?? []) notable.push(`${name}: ${notableText(id)}`)
    } else {
      addParts(parts, known?.parts)
    }
    const scope = cliScope(spec.args?.scope)
    return [
      {
        id: spec.target,
        op,
        ...(scope === undefined ? {} : { scope }),
        // What the CLI said it did with the data, not what modmgr asked.
        ...(op === 'install' && undoes.keptData !== undefined ? { keptData: undoes.keptData } : {}),
      },
    ]
  })
  return withParts(
    {
      action: 'undo',
      targets,
      notable,
      changesRepoFile: targets.some(target => touchesRepo(target.scope)),
      undoes: plan.batch,
    },
    parts,
  )
}

/** The jobs a confirmed review queues (the batch's reload is added by `enqueue`). */
export const specsOf = (review: ReviewRequest): JobSpec[] => {
  if (review.action === 'marketplace') {
    return review.source === undefined
      ? []
      : [{ kind: 'marketplace-add', args: { source: review.source } }]
  }
  const refresh: JobSpec[] = (review.marketplaces ?? []).map(name => ({
    kind: 'marketplace-update',
    target: name,
  }))
  // The sha of the command shown: the CLI runs it only while it still matches.
  const accepted = (review.declaredCommand ?? review.headersHelper)?.sha256
  const ops = review.targets.map((target): JobSpec => {
    const scope = cliScope(target.scope)
    const scoped = scope === undefined ? {} : { scope }
    const kind = target.op
    // An install from a marketplace not added yet names its source.
    const from =
      review.action === 'install' && kind === 'install' && review.source !== undefined
        ? { source: review.source }
        : {}
    const args: Job['args'] =
      kind === 'remove'
        ? { ...scoped, keepData: review.keepData !== false }
        : (kind === 'install' || kind === 'update') && accepted !== undefined
          ? { ...scoped, ...from, acceptSha: accepted }
          : { ...scoped, ...from }
    return Object.keys(args).length === 0
      ? { kind, target: target.id }
      : { kind, target: target.id, args }
  })
  return [...refresh, ...ops]
}

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

/** `12 KB`: a data folder's size, rounded. */
export const bytesLabel = (n: number): string =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${Math.round(n / 1024)} KB`
      : `${(n / 1048576).toFixed(1)} MB`

/**
 * Rows `texts` wrap to at `columns`, each at least one (a wrapped Text's
 * height): words move whole to the next row, as the terminal wraps them, and
 * a word longer than the row is cut across rows.
 */
export const wrappedRows = (texts: readonly string[], columns: number): number => {
  const width = Math.max(1, columns)
  const rowsOf = (text: string): number => {
    let rows = 1
    let used = 0
    for (const word of text.split(' ')) {
      const length = [...word].length
      const need = used === 0 ? length : used + 1 + length
      if (need <= width) {
        used = need
        continue
      }
      if (used > 0) rows += 1
      rows += Math.max(0, Math.ceil(length / width) - 1)
      used = length % width === 0 && length > 0 ? width : length % width
    }
    return rows
  }
  return texts.reduce((sum, text) => sum + rowsOf(text), 0)
}

/**
 * Rows a wrapping row of items takes at `columns` (the footer's keys, laid
 * out with `columnGap`): each line fills until the next item would overflow.
 */
export const footerRowsFor = (widths: readonly number[], columns: number, gap = 2): number => {
  const line = Math.max(1, columns)
  let rows = 1
  let used = 0
  for (const width of widths) {
    const need = used === 0 ? width : used + gap + width
    if (used > 0 && need > line) {
      rows += 1
      used = width
    } else {
      used = need
    }
    // An item wider than the line wraps inside itself; the next starts on a new line.
    if (used > line) {
      rows += Math.ceil(used / line) - 1
      used = line
    }
  }
  return rows
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
  | { readonly kind: 'to-list' }
  | { readonly kind: 'clear-query'; readonly view: View }
  | { readonly kind: 'close' }

/**
 * What an Esc does: while the pane holds the keys it
 * pops the top overlay, then brings the ring back to the list from a key
 * (`ringAway`: beside the list, in the footer), then clears the filter, then
 * closes. An Esc at the prompt (the pane not focused) always closes: the
 * person can't see what a cascade would pop.
 */
export const escapeStep = (view: View, paneFocused: boolean, ringAway = false): Escape => {
  if (!paneFocused) return { kind: 'close' }
  if (view.stack.length > 0) return { kind: 'pop', view: popOverlay(view) }
  if (ringAway) return { kind: 'to-list' }
  // The field of the tab shown: Installed's filter, or Discover's search.
  if (view.tab === 'discover' && view.search !== '')
    return { kind: 'clear-query', view: { ...view, search: '' } }
  if (view.tab === 'installed' && view.query !== '')
    return { kind: 'clear-query', view: { ...view, query: '' } }
  return { kind: 'close' }
}

/** The view a closed pane leaves: no overlays, no review half-done; staged toggles stay. */
export const closedView = (view: View): View => {
  const { notice: _notice, ...rest } = view
  return { ...rest, stack: [] }
}

// ---- jobs: the batch line, the band, the status line and the title ------------

const describeJob = (job: Job): string => {
  const what =
    job.kind === 'reload'
      ? 'reload plugins'
      : job.kind === 'marketplace-update'
        ? 'refresh marketplace'
        : job.kind
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

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** How a finished batch's work reads: what changed, and what was already so. */
export const doneText = (work: readonly Job[]): string => {
  const changed = work.filter(job => job.state === 'ok' && job.unchanged !== true)
  const same = work.length - changed.length
  const updates = work.every(job => job.kind === 'update')
  if (updates) {
    if (changed.length === 0) return same === 1 ? 'already up to date' : 'all already up to date'
    return same === 0
      ? `${changed.length} updated`
      : `${changed.length} updated, ${same} already up to date`
  }
  if (changed.length === 0) return 'nothing needed changing'
  const [only] = changed
  if (changed.length === 1 && same === 0 && only?.target !== undefined) {
    const name = sanitize(nameOf(only.target), { max: 40 })
    if (only.kind === 'remove') return `${name} removed`
    if (only.kind === 'install') return `${name} installed`
  }
  const applied = plural(changed.length, 'change', 'changes')
  return same === 0 ? `${applied} applied` : `${applied} applied, ${same} already so`
}

/**
 * The jobs a batch counts as its work: not the reload, and not a marketplace
 * refresh (a step of an update). The pane's batch line and the summary share
 * it, so they count a batch alike.
 */
export const isWork = (job: Job): boolean =>
  job.kind !== 'reload' && job.kind !== 'marketplace-update'

/**
 * One line about the newest batch, in the pane: what runs now, or how it
 * ended. A failure stays until the next batch; a success shows only while
 * `showDone` (the band's echo, which the runner clears after a while: that
 * write is what redraws the pane). A batch that changed
 * nothing gets the same echo, though its reload never ran.
 */
export const batchLineOf = (queue: JobQueue, showDone: boolean): Status | undefined => {
  const jobs = latestBatch(queue.jobs)
  if (jobs.length === 0) return undefined
  const running = jobs.find(job => job.state === 'running')
  const work = jobs.filter(isWork)
  const done = work.filter(job => job.state !== 'queued' && job.state !== 'running').length
  if (running !== undefined) {
    if (running.kind === 'reload') return { tone: 'busy', text: 'reloading plugins…' }
    if (running.kind === 'marketplace-update')
      return { tone: 'busy', text: `${describeJob(running)}…` }
    return { tone: 'busy', text: `${describeJob(running)} (${done + 1} of ${work.length})…` }
  }
  if (jobs.some(job => job.state === 'queued')) {
    return work.every(job => job.state !== 'queued')
      ? { tone: 'busy', text: 'reload waits for the settings to settle…' }
      : { tone: 'busy', text: `${plural(work.length, 'change', 'changes')} queued…` }
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
  const text = doneText(work)
  return { tone: 'ok', text: reload?.state === 'ok' ? `${text}, plugins reloaded` : text }
}

/**
 * What modmgr has to say outside the dialog, in one value: the band,
 * the status line and the pane title are each drawn from it, so they never
 * disagree.
 */
export type Summary = {
  /** The job running now, not the reload (a refresh, a change, a test). */
  readonly running?: Job
  /** Changes (jobs that need a reload) queued or running: what "applying" counts. */
  readonly pending: number
  /** The batch's reload is running (or waiting for the turn to end). */
  readonly reloading: boolean
  /** A reload is owed and none is queued: `[l reload]`. */
  readonly reloadOwed: boolean
  readonly updates: number
  /** Mods whose update added notable capabilities not yet seen. */
  readonly capsCount: number
  /** "turn-band can now run programs", when something is new. */
  readonly caps?: string
  /**
   * The person dismissed the band line that said this news (updates, what an
   * update added): the status line and the title leave it out too, until it
   * changes. What is under way or owed is never quieted.
   */
  readonly newsDismissed: boolean
  /** The CLI's answer to the last reload, or how a batch that needed none ended. */
  readonly echo?: string
}

const updatesText = (n: number): string | undefined =>
  n > 0 ? plural(n, 'update', 'updates') : undefined

export const summaryOf = (input: {
  readonly attention: Attention
  readonly queue: JobQueue
  readonly mods: readonly ModRow[]
}): Summary => {
  const { attention, queue, mods } = input
  const reloadJob = queue.jobs.find(job => job.kind === 'reload' && isActive(job))
  const running = queue.jobs.find(job => job.kind !== 'reload' && job.state === 'running')
  const caps = capsLine(mods)
  const news = [updatesText(attention.updates), caps].filter(
    (part): part is string => part !== undefined,
  )
  const said = new Set(attention.dismissed?.split(' · ') ?? [])
  return {
    ...(running === undefined ? {} : { running }),
    pending: queue.jobs.filter(job => NEEDS_RELOAD.has(job.kind) && isActive(job)).length,
    reloading: reloadJob?.state === 'running',
    reloadOwed: attention.reloadPending && reloadJob === undefined,
    updates: attention.updates,
    capsCount: mods.filter(row => row.capsNew !== undefined).length,
    ...(caps === undefined ? {} : { caps }),
    newsDismissed: news.length > 0 && news.every(part => said.has(part)),
    ...(attention.lastReload === undefined ? {} : { echo: attention.lastReload }),
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
 * The band's one line: shown only when something is
 * actionable and that very thing wasn't dismissed. `isWorking` is the band's
 * `e.props.isWorking`: a reload asked mid-turn waits for the turn to end.
 */
export const bandOf = (
  summary: Summary,
  how: { readonly dismissed?: string | undefined; readonly isWorking: boolean },
): Band | undefined => {
  const parts: string[] = []
  if (summary.running !== undefined) parts.push(`${describeJob(summary.running)}…`)
  if (summary.reloading) {
    parts.push(how.isWorking ? 'reload queued, runs when the turn ends' : 'reloading plugins…')
  }
  const updates = updatesText(summary.updates)
  if (updates !== undefined) parts.push(updates)
  if (summary.caps !== undefined) parts.push(summary.caps)
  if (summary.reloadOwed) parts.push('reload to apply')
  if (parts.length === 0) {
    if (summary.echo === undefined) return undefined
    parts.push(summary.echo)
  }
  const text = `mods · ${parts.join(' · ')}`
  if (how.dismissed === text) return undefined
  return { key: text, text, reload: summary.reloadOwed }
}

/**
 * The status line under the prompt (`$.ui.status`, one per plugin, drawn
 * `modmgr: <text>`): one clause, the most important, since it sits under
 * every prompt. What is under way, then what is owed, then news the person
 * hasn't dismissed (what an update added before how many updates wait);
 * nothing when idle (undefined clears it). The band says the rest.
 */
export const statusLineOf = (summary: Summary): string | undefined => {
  const { running } = summary
  if (running?.kind === 'marketplace-update') return `${describeJob(running)}…`
  if (summary.pending > 0) return `applying ${summary.pending}…`
  if (running !== undefined) return `${describeJob(running)}…`
  if (summary.reloading) return 'reloading plugins…'
  if (summary.reloadOwed) return 'reload to apply'
  if (summary.newsDismissed) return undefined
  // The engine names the plugin before it (`modmgr: …`).
  return summary.caps ?? updatesText(summary.updates)
}

/** The pane's title: `mods`, with news not dismissed (a retitle is an open). */
export const titleOf = (summary: Summary): string => {
  const parts = [PANE_TITLE]
  if (!summary.newsDismissed) {
    const updates = updatesText(summary.updates)
    if (updates !== undefined) parts.push(updates)
    if (summary.capsCount > 0) parts.push(`${summary.capsCount} can do more`)
  }
  return parts.join(' · ')
}
