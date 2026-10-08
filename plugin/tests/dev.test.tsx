// Dev on the surfaces that draw it: it lists the mods this session
// runs from folders, validates and tests one, counts what the session reports
// while hot-reloading it, and says how to share it.
import { type Engine, expect, test } from 'claude-code/testing'
import { host, START } from './harness.ts'

const SURFACES = ['terminal', 'desktop'] as const
const MKT = '/tmp/modmgr-fixtures/mkt'
const TURN_BAND = `${MKT}/turn-band`
const SESSION = '/cfg/dev-mods/session-1'

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

const devHost = (on: Parameters<typeof host>[0]) =>
  host(on, {
    env: { CLAUDE_CONFIG_DIR: '/cfg' },
    dirs: { [SESSION]: ['fresh', 'notes.md'] },
    files: {
      [`${SESSION}/fresh/.claude-plugin/plugin.json`]: '{"name":"fresh","version":"0.1.0"}',
    },
  })

/** Lets the start-up refresh and a job run on the mocked clock. */
const settle = async (h: ReturnType<typeof host>) => {
  for (let i = 0; i < 6; i += 1) await h.clock.advance(1)
}

for (const surface of SURFACES) {
  test(`Dev lists folder mods and this session's mods folder, and validates one, on ${surface}`, async ($, on) => {
    const h = devHost(on)
    await $.session.start(START)
    await settle(h)
    const ui = await mountPane($, surface)
    await ui.press({ key: 'act:tab.dev' })
    await settle(h)
    await ui.redraw()
    const rows = (await ui.findAll({ type: 'Button' }))
      .map(button => button.key)
      .filter(key => key?.startsWith('dev:'))
    expect(rows).toEqual([
      `dev:${SESSION}/fresh`,
      `dev:${MKT}/broken`,
      `dev:${MKT}/quiet-bash`,
      `dev:${MKT}/redactor`,
      `dev:${MKT}/spawner`,
      `dev:${TURN_BAND}`,
    ])
    expect(await ui.find({ type: 'Text', text: /6 mods under development/ })).toBeDefined()

    await ui.press({ key: `dev:${TURN_BAND}` })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: 'not run yet (v)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: TURN_BAND })).toBeDefined()
    await ui.press({ key: 'act:validate' })
    await settle(h)
    await ui.redraw()
    expect(h.argvs).toContain(`plugin validate --json --strict ${TURN_BAND}`)
    expect(await ui.find({ type: 'Text', text: '✓ valid' })).toBeDefined()
    // Validating needs no reload.
    expect(h.reloads()).toBe(0)
    await ui.unmount()
  })
}

test('a failure the session reports while hot-reloading a folder is counted on its row', async ($, on) => {
  const h = devHost(on)
  await $.session.start(START)
  await settle(h)
  const ui = await mountPane($, 'terminal')
  await ui.press({ key: 'act:tab.dev' })
  await settle(h)
  await $.session.append({
    message: {
      type: 'system',
      content: [{ type: 'text', text: 'turn-band: tool.call hook failed: it threw' }],
    },
    door: 'notice',
    origin: { kind: 'engine' },
    uuid: 'notice-1',
  })
  await settle(h)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: '▲1' })).toBeDefined()
  expect(h.read('dev')).toMatchObject({
    failures: { 'turn-band': { count: 1, lastReason: 'tool.call hook failed: it threw' } },
  })
})

test('p says how to share a dev mod, and c copies the install line', async ($, on) => {
  const h = host(on, {
    env: { CLAUDE_CONFIG_DIR: '/cfg' },
    repo: { root: MKT, remote: 'https://github.com/me/mods.git', internal: false, name: null },
    files: {
      [`${MKT}/.claude-plugin/marketplace.json`]: JSON.stringify({
        name: 'fixtures',
        plugins: [{ name: 'turn-band', source: './turn-band' }],
      }),
    },
  })
  await $.session.start(START)
  await settle(h)
  const ui = await mountPane($, 'desktop')
  await ui.press({ key: 'act:tab.dev' })
  await settle(h)
  await ui.redraw()
  await ui.press({ key: `dev:${TURN_BAND}` })
  await ui.redraw()
  await ui.press({ key: 'act:share' })
  await settle(h)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: 'Share turn-band' })).toBeDefined()
  expect(
    await ui.find({ type: 'Text', text: '  /plugin install turn-band --marketplace me/mods' }),
  ).toBeDefined()
  await ui.press({ key: 'act:copy' })
  expect(h.copies).toEqual(['/plugin install turn-band --marketplace me/mods'])
})

test('a --plugin-dir mod shows once its folder is found where the session runs', async ($, on) => {
  const h = host(on, {
    env: { CLAUDE_CONFIG_DIR: '/cfg' },
    // modmgr registered /mods but isn't listed: --plugin-dir, its repository the marketplace.
    commands: [
      { name: 'mods', description: '', source: 'plugin', plugin: 'modmgr' },
      { name: 'diff', description: '', source: 'plugin', plugin: 'cc-plugin-diff' },
    ],
    files: {
      '/repo/.claude-plugin/marketplace.json': JSON.stringify({
        name: 'modmgr',
        plugins: [{ name: 'modmgr', source: './plugin' }],
      }),
      '/repo/plugin/.claude-plugin/plugin.json': '{"name":"modmgr","version":"0.1.0"}',
    },
  })
  await $.session.start(START)
  await settle(h)
  const ui = await mountPane($, 'terminal', PANE(120, 30))
  await ui.press({ key: 'act:tab.dev' })
  await settle(h)
  await ui.redraw()
  expect(await ui.find({ key: 'dev:/repo/plugin' })).toBeDefined()
  // A built-in's command names no folder: no row.
  const keys = (await ui.findAll({ type: 'Button' })).map(button => button.key ?? '')
  expect(keys.some(key => key.includes('cc-plugin-diff'))).toBe(false)
  // The split shows how it loads.
  expect(await ui.find({ type: 'Text', text: 'Loaded with --plugin-dir' })).toBeDefined()
})
