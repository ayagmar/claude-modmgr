// M3b on the surfaces that draw it (PLAN §9): remove with its data kept,
// undo through the review, update of a mod the CLI can update, and a fixture
// update's capability diff in the row, the detail, the band and the status line.
import { type Engine, expect, test } from 'claude-code/testing'
import { RUNS } from './fixtures.ts'
import { type CliAnswer, host, START } from './harness.ts'

const SURFACES = ['terminal', 'desktop'] as const
const QUIET = 'quiet-bash@fixtures'
const TURN_BAND = 'turn-band@fixtures'

const PANE = (bodyColumns = 64, bodyRows = 24) => ({
  title: 'mods',
  isFocused: true,
  bodyColumns,
  placement: 'inline' as const,
  scroll: { offset: 0, bodyRows },
  view: {},
})

const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 6,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 5 },
  view: {},
}

const mountPane = ($: Engine, surface: 'terminal' | 'desktop', props = PANE()) =>
  $.ui.mount({ plugin: 'modmgr', surface, component: 'Pane', requestId: 'modmgr', props })

const focusRow = ($: Engine, id: string) =>
  $.ui.focus({
    component: 'Pane',
    requestId: 'modmgr',
    plugin: 'modmgr',
    element: `row:${id}`,
    origin: { kind: 'person' },
  })

type Entry = Record<string, unknown>
const listed = (change: (entry: Entry) => Entry): CliAnswer => ({
  stdout: JSON.stringify((JSON.parse(RUNS.list.stdout) as Entry[]).map(change)),
})

for (const surface of SURFACES) {
  test(`remove keeps the data, then z reinstalls it through the review, on ${surface}`, async ($, on) => {
    const h = host(on)
    await $.session.start(START)
    await h.clock.advance(1)
    const ui = await mountPane($, surface)
    await focusRow($, QUIET)
    await ui.redraw()
    await ui.press({ key: 'act:remove' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: 'Remove quiet-bash' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'It keeps no data.' })).toBeDefined()
    expect(
      await ui.find({
        type: 'Text',
        text: /claude plugin uninstall quiet-bash@fixtures --scope user --keep-data --json/,
      }),
    ).toBeDefined()
    await ui.press({ key: 'act:confirm' })
    await h.clock.advance(1)
    await h.clock.advance(1500)
    expect(h.argvs).toContain(
      'plugin uninstall quiet-bash@fixtures --scope user --keep-data --json',
    )
    expect(h.reloads()).toBe(1)

    await ui.redraw()
    await ui.press({ key: 'act:undo' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: 'Undo the last batch' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'quiet-bash: its data was kept.' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /declared install command/ })).toBeDefined()
    await ui.press({ key: 'act:confirm' })
    await h.clock.advance(1)
    await h.clock.advance(1500)
    expect(h.argvs).toContain('plugin install quiet-bash@fixtures --scope user --json')
    expect(h.reloads()).toBe(2)
    await ui.unmount()
  })

  test(`u updates a mod from a git marketplace, on ${surface}`, async ($, on) => {
    const h = host(on, {
      cli: args =>
        args[1] === 'list'
          ? listed(entry => {
              if (entry.id !== QUIET) return entry
              const { readFromFolder: _f, folderVersion: _v, ...rest } = entry
              return { ...rest, installPath: '/tmp/modmgr-fixtures/git/quiet-bash' }
            })
          : undefined,
    })
    await $.session.start(START)
    await h.clock.advance(1)
    const ui = await mountPane($, surface)
    await focusRow($, QUIET)
    await ui.redraw()
    // turn-band runs from its marketplace folder: no update key for it.
    await ui.press({ key: 'act:update' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: 'Update quiet-bash' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: "An update can't be undone." })).toBeDefined()
    await ui.press({ key: 'act:confirm' })
    await h.clock.advance(1)
    await h.clock.advance(1500)
    expect(h.argvs).toContain('plugin marketplace update fixtures --json')
    expect(h.argvs).toContain('plugin update quiet-bash@fixtures --scope user --json')
    await focusRow($, TURN_BAND)
    await ui.redraw()
    expect(await ui.find({ key: 'act:update' })).toBeUndefined()
    await ui.unmount()
  })
}

test('a fixture update shows what it can newly do: row, detail, band, status line, title', async ($, on) => {
  let bumped = false
  const h = host(on, {
    cli: args => {
      if (!bumped) return undefined
      if (args[1] === 'list') {
        return listed(entry =>
          entry.id === TURN_BAND ? { ...entry, folderVersion: '0.4.0' } : entry,
        )
      }
      if (args[1] === 'validate' && args.at(-1)?.endsWith('/turn-band') === true) {
        return {
          stdout: RUNS['validate-turn-band'].stdout.replace(
            'calls: $.clock.now,',
            'calls: $.clock.now, $.process.run,',
          ),
        }
      }
      return undefined
    },
  })
  await $.session.start(START)
  await h.clock.advance(1)
  h.showPane(true)
  bumped = true
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    if (surface === 'terminal') {
      await ui.press({ key: 'act:refresh' })
      await h.clock.advance(1)
      await ui.redraw()
    }
    expect(await ui.find({ type: 'Text', text: 'new' })).toBeDefined()
    const band = await $.ui.mount({
      plugin: 'modmgr',
      surface,
      component: 'AbovePrompt',
      props: BAND,
    })
    expect(
      await band.find({ type: 'Text', text: 'mods · turn-band can now run programs' }),
    ).toBeDefined()
    await band.unmount()
    await ui.unmount()
  }
  expect(h.statuses.at(-1)).toBe('turn-band can now run programs')
  expect(h.opens.at(-1)).toEqual({
    id: 'modmgr',
    title: 'mods · 1 can do more',
    closeOnEscape: true,
    rows: 14,
    holdToasts: true,
  })

  // The detail says what is new, and opening it is seeing it.
  const ui = await mountPane($, 'desktop')
  await ui.press({ key: `row:${TURN_BAND}` })
  await h.clock.advance(1)
  await ui.redraw()
  // The detail open says what is new; the row, status line and title let go.
  expect(await ui.find({ type: 'Text', text: 'New since 0.3.1' })).toBeDefined()
  expect(h.statuses.at(-1)).toBeUndefined()
  expect(h.opens.at(-1)?.title).toBe('mods')
})

const ROW = {
  id: TURN_BAND,
  name: 'turn-band',
  version: '0.4.0',
  origin: 'folder-marketplace',
  scope: 'user',
  enabled: true,
  toggleable: true,
  notableCount: 2,
  problems: 0,
  mixed: false,
  capsNew: { since: '0.3.1', added: ['runs-programs'] },
}

test('the detail draws what is new apart, and says why a folder mod has no update', async ($, on) => {
  const h = host(on, {
    state: {
      mods: [ROW],
      detail: {
        ...ROW,
        caps: {
          events: ['prompt.submit'],
          calls: ['process.run'],
          envReads: [],
          reach: ['machine', 'model'],
          notable: ['runs-programs', 'changes-model-input'],
        },
      },
      view: {
        tab: 'installed',
        stack: [],
        query: '',
        kind: 'mods',
        sort: 'name',
        staged: {},
        selected: TURN_BAND,
      },
    },
  })
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface, PANE(120, 30))
    expect(await ui.find({ type: 'Text', text: 'New since 0.3.1' })).toBeDefined()
    expect(
      await ui.find({ type: 'Text', text: 'Can run programs or change files on your machine' }),
    ).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Can change what the model reads' })).toBeDefined()
    // The split's preview has no keys; the detail on top says why `u` is missing.
    expect(
      await ui.find({ type: 'Text', text: /runs from its marketplace folder/ }),
    ).toBeUndefined()
    await ui.unmount()
  }
  const stacked = await mountPane($, 'terminal', PANE(64, 40))
  await stacked.press({ key: `row:${TURN_BAND}` })
  await stacked.redraw()
  expect(
    await stacked.find({ type: 'Text', text: /runs from its marketplace folder/ }),
  ).toBeDefined()
  expect(await stacked.find({ key: 'act:update' })).toBeUndefined()
  expect(await stacked.find({ key: 'act:remove' })).toBeDefined()
  expect(h.read('view')).toMatchObject({ stack: ['detail'] })
})

test('w wipes the data too, said on the confirm key; a appears with two updatable mods', async ($, on) => {
  const h = host(on, {
    cli: args =>
      args[1] === 'list'
        ? listed(entry => {
            if (entry.id !== QUIET && entry.id !== TURN_BAND) {
              return entry.id === 'spawner@fixtures'
                ? { ...entry, dataDirSize: { bytes: 2048, human: '2 KB' } }
                : entry
            }
            const { readFromFolder: _f, folderVersion: _v, ...rest } = entry
            const name = String(entry.id).split('@')[0]
            return { ...rest, installPath: `/tmp/modmgr-fixtures/git/${name}` }
          })
        : undefined,
  })
  await $.session.start(START)
  await h.clock.advance(1)
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect(await ui.find({ key: 'act:update-all' })).toBeDefined()
    await focusRow($, 'spawner@fixtures')
    await ui.redraw()
    await ui.press({ key: 'act:remove' })
    await ui.redraw()
    expect((await ui.find({ key: 'act:confirm' }))?.props.label).toBe('confirm')
    expect((await ui.find({ key: 'act:keep-data' }))?.props.label).toBe('wipe its data too')
    await ui.press({ key: 'act:keep-data' })
    await ui.redraw()
    expect((await ui.find({ key: 'act:confirm' }))?.props.label).toBe('remove and wipe its data')
    expect(await ui.find({ type: 'Text', text: 'Deletes its data (2 KB) for good.' })).toBeDefined()
    await ui.press({ key: 'act:cancel' })
    await ui.unmount()
  }
})
