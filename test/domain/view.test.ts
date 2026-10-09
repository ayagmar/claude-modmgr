import { describe, expect, it } from 'vitest'
import { INITIAL_VIEW } from '../../plugin/hooks/domain/state.ts'
import {
  bandOf,
  batchLineOf,
  closedView,
  commandLine,
  dockColumnsFor,
  escapeStep,
  filterRows,
  latestBatch,
  layoutFor,
  pagerLabel,
  paneOpen,
  partsLabel,
  popOverlay,
  pruneStaged,
  pushOverlay,
  rowKey,
  rowOfKey,
  rowsFor,
  selectedIndex,
  selectedRow,
  specsOf,
  stagedChanges,
  stagedIds,
  stageToggle,
  summaryOf,
  toggleOverlay,
  toggleReview,
  topOverlay,
  whyLocked,
  windowAround,
  windowFollowing,
} from '../../plugin/hooks/domain/view.ts'
import type { Attention, Job, JobQueue, ModRow, View } from '../../plugin/types/index.d.ts'

const row = (name: string, more: Partial<ModRow> = {}): ModRow => ({
  id: `${name}@m`,
  name,
  origin: 'marketplace',
  scope: 'user',
  enabled: true,
  toggleable: true,
  notableCount: 0,
  problems: 0,
  mixed: false,
  ...more,
})

const view = (more: Partial<View> = {}): View => ({ ...INITIAL_VIEW, ...more })

/** A job; an override of `undefined` leaves that field out. */
const job = (id: string, more: { [K in keyof Job]?: Job[K] | undefined } = {}): Job => {
  const base: Record<string, unknown> = {
    id,
    kind: 'disable',
    state: 'ok',
    tail: [],
    batch: 'b1',
    target: 'a@m',
    ...more,
  }
  for (const key of Object.keys(base)) if (base[key] === undefined) delete base[key]
  return base as Job
}

const ATTENTION: Attention = { updates: 0, problems: 0, reloadPending: false, capsChanged: 0 }

describe('layout and opening', () => {
  it('splits from 100 body columns', () => {
    expect(layoutFor(79)).toBe('stacked')
    expect(layoutFor(80)).toBe('split')
  })

  it('asks for rows that fit the list, between 14 and 24', () => {
    expect(rowsFor(0)).toBe(14)
    expect(rowsFor(12)).toBe(18)
    expect(rowsFor(200)).toBe(24)
  })

  it('opens as a dialog, holding toasts only when asked', () => {
    expect(paneOpen({ focus: true, hold: true, mods: 2, dock: undefined })).toEqual({
      id: 'modmgr',
      title: 'mods',
      closeOnEscape: true,
      rows: 14,
      columns: 96,
      focus: true,
      holdToasts: true,
    })
    expect(paneOpen({ focus: false, hold: false, mods: 2, title: 'mods · 2', dock: 52 })).toEqual({
      id: 'modmgr',
      title: 'mods · 2',
      closeOnEscape: true,
      rows: 14,
      columns: 52,
    })
  })

  it('docks narrower in a narrower terminal, leaving the transcript readable', () => {
    // Wide: list and detail side by side.
    expect(dockColumnsFor(240)).toBe(96)
    // 124 columns: 96 would leave the transcript 28; it keeps 72.
    expect(dockColumnsFor(124)).toBe(52)
    // Where it can't keep 72, the dialog still gets enough to stack in.
    expect(dockColumnsFor(110)).toBe(48)
  })

  it('names rows by key and reads them back', () => {
    expect(rowKey('a@m')).toBe('row:a@m')
    expect(rowOfKey('row:a@m')).toBe('a@m')
    expect(rowOfKey('act:toggle')).toBeUndefined()
    expect(rowOfKey(undefined)).toBeUndefined()
  })
})

describe('rows and the window', () => {
  const rows = [row('alpha'), row('beta', { id: 'beta@other' }), row('gamma')]

  it('filters by name or id, ignoring case and blanks', () => {
    expect(filterRows(rows, '').map(r => r.name)).toEqual(['alpha', 'beta', 'gamma'])
    expect(filterRows(rows, '  ').length).toBe(3)
    expect(filterRows(rows, 'AL').map(r => r.name)).toEqual(['alpha'])
    expect(filterRows(rows, 'other').map(r => r.name)).toEqual(['beta'])
  })

  it('shows everything that fits', () => {
    expect(windowAround(3, 2, 10)).toEqual({ start: 0, end: 3 })
    expect(windowAround(0, 0, 10)).toEqual({ start: 0, end: 0 })
  })

  it('centres the focus in a longer list, clamped at both ends', () => {
    expect(windowAround(100, 0, 10)).toEqual({ start: 0, end: 10 })
    expect(windowAround(100, 50, 10)).toEqual({ start: 46, end: 56 })
    expect(windowAround(100, 99, 10)).toEqual({ start: 90, end: 100 })
    expect(windowAround(100, 500, 10)).toEqual({ start: 90, end: 100 })
    expect(windowAround(100, -3, 10)).toEqual({ start: 0, end: 10 })
    // Rows on either side of the focus are always drawn (the arrows move onto them).
    for (let at = 1; at < 99; at += 1) {
      const w = windowAround(100, at, 5)
      expect(w.start).toBeLessThan(at)
      expect(w.end).toBeGreaterThan(at + 1)
    }
    expect(windowAround(100, 3, 0.5)).toEqual({ start: 3, end: 4 })
  })

  it('labels the window only when rows are hidden', () => {
    expect(pagerLabel({ start: 0, end: 3 }, 3)).toBeUndefined()
    expect(pagerLabel({ start: 5, end: 15 }, 40)).toBe('6–15 of 40')
    expect(pagerLabel({ start: 0, end: 9 }, 3546)).toBe('1–9 of 3,546')
  })

  it('resolves the selected row through the filter, for the drawing and the actions alike', () => {
    const all = [row('alpha'), row('beta'), row('gamma')]
    expect(selectedRow(view({ selected: 'gamma@m' }), all)?.name).toBe('gamma')
    // A selection the filter hides is not acted on: the first row shown is.
    expect(selectedRow(view({ selected: 'gamma@m', query: 'be' }), all)?.name).toBe('beta')
    expect(selectedRow(view({ selected: 'gone@m' }), all)?.name).toBe('alpha')
    expect(selectedRow(view({ query: 'zzz' }), all)).toBeUndefined()
  })

  it('finds the selection, or the first row', () => {
    expect(selectedIndex(rows, 'gamma@m')).toBe(2)
    expect(selectedIndex(rows, 'nope')).toBe(0)
    expect(selectedIndex(rows, undefined)).toBe(0)
  })
})

describe('staging', () => {
  const on = row('on')
  const off = row('off', { enabled: false })
  const managed = row('managed', { scope: 'managed', toggleable: false })

  it('flips a row, and flipping it back un-stages it', () => {
    const once = stageToggle(view(), on)
    expect(once.staged).toEqual({ 'on@m': false })
    expect(stageToggle(once, on).staged).toEqual({})
    expect(stageToggle(view(), off).staged).toEqual({ 'off@m': true })
  })

  it('leaves a row it cannot toggle alone', () => {
    const v = view()
    expect(stageToggle(v, managed)).toBe(v)
  })

  it('marks only the entries that still change their row', () => {
    const v = view({ staged: { 'on@m': false, 'off@m': false } })
    expect([...stagedIds(v, [on, off])]).toEqual(['on@m'])
  })

  it('lists the changes still pending, in row order, and prunes the rest', () => {
    const v = view({ staged: { 'off@m': true, 'on@m': true, 'gone@m': false, 'managed@m': false } })
    const rows = [off, on, managed]
    expect(stagedChanges(v, rows)).toEqual([{ row: off, enable: true }])
    expect(pruneStaged(v, rows).staged).toEqual({ 'off@m': true })
    const clean = view({ staged: { 'off@m': true } })
    expect(pruneStaged(clean, rows)).toBe(clean)
  })

  it('says why a row is locked, in the person’s terms', () => {
    expect(whyLocked(on)).toBeUndefined()
    expect(whyLocked(managed)).toMatch(/organisation/)
    expect(whyLocked(row('e', { origin: 'env-dir', toggleable: false }))).toMatch(
      /CLAUDE_CODE_PLUGIN_DIRS/,
    )
    expect(whyLocked(row('p', { origin: 'plugin-dir', toggleable: false }))).toMatch(/--plugin-dir/)
    expect(whyLocked(row('d', { origin: 'dev-session', toggleable: false }))).toMatch(
      /launch command/,
    )
  })
})

describe('the toggle review', () => {
  it('lists each change with its scope, notable facts of what turns on, and what turning off takes', () => {
    const changes = [
      { row: row('quiet', { enabled: false }), enable: true },
      { row: row('band', { scope: 'project' }), enable: false },
      { row: row('plain'), enable: false },
      { row: row('nofacts', { enabled: false, scope: 'managed' }), enable: true },
    ]
    const review = toggleReview(changes, id =>
      id === 'quiet@m'
        ? { notable: ['runs-programs'] }
        : id === 'band@m'
          ? { notable: ['changes-model-input'], parts: { skills: 2, agents: 0, mcp: 1 } }
          : id === 'plain@m'
            ? { notable: [] }
            : undefined,
    )
    expect(review).toEqual({
      action: 'toggle',
      targets: [
        { id: 'quiet@m', op: 'enable', scope: 'user' },
        { id: 'band@m', op: 'disable', scope: 'project' },
        { id: 'plain@m', op: 'disable', scope: 'user' },
        { id: 'nofacts@m', op: 'enable' },
      ],
      notable: ['quiet: Can run programs or change files on your machine'],
      changesRepoFile: true,
      parts: { skills: 2, agents: 0, mcp: 1 },
    })
    expect(specsOf(review)).toEqual([
      { kind: 'enable', target: 'quiet@m', args: { scope: 'user' } },
      { kind: 'disable', target: 'band@m', args: { scope: 'project' } },
      { kind: 'disable', target: 'plain@m', args: { scope: 'user' } },
      { kind: 'enable', target: 'nofacts@m' },
    ])
  })

  it('leaves out what does not apply', () => {
    const review = toggleReview([{ row: row('a'), enable: false }], () => undefined)
    expect(review.parts).toBeUndefined()
    expect(review.changesRepoFile).toBe(false)
  })

  it('spells the command each job runs, or nothing for a bad one', () => {
    expect(commandLine({ kind: 'disable', target: 'a@m', args: { scope: 'local' } })).toBe(
      'claude plugin disable a@m --scope local --json',
    )
    expect(commandLine({ kind: 'enable', target: 'a@m' })).toBe('claude plugin enable a@m --json')
    expect(commandLine({ kind: 'enable', target: '--evil' })).toBeUndefined()
    expect(commandLine({ kind: 'enable' })).toBeUndefined()
  })

  it('counts parts in words', () => {
    expect(partsLabel({ skills: 1, agents: 2, mcp: 1 })).toBe('1 skill, 2 agents, 1 MCP server')
    expect(partsLabel({ skills: 2, agents: 1, mcp: 3 })).toBe('2 skills, 1 agent, 3 MCP servers')
    expect(partsLabel({ skills: 0, agents: 0, mcp: 0 })).toBe('')
  })
})

describe('overlays and Esc', () => {
  it('pushes without repeating, pops, toggles', () => {
    const one = pushOverlay(view(), 'detail')
    const two = pushOverlay(one, 'help')
    expect(two.stack).toEqual(['detail', 'help'])
    expect(pushOverlay(two, 'detail').stack).toEqual(['help', 'detail'])
    expect(topOverlay(two)).toBe('help')
    expect(popOverlay(two).stack).toEqual(['detail'])
    const empty = view()
    expect(popOverlay(empty)).toBe(empty)
    expect(toggleOverlay(two, 'help').stack).toEqual(['detail'])
    expect(toggleOverlay(one, 'jobs').stack).toEqual(['detail', 'jobs'])
  })

  it('pops, then clears the filter, then closes, while the pane holds the keys', () => {
    const stacked = view({ stack: ['detail'], query: 'x' })
    const popped = escapeStep(stacked, true)
    expect(popped).toEqual({ kind: 'pop', view: view({ query: 'x' }) })
    expect(escapeStep(view({ query: 'x' }), true)).toEqual({ kind: 'clear-query', view: view() })
    expect(escapeStep(view(), true)).toEqual({ kind: 'close' })
  })

  it('brings the ring back to the list from a key before clearing the filter', () => {
    expect(escapeStep(view({ query: 'x' }), true, true)).toEqual({ kind: 'to-list' })
    // An overlay pops first; from the prompt it closes.
    expect(escapeStep(view({ stack: ['help'] }), true, true)).toMatchObject({ kind: 'pop' })
    expect(escapeStep(view(), false, true)).toEqual({ kind: 'close' })
  })

  it('closes at once from the prompt', () => {
    expect(escapeStep(view({ stack: ['review'], query: 'x' }), false)).toEqual({ kind: 'close' })
  })

  it('a closed pane forgets its overlays and notice, not what is staged', () => {
    expect(
      closedView(view({ stack: ['detail'], notice: 'hi', staged: { 'a@m': false }, query: 'q' })),
    ).toEqual(view({ staged: { 'a@m': false }, query: 'q' }))
  })
})

describe('the status line', () => {
  const queue = (jobs: Job[]): JobQueue => ({ owner: 'o', jobs })

  it('says nothing without a batch', () => {
    expect(batchLineOf(queue([job('x', { batch: undefined })]), false)).toBeUndefined()
    expect(latestBatch([])).toEqual([])
  })

  it('names the running job and its place, then the reload', () => {
    const running = queue([
      job('1'),
      job('2', { state: 'running', target: 'b@m' }),
      job('3', { state: 'queued' }),
      job('r', { kind: 'reload', state: 'queued', target: undefined }),
    ])
    expect(batchLineOf(running, false)).toEqual({ tone: 'busy', text: 'disable b@m (2 of 3)…' })
    const reloading = queue([
      job('1'),
      job('r', { kind: 'reload', state: 'running', target: undefined }),
    ])
    expect(batchLineOf(reloading, false)).toEqual({ tone: 'busy', text: 'reloading plugins…' })
  })

  it('says a reload waits for the settings, or that changes are queued', () => {
    expect(
      batchLineOf(
        queue([job('1'), job('r', { kind: 'reload', state: 'queued', target: undefined })]),
        false,
      ),
    ).toEqual({ tone: 'busy', text: 'reload waits for the settings to settle…' })
    expect(
      batchLineOf(queue([job('1', { state: 'queued' }), job('2', { state: 'queued' })]), false),
    ).toEqual({
      tone: 'busy',
      text: '2 changes queued…',
    })
  })

  it('reports failures until the next batch, and success while the reload is echoed', () => {
    const failed = queue([
      job('1', { state: 'failed', endedAt: 5, error: { kind: 'cli-failed', message: 'boom' } }),
      job('2', { state: 'interrupted', endedAt: 5 }),
    ])
    expect(batchLineOf(failed, false)).toEqual({
      tone: 'error',
      text: '2 of 2 failed (disable a@m: boom)',
    })
    expect(batchLineOf(queue([job('1', { state: 'interrupted', endedAt: 5 })]), false)?.text).toBe(
      '1 of 1 failed (disable a@m)',
    )
    const done = queue([
      job('1', { endedAt: 100 }),
      job('r', { kind: 'reload', endedAt: 200, target: undefined }),
    ])
    expect(batchLineOf(done, true)).toEqual({
      tone: 'ok',
      text: '1 change applied, plugins reloaded',
    })
    expect(batchLineOf(done, false)).toBeUndefined()
    const two = queue([job('1', { endedAt: 1 }), job('2', { endedAt: 1 })])
    expect(batchLineOf(two, true)?.text).toBe('2 changes applied')
    const reloadOnly = queue([job('r', { kind: 'reload', endedAt: 1, target: undefined })])
    expect(batchLineOf(reloadOnly, true)).toEqual({ tone: 'ok', text: 'plugins reloaded' })
  })
})

describe('the band', () => {
  const quiet = { attention: ATTENTION, queue: { owner: 'o', jobs: [] }, isWorking: false }
  const band = (input: {
    attention: Attention
    queue: JobQueue
    isWorking: boolean
    mods?: ModRow[]
  }) =>
    bandOf(summaryOf({ attention: input.attention, queue: input.queue, mods: input.mods ?? [] }), {
      dismissed: input.attention.dismissed,
      isWorking: input.isWorking,
    })

  it('stays away with nothing to say', () => {
    expect(band(quiet)).toBeUndefined()
  })

  it('says what runs, and that a reload waits for the turn', () => {
    const queue = {
      owner: 'o',
      jobs: [
        job('1', { state: 'running', target: undefined, kind: 'validate' }),
        job('r', { kind: 'reload', state: 'running', target: undefined }),
      ],
    }
    expect(band({ ...quiet, queue, isWorking: true })?.text).toBe(
      'mods · validate… · reload queued, runs when the turn ends',
    )
    expect(band({ ...quiet, queue })?.text).toBe('mods · validate… · reloading plugins…')
  })

  it('offers a reload only when one is owed and none is queued', () => {
    const owed = { ...ATTENTION, reloadPending: true }
    expect(band({ ...quiet, attention: owed })).toEqual({
      key: 'mods · reload to apply',
      text: 'mods · reload to apply',
      reload: true,
    })
    const queued = { owner: 'o', jobs: [job('r', { kind: 'reload', state: 'queued' })] }
    expect(band({ ...quiet, attention: owed, queue: queued })).toBeUndefined()
  })

  it('counts updates and says what updates added', () => {
    const news = (name: string, added: string[]): ModRow => ({
      ...row(name),
      capsNew: { since: '0.3.1', added },
    })
    expect(
      band({
        ...quiet,
        attention: { ...ATTENTION, updates: 1 },
        mods: [news('tb', ['runs-programs'])],
      })?.text,
    ).toBe('mods · 1 update · tb can now run programs')
    expect(band({ ...quiet, mods: [news('tb', ['runs-programs', 'judges-plugins'])] })?.text).toBe(
      'mods · tb can do 2 new things',
    )
    expect(
      band({ ...quiet, mods: [news('a', ['runs-programs']), news('b', ['secret-env'])] })?.text,
    ).toBe('mods · 2 mods can do more since an update')
    expect(band({ ...quiet, attention: { ...ATTENTION, updates: 3 } })?.text).toBe(
      'mods · 3 updates',
    )
  })

  it('echoes the last reload, and stays dismissed until its line changes', () => {
    const echoed = { ...ATTENTION, lastReload: 'Reloaded: 1 plugin' }
    expect(band({ ...quiet, attention: echoed })?.text).toBe('mods · Reloaded: 1 plugin')
    expect(
      band({ ...quiet, attention: { ...echoed, dismissed: 'mods · Reloaded: 1 plugin' } }),
    ).toBeUndefined()
    expect(
      band({
        ...quiet,
        attention: { ...echoed, updates: 1, dismissed: 'mods · Reloaded: 1 plugin' },
      })?.text,
    ).toBe('mods · 1 update')
  })
})

describe('a list that scrolls at its edges', () => {
  it('centres on the selection the first time, then stays while the selection moves inside', () => {
    expect(windowFollowing(undefined, 100, 50, 10)).toEqual({ start: 46, end: 56 })
    expect(windowFollowing(46, 100, 53, 10)).toEqual({ start: 46, end: 56 })
    expect(windowFollowing(46, 100, 47, 10)).toEqual({ start: 46, end: 56 })
  })

  it('moves one row at a time at the edge, keeping the next row drawn', () => {
    expect(windowFollowing(46, 100, 55, 10)).toEqual({ start: 47, end: 57 })
    expect(windowFollowing(46, 100, 46, 10)).toEqual({ start: 45, end: 55 })
  })

  it('jumps to the first or last page and fits a short list whole', () => {
    expect(windowFollowing(46, 100, 99, 10)).toEqual({ start: 90, end: 100 })
    expect(windowFollowing(46, 100, 0, 10)).toEqual({ start: 0, end: 10 })
    expect(windowFollowing(3, 5, 4, 10)).toEqual({ start: 0, end: 5 })
  })
})
