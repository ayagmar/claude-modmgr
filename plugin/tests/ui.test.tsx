// The dialog, the band and their wiring on the surfaces that draw them:
// every body runs on terminal and desktop; mobile is checked
// for its fallback (no Input). Acts by element key; nothing here paints.
import { type Engine, expect, test } from 'claude-code/testing'
import { host, START } from './harness.ts'

const SURFACES = ['terminal', 'desktop'] as const

const PANE = (bodyColumns = 64, bodyRows = 20, isFocused = true) => ({
  title: 'mods',
  isFocused,
  bodyColumns,
  placement: 'inline' as const,
  scroll: { offset: 0, bodyRows },
  view: {},
})

const BAND = (isWorking = false) => ({
  hasSurvey: false,
  isWorking,
  maxRows: 6,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 5 },
  view: {},
})

const TURN_BAND = 'turn-band@fixtures'

// The harness answers `state.*` beneath the plugin, so the engine never
// sees a write and doesn't redraw by itself: each act is followed by `redraw()`.

/** Moves the focus ring onto a row, as the person's arrow does. */
const focusRow = ($: Engine, id: string) =>
  $.ui.focus({
    component: 'Pane',
    requestId: 'modmgr',
    plugin: 'modmgr',
    element: `row:${id}`,
    origin: { kind: 'person' },
  })

test('bare /mods opens the dialog with focus, Esc and held toasts, and answers no text', async ($, on) => {
  const h = host(on)
  await $.session.start(START)
  await h.clock.advance(1)
  const ran = await $.command.run({ ...MODS_BARE })
  expect(ran.text).toBeUndefined()
  expect(h.opens).toEqual([
    {
      id: 'modmgr',
      title: 'mods',
      closeOnEscape: true,
      rows: 14,
      columns: 96,
      focus: true,
      holdToasts: true,
    },
  ])
  expect(h.argvs.filter(argv => argv.includes('disable'))).toEqual([])
})

test('where no pane can be placed, /mods answers with the list', async ($, on) => {
  const h = host(on, { placePanes: false })
  await $.session.start(START)
  await h.clock.advance(1)
  const ran = await $.command.run({ ...MODS_BARE })
  expect(ran.text?.split('\n')[0]).toBe('5 mods (5 on)')
})

test('Installed lists every mod with its state, version and scope on terminal and desktop', async ($, on) => {
  const h = host(on)
  await $.session.start(START)
  await h.clock.advance(1)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: 'modmgr',
      surface,
      component: 'Pane',
      requestId: 'modmgr',
      props: PANE(),
    })
    const rows = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('row:'))
    expect(rows.map(row => row.key)).toEqual([
      'row:broken@fixtures',
      'row:quiet-bash@fixtures',
      'row:redactor@fixtures',
      'row:spawner@fixtures',
      `row:${TURN_BAND}`,
    ])
    expect((await ui.find({ type: 'Text', text: /5 of 5 mods on/ }))?.text).toBe('5 of 5 mods on')
    expect(await ui.find({ key: 'filter' })).toBeDefined()
    expect(await ui.find({ key: 'act:toggle' })).toBeDefined()
    expect(await ui.find({ key: 'act:close' })).toBeDefined()
    await ui.unmount()
  }
})

test('toggle → review → confirm → disable → reload, on terminal and desktop', async ($, on) => {
  const h = host(on)
  await $.session.start(START)
  await h.clock.advance(1)
  for (const surface of SURFACES) {
    const reloads = h.reloads()
    const disables = h.argvs.filter(argv => argv.startsWith('plugin disable')).length
    const ui = await $.ui.mount({
      plugin: 'modmgr',
      surface,
      component: 'Pane',
      requestId: 'modmgr',
      props: PANE(),
    })
    await focusRow($, TURN_BAND)
    await ui.redraw()
    await ui.press({ key: 'act:toggle' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /→ off/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 staged change/ })).toBeDefined()

    await ui.press({ key: 'act:apply' })

    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: 'Apply 1 change' })).toBeDefined()
    expect(
      await ui.find({
        type: 'Text',
        text: /claude plugin disable turn-band@fixtures --scope user/,
      }),
    ).toBeDefined()
    expect(await ui.find({ key: 'act:toggle' })).toBeUndefined()

    await ui.press({ key: 'act:confirm' })

    await ui.redraw()
    expect(h.read('review')).toBeNull()
    // The pane re-opens without holding toasts while the batch runs.
    expect(h.opens.at(-1)?.holdToasts).toBeUndefined()
    await h.clock.advance(1)
    expect(h.argvs.filter(argv => argv.startsWith('plugin disable'))).toHaveLength(disables + 1)
    expect(h.argvs.at(-2)).toBe('plugin disable turn-band@fixtures --scope user --json')
    expect(h.reloads()).toBe(reloads)
    await h.clock.advance(1500)
    expect(h.reloads()).toBe(reloads + 1)
    await ui.redraw()
    expect(
      await ui.find({ type: 'Text', text: /1 change applied, plugins reloaded/ }),
    ).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /staged/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('Enter opens the detail; back pops it; the filter narrows the rows; close closes', async ($, on) => {
  const h = host(on)
  await $.session.start(START)
  await h.clock.advance(1)
  for (const surface of SURFACES) {
    h.showPane(true)
    const ui = await $.ui.mount({
      plugin: 'modmgr',
      surface,
      component: 'Pane',
      requestId: 'modmgr',
      props: PANE(),
    })
    await ui.press({ key: `row:${TURN_BAND}` })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: 'What it can do' })).toBeDefined()
    await ui.press({ key: 'act:copy' })
    await ui.redraw()
    expect(h.copies.at(-1)).toBe(TURN_BAND)
    expect(await ui.find({ type: 'Text', text: `Copied ${TURN_BAND}` })).toBeDefined()

    await ui.press({ key: 'act:back' })

    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: 'What it can do' })).toBeUndefined()

    await ui.input({ key: 'filter', text: 'red', kind: 'change' })

    await ui.redraw()
    const rows = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('row:'))
    expect(rows.map(row => row.key)).toEqual(['row:redactor@fixtures'])

    // The footer's close is the plugin's own ui.close: it passes, and the view resets.
    await ui.press({ key: 'act:close' })
    await ui.redraw()
    expect(h.closes.at(-1)).toBe('modmgr:plugin')
    expect((h.read('view') as { stack: string[] }).stack).toEqual([])
    await ui.input({ key: 'filter', text: '', kind: 'change' })
    await ui.redraw()
    await ui.unmount()
  }
})

test('without the keys the footer says how to take them', async ($, on) => {
  const h = host(on)
  await $.session.start(START)
  await h.clock.advance(1)
  const ui = await $.ui.mount({
    plugin: 'modmgr',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'modmgr',
    props: PANE(64, 20, false),
  })
  expect(await ui.find({ type: 'Text', text: /ctrl\+x tab/ })).toBeDefined()
})

test('from 80 body columns the detail sits beside the list with its keys and follows the focus', async ($, on) => {
  const h = host(on)
  await $.session.start(START)
  await h.clock.advance(1)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: 'modmgr',
      surface,
      component: 'Pane',
      requestId: 'modmgr',
      props: PANE(120, 30),
    })
    await focusRow($, 'quiet-bash@fixtures')
    await ui.redraw()
    expect(await ui.find({ key: 'row:quiet-bash@fixtures' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'What it can do' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Can run programs/ })).toBeDefined()
    // Its keys are the detail's: the footer doesn't draw them twice.
    expect(await ui.find({ key: 'act:copy' })).toBeDefined()
    expect((await ui.findAll({ type: 'Button' })).filter(b => b.key === 'act:toggle')).toHaveLength(
      1,
    )
    await ui.unmount()
  }
})

test('help is generated from the keymap; the job log lists what ran', async ($, on) => {
  const h = host(on)
  await $.session.start(START)
  await h.clock.advance(1)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: 'modmgr',
      surface,
      component: 'Pane',
      requestId: 'modmgr',
      props: PANE(),
    })
    await ui.press({ key: 'act:help' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: 'enable/disable' })).toBeDefined()
    // Every tab is listed; a key of another view is not.
    expect(await ui.find({ type: 'Text', text: 'Discover' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Health' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'sort' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'update all' })).toBeDefined()
    await ui.press({ key: 'act:help' })
    await ui.redraw()
    await ui.press({ key: 'act:jobs' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: 'Nothing has run yet.' })).toBeDefined()
    await ui.press({ key: 'act:jobs' })
    await ui.redraw()
    await ui.unmount()
  }
})

test('a long list is windowed around the focus, with a pager', async ($, on) => {
  const rows = Array.from({ length: 200 }, (_, i) => ({
    id: `mod-${String(i).padStart(3, '0')}@m`,
    name: `mod-${String(i).padStart(3, '0')}`,
    version: '1.0.0',
    origin: 'marketplace',
    scope: 'user',
    enabled: i % 3 !== 0,
    toggleable: true,
    notableCount: i % 4,
    problems: 0,
    mixed: false,
  }))
  const h = host(on, { state: { mods: rows, sync: { refreshing: false, at: 1, skipped: 0 } } })
  for (const surface of SURFACES) {
    const started = Date.now()
    const ui = await $.ui.mount({
      plugin: 'modmgr',
      surface,
      component: 'Pane',
      requestId: 'modmgr',
      props: PANE(64, 20),
    })
    const paint = Date.now() - started
    // The budget for the first paint is 50 ms (measured 2026-10-07: 37 ms on the
    // terminal, the module's first draw, and 3 ms on desktop). The bound leaves room
    // for a loaded CI runner.
    expect(paint).toBeLessThan(150)
    const drawn = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('row:'))
    expect(drawn.length).toBeGreaterThan(5)
    expect(drawn.length).toBeLessThan(20)
    expect(await ui.find({ type: 'Text', text: /^1–\d+ of 200$/ })).toBeDefined()
    await focusRow($, 'mod-100@m')
    await ui.redraw()
    const moved = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('row:'))
    expect(moved.map(row => row.key)).toContain('row:mod-099@m')
    expect(moved.map(row => row.key)).toContain('row:mod-101@m')
    // `g`/`b` move the selection (and the ring, once the row is drawn: in a session
    // the write redraws at once; here the redraw is the test's).
    await ui.press({ key: 'act:page.last' })
    expect((h.read('view') as { selected: string }).selected).toBe('mod-199@m')
    await ui.redraw()
    expect(await ui.find({ key: 'row:mod-199@m' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\d+–200 of 200$/ })).toBeDefined()
    await ui.press({ key: 'act:page.first' })
    expect((h.read('view') as { selected: string }).selected).toBe('mod-000@m')
    await ui.unmount()
  }
})

test('the band says a reload waits for the turn, and hides once dismissed', async ($, on) => {
  const h = host(on, {
    state: {
      queue: {
        owner: 'someone-else',
        jobs: [{ id: 'r', kind: 'reload', state: 'running', tail: [], batch: 'b' }],
      },
    },
  })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: 'modmgr',
      surface,
      component: 'AbovePrompt',
      props: BAND(true),
    })
    expect(
      await ui.find({ type: 'Text', text: 'mods · reload queued, runs when the turn ends' }),
    ).toBeDefined()
    expect(await ui.find({ key: 'act:reload' })).toBeUndefined()
    await ui.press({ key: 'act:open-modmgr' })
    expect(h.opens.at(-1)?.focus).toBe(true)
    await ui.unmount()
  }
  const ui = await $.ui.mount({
    plugin: 'modmgr',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: BAND(true),
  })
  await ui.press({ key: 'act:dismiss' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /reload queued/ })).toBeUndefined()
  // Once the turn ends the line changes, and the band is back.
  await ui.redraw(BAND(false))
  expect(await ui.find({ type: 'Text', text: 'mods · reloading plugins…' })).toBeDefined()
})

test('the band offers a reload after a refused one, and queues it', async ($, on) => {
  const h = host(on, {
    state: {
      attention: { updates: 0, problems: 0, reloadPending: true, capsChanged: 0 },
    },
  })
  await $.session.start(START)
  await h.clock.advance(1)
  const ui = await $.ui.mount({
    plugin: 'modmgr',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: BAND(),
  })
  expect(await ui.find({ type: 'Text', text: 'mods · reload to apply' })).toBeDefined()
  await ui.press({ key: 'act:reload' })
  await ui.redraw()
  await h.clock.advance(1)
  expect(h.reloads()).toBe(1)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /mods · Reloaded: 1 plugin/ })).toBeDefined()
  await h.clock.advance(8000)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /Reloaded/ })).toBeUndefined()
})

test('mobile draws the list without the filter field (no Input there)', async ($, on) => {
  const h = host(on)
  await $.session.start(START)
  await h.clock.advance(1)
  const ui = await $.ui.mount({
    plugin: 'modmgr',
    surface: 'mobile',
    component: 'Pane',
    requestId: 'modmgr',
    props: PANE(),
  })
  expect(await ui.find({ key: `row:${TURN_BAND}` })).toBeDefined()
  expect(await ui.find({ key: 'filter' })).toBeUndefined()
})

// ---- a filter's selection, scope warnings, read-only, the job log, layout -----

const mountPane = ($: Engine, surface: 'terminal' | 'desktop', props = PANE()) =>
  $.ui.mount({ plugin: 'modmgr', surface, component: 'Pane', requestId: 'modmgr', props })

test('with a filter on, toggle stages the row the filter shows, not a hidden selection', async ($, on) => {
  const h = host(on)
  await $.session.start(START)
  await h.clock.advance(1)
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    await focusRow($, TURN_BAND)
    await ui.input({ key: 'filter', text: 'red', kind: 'change' })
    await ui.press({ key: 'act:toggle' })
    await ui.redraw()
    expect((h.read('view') as { staged: Record<string, boolean> }).staged).toEqual({
      'redactor@fixtures': false,
    })
    expect(await ui.find({ type: 'Text', text: /→ off/ })).toBeDefined()
    await ui.press({ key: 'act:toggle' })
    await ui.input({ key: 'filter', text: '', kind: 'change' })
    await ui.unmount()
  }
})

test('a project-scope change says it edits this repository’s settings', async ($, on) => {
  const h = host(on)
  await $.session.start(START)
  await h.clock.advance(1)
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    await focusRow($, 'redactor@fixtures')
    await ui.press({ key: 'act:toggle' })
    await ui.redraw()
    await ui.press({ key: 'act:apply' })
    await ui.redraw()
    expect(
      await ui.find({ type: 'Text', text: 'Changes .claude/settings.json in this repository.' }),
    ).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /--scope project/ })).toBeDefined()
    await ui.press({ key: 'act:cancel' })
    await ui.redraw()
    await ui.press({ key: 'act:toggle' })
    await ui.unmount()
  }
})

test('without the CLI the dialog is read-only and says why', async ($, on) => {
  const h = host(on, {
    cli: () => ({ throws: 'spawn claude ENOENT' }),
    state: { mods: [MOD_ROW], sync: { refreshing: false, at: 1, skipped: 0 } },
  })
  await $.session.start(START)
  await h.clock.advance(1)
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect(await ui.find({ type: 'Text', text: /can't run the claude CLI here/ })).toBeDefined()
    expect(await ui.find({ key: 'act:toggle' })).toBeUndefined()
    expect(await ui.find({ key: 'act:undo' })).toBeUndefined()
    await ui.press({ key: `row:${MOD_ROW.id}` })
    await ui.redraw()
    expect(await ui.find({ key: 'act:copy' })).toBeDefined()
    expect(await ui.find({ key: 'act:toggle' })).toBeUndefined()
    await ui.press({ key: 'act:back' })
    await ui.unmount()
  }
})

test('the job log shows a running test’s output and offers to cancel it', async ($, on) => {
  host(on, {
    state: {
      queue: {
        owner: 'someone-else',
        jobs: [
          { id: 'a', kind: 'disable', state: 'cancelled', tail: [], target: 'x@m' },
          { id: 't', kind: 'test', state: 'running', tail: ['1 pass', '2 pass'], target: 'y@m' },
        ],
      },
      view: {
        tab: 'installed',
        layout: 'stacked',
        stack: ['jobs'],
        query: '',
        kind: 'mods',
        sort: 'name',
        page: 0,
        staged: {},
      },
    },
  })
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect(await ui.find({ type: 'Text', text: /2 pass/ })).toBeDefined()
    expect((await ui.find({ key: 'act:cancel-job' }))?.props.label).toBe('cancel test')
    expect(await ui.find({ type: 'Text', text: 'cancelled' })).toBeDefined()
    await ui.unmount()
  }
})

test('the split’s list drops version and scope; help takes the whole body', async ($, on) => {
  const h = host(on)
  await $.session.start(START)
  await h.clock.advance(1)
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface, PANE(104, 30))
    await focusRow($, 'quiet-bash@fixtures')
    await ui.redraw()
    // turn-band's version would be in its row; only the selected mod's is drawn (in the detail).
    expect(await ui.find({ type: 'Text', text: '0.3.1' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '0.2.0' })).toBeDefined()
    await ui.press({ key: 'act:help' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: 'Keys' })).toBeDefined()
    expect(await ui.find({ key: `row:${TURN_BAND}` })).toBeUndefined()
    await ui.press({ key: 'act:help' })
    await ui.unmount()
  }
})

test('the footer words close and back per surface; the key hint is the terminal’s', async ($, on) => {
  const h = host(on)
  await $.session.start(START)
  await h.clock.advance(1)
  const terminal = await mountPane($, 'terminal', PANE(64, 20, false))
  expect((await terminal.find({ key: 'act:close' }))?.props.label).toBe('esc close')
  expect(await terminal.find({ type: 'Text', text: /ctrl\+x tab/ })).toBeDefined()
  const desktop = await mountPane($, 'desktop', PANE(64, 20, false))
  expect((await desktop.find({ key: 'act:close' }))?.props.label).toBe('close')
  expect(await desktop.find({ type: 'Text', text: /ctrl\+x tab/ })).toBeUndefined()
})

const MOD_ROW = {
  id: 'turn-band@fixtures',
  name: 'turn-band',
  version: '0.3.1',
  origin: 'marketplace',
  scope: 'user',
  enabled: true,
  toggleable: true,
  notableCount: 1,
  problems: 0,
  mixed: false,
}

const MODS_BARE = {
  command: 'mods',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
} as const

test('the first session opens on a word of welcome, once', async ($, on) => {
  const h = host(on, { store: { prefs: { v: 1, data: { firstRunDone: false } } } })
  await $.session.start(START)
  await h.clock.advance(1)
  const ui = await $.ui.mount({
    plugin: 'modmgr',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'modmgr',
    props: PANE(),
  })
  expect(await ui.find({ type: 'Text', text: 'modmgr: mods for Claude Code' })).toBeDefined()
  await ui.press({ key: 'act:start' })
  await ui.redraw()
  expect(await ui.find({ key: 'act:start' })).toBeUndefined()
  expect(await ui.find({ key: `row:${TURN_BAND}` })).toBeDefined()
  // Said once: the next session doesn't (the store remembers).
  await h.clock.advance(3000)
  expect(h.stored('prefs')).toMatchObject({ data: { firstRunDone: true } })
})
