// M5b on the surfaces that draw it (PLAN §9): Health lists seeded problems,
// worst first, each with its fix, and a fix runs from a press.
import { type Engine, expect, test } from 'claude-code/testing'
import { host, START } from './harness.ts'

const SURFACES = ['terminal', 'desktop'] as const

const PANE = (bodyColumns = 64, bodyRows = 30) => ({
  title: 'mods',
  isFocused: true,
  bodyColumns,
  placement: 'inline' as const,
  scroll: { offset: 0, bodyRows },
  view: {},
})

const mountPane = ($: Engine, surface: 'terminal' | 'desktop', props = PANE()) =>
  $.ui.mount({ plugin: 'modmgr', surface, component: 'Pane', requestId: 'modmgr', props })

const settle = async (h: ReturnType<typeof host>) => {
  for (let i = 0; i < 6; i += 1) await h.clock.advance(1)
}

for (const surface of SURFACES) {
  test(`Health shows seeded problems with their fixes, on ${surface}`, async ($, on) => {
    const h = host(on, {
      state: {
        dev: {
          rows: [],
          failures: { redactor: { count: 2, lastReason: 'reload failed', lastAt: 1 } },
          loading: false,
        },
        attention: { updates: 0, problems: 0, reloadPending: true, capsChanged: 0 },
      },
    })
    await $.session.start(START)
    await settle(h)
    const ui = await mountPane($, surface)
    await ui.press({ key: 'act:tab.health' })
    await settle(h)
    await ui.redraw()
    expect((await ui.find({ key: 'act:tab.health' }))?.props.label).toMatch(/^Health ▲\d+$/)
    // The broken fixture's validate errors, the failures redactor reported, a reload owed.
    expect(await ui.find({ key: 'health:broken@fixtures:validate' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '→ see it' })).toBeDefined()
    expect(await ui.find({ key: 'health:redactor:failures' })).toBeDefined()
    expect(await ui.find({ key: 'health:own:reload' })).toBeDefined()
    // A fix runs from a press: the broken mod's detail on Installed.
    await ui.press({ key: 'health:broken@fixtures:validate' })
    await settle(h)
    await ui.redraw()
    expect(h.read('view')).toMatchObject({
      tab: 'installed',
      selected: 'broken@fixtures',
      stack: ['detail'],
    })
    await ui.unmount()
  })
}

test('Health’s reload fix queues a reload, and its own state says the cache and the checks', async ($, on) => {
  const h = host(on, {
    state: { attention: { updates: 0, problems: 0, reloadPending: true, capsChanged: 0 } },
  })
  await $.session.start(START)
  await settle(h)
  const ui = await mountPane($, 'terminal', PANE(120, 30))
  await ui.press({ key: 'act:tab.health' })
  await settle(h)
  await ui.redraw()
  expect(
    await ui.find({ type: 'Button', text: /^updates checked never, every 6 hours$/ }),
  ).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /^cache: / })).toBeDefined()
  await ui.press({ key: 'health:own:reload' })
  await h.clock.advance(1)
  await h.clock.advance(1500)
  expect(h.reloads()).toBe(1)
})
