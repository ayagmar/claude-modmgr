// Discover on the surfaces that draw it: the tab, its empty state,
// a detected mod, the install review with its scope Select, a declared
// command shown verbatim and accepted by its sha, and adding a marketplace.
import { type Engine, expect, test } from 'claude-code/testing'
import { RUNS } from './fixtures.ts'
import { host, MODS, START } from './harness.ts'

const SURFACES = ['terminal', 'desktop'] as const
const AWS = 'aws-serverless@claude-plugins-official'
const AWS_HOOKS =
  'https://raw.githubusercontent.com/awslabs/agent-plugins/097fe8ad56d8a1d5e2c81d7880adf145553cf244/plugins/aws-serverless/hooks/hooks.json'
const CMD = 'cmdmod@cmdmkt'
const SHA = '5e549c09f0d775042a59d57dd4fc222b2d9ad6babc928bf603998e1661f65695'

const PANE = (bodyColumns = 64, bodyRows = 24) => ({
  title: 'mods',
  isFocused: true,
  bodyColumns,
  placement: 'inline' as const,
  scroll: { offset: 0, bodyRows },
  view: {},
})

const mountPane = ($: Engine, surface: 'terminal' | 'desktop', props = PANE()) =>
  $.ui.mount({ plugin: 'modmgr', surface, component: 'Pane', requestId: 'modmgr', props })

/** Lets the catalogue load and the detector run on the mocked clock. */
const settle = async (h: ReturnType<typeof host>) => {
  for (let i = 0; i < 8; i += 1) await h.clock.advance(1)
}

for (const surface of SURFACES) {
  test(`Discover finds a mod at its pinned commit and installs it at a chosen scope, on ${surface}`, async ($, on) => {
    const h = host(on, { web: { [AWS_HOOKS]: '{"modules":["./register.ts"]}' } })
    await $.session.start(START)
    await h.clock.advance(1)
    const ui = await mountPane($, surface)
    // The tab shown is a title, not a key: an earlier surface may have left Discover shown.
    if (await ui.find({ key: 'act:tab.discover' })) await ui.press({ key: 'act:tab.discover' })
    await settle(h)
    await ui.redraw()
    expect(h.fetched).toContain(AWS_HOOKS)
    // Each fetch asks for a byte range; the 206 that answers it reads as found.
    expect(h.ranges.every(range => /^bytes=0-\d+$/.test(range ?? ''))).toBe(true)
    // Mods only: the one found.
    const rows = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('found:'))
    expect(rows[0]?.key).toBe(`found:${AWS}`)
    expect(await ui.find({ type: 'Text', text: /\b1 mod\b/ })).toBeDefined()

    await ui.press({ key: `found:${AWS}` })
    await ui.redraw()
    expect(
      await ui.find({ type: 'Text', text: 'modmgr reads it once the mod is installed.' }),
    ).toBeDefined()
    await ui.press({ key: 'act:install' })
    await ui.redraw()
    expect(
      await ui.find({ type: 'Text', text: 'Install aws-serverless from claude-plugins-official' }),
    ).toBeDefined()
    expect(await ui.find({ key: 'scope' })).toBeDefined()
    await ui.select({ key: 'scope', value: 'local' })
    await ui.redraw()
    expect(
      await ui.find({
        type: 'Text',
        text: /claude plugin install aws-serverless@claude-plugins-official --scope local/,
      }),
    ).toBeDefined()
    await ui.press({ key: 'act:confirm' })
    await h.clock.advance(1)
    await h.clock.advance(1500)
    expect(h.argvs).toContain(`plugin install ${AWS} --scope local --json`)
    expect(h.reloads()).toBe(1)
    await ui.unmount()
  })

  test(`a declared command is shown verbatim and accepted by its sha, on ${surface}`, async ($, on) => {
    const h = host(on, {
      cli: args =>
        args[1] === 'install' && args[2] === CMD
          ? args.includes('--accept-command')
            ? { stdout: RUNS['install-quiet-bash'].stdout.replaceAll('quiet-bash@fixtures', CMD) }
            : { ...RUNS['install-command-refused'], exitCode: 1 }
          : undefined,
    })
    await $.session.start(START)
    await h.clock.advance(1)
    const ui = await mountPane($, surface, PANE(64, 30))
    // A command source can't be checked before it is installed, so Discover never
    // lists it: the install starts as text, and the dialog reviews its command.
    const ran = await $.command.run({ ...MODS, args: `install ${CMD} --yes` })
    expect(ran.exitCode).toBe(1)
    // The tab shown is a title, not a key: an earlier surface may have left Discover shown.
    if (await ui.find({ key: 'act:tab.discover' })) await ui.press({ key: 'act:tab.discover' })
    await settle(h)
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /needs review first/ })).toBeDefined()
    await ui.press({ key: 'act:accept' })
    await ui.redraw()
    expect(
      await ui.find({ type: 'Text', text: 'Its marketplace runs this command on your machine:' }),
    ).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '  /tmp/modmgr-fixtures/emit.sh' })).toBeDefined()
    expect((await ui.find({ key: 'act:confirm' }))?.props.label).toBe('run it and install')
    await ui.press({ key: 'act:confirm' })
    await h.clock.advance(1)
    await h.clock.advance(1500)
    expect(h.argvs).toContain(`plugin install ${CMD} --scope user --accept-command ${SHA} --json`)
    await ui.unmount()
  })
}

test('m asks for a marketplace, reviews it, and adds it', async ($, on) => {
  const h = host(on)
  await $.session.start(START)
  await h.clock.advance(1)
  for (const [at, surface] of SURFACES.entries()) {
    const ui = await mountPane($, surface)
    // The tab shown is a title, not a key: an earlier surface may have left Discover shown.
    if (await ui.find({ key: 'act:tab.discover' })) await ui.press({ key: 'act:tab.discover' })
    await settle(h)
    await ui.redraw()
    // Discover lists mods only: none found yet.
    expect(
      await ui.find({ type: 'Text', text: 'No mods found in your marketplaces yet.' }),
    ).toBeDefined()
    await ui.press({ key: 'act:marketplace-add' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: 'Add a marketplace' })).toBeDefined()
    await ui.input({ key: 'marketplace-source', text: 'anthropics/claude-plugins-official' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /runs no plugin code/ })).toBeDefined()
    await ui.press({ key: 'act:confirm' })
    await settle(h)
    expect(h.argvs).toContain('plugin marketplace add anthropics/claude-plugins-official --json')
    await ui.unmount()
  }
})

const reviewState = (declared: { text: string; sha256: string; truncated?: boolean }) => ({
  view: {
    tab: 'discover',
    stack: ['review'],
    query: '',
    search: '',
    sort: 'name',
    staged: {},
  },
  review: {
    action: 'install',
    targets: [{ id: CMD, op: 'install', scope: 'user' }],
    notable: [],
    changesRepoFile: false,
    declaredCommand: declared,
  },
})

test('a declared command with hidden characters says so; one too long, or refused here, goes to a terminal', async ($, on) => {
  const hidden = `rm -rf /tmp/x${String.fromCharCode(0x202e)}harmless`
  const h = host(on, { state: reviewState({ text: hidden, sha256: SHA }) })
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface, PANE(64, 40))
    expect(await ui.find({ type: 'Text', text: /hidden or control characters/ })).toBeDefined()
    expect((await ui.find({ key: 'act:confirm' }))?.props.label).toBe('run it and install')
    await ui.unmount()
  }
  expect(h.read('review')).toMatchObject({ action: 'install' })
})

test('a declared command too long to show is accepted in a terminal, not here', async ($, on) => {
  const h = host(on, { state: reviewState({ text: 'x', sha256: SHA, truncated: true }) })
  await $.session.start(START)
  const ui = await mountPane($, 'terminal', PANE(64, 40))
  expect(await ui.find({ key: 'act:confirm' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /longer than modmgr shows/ })).toBeDefined()
  await ui.press({ key: 'act:copy' })
  expect(h.copies).toEqual([`claude plugin install ${CMD}`])
})

test('when Claude Code refuses acceptances here, the review offers the terminal command', async ($, on) => {
  const h = host(on, {
    state: {
      ...reviewState({ text: '/tmp/emit.sh', sha256: SHA }),
      degraded: { process: false, network: false, acceptCommand: true },
    },
  })
  await $.session.start(START)
  const ui = await mountPane($, 'desktop', PANE(64, 40))
  expect(await ui.find({ key: 'act:confirm' })).toBeUndefined()
  expect(
    await ui.find({ type: 'Text', text: /refuses to accept it from this session/ }),
  ).toBeDefined()
  await ui.press({ key: 'act:copy' })
  expect(h.copies).toEqual([`claude plugin install ${CMD}`])
})

test('on mobile the install review says its scope (no picker there)', async ($, on) => {
  host(on, {
    state: {
      view: {
        tab: 'discover',
        stack: ['review'],
        query: '',
        search: '',
        sort: 'name',
        staged: {},
      },
      review: {
        action: 'install',
        targets: [{ id: AWS, op: 'install', scope: 'user' }],
        notable: [],
        changesRepoFile: false,
        uninspected: true,
      },
    },
  })
  await $.session.start(START)
  const ui = await $.ui.mount({
    plugin: 'modmgr',
    surface: 'mobile',
    component: 'Pane',
    requestId: 'modmgr',
    props: PANE(64, 40),
  })
  expect(await ui.find({ key: 'scope' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'scope: user: every project' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Install aws-serverless/ })).toBeDefined()
})

test('from 100 body columns the selected entry’s detail sits beside the Discover list', async ($, on) => {
  const h = host(on, { web: { [AWS_HOOKS]: '{"modules":["./register.ts"]}' } })
  await $.session.start(START)
  await h.clock.advance(1)
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface, PANE(120, 24))
    // The tab shown is a title, not a key: an earlier surface may have left Discover shown.
    if (await ui.find({ key: 'act:tab.discover' })) await ui.press({ key: 'act:tab.discover' })
    await settle(h)
    await ui.redraw()
    expect(await ui.find({ key: `found:${AWS}` })).toBeDefined()
    // No Enter: the split draws the selection's detail beside the rows.
    expect(
      await ui.find({ type: 'Text', text: 'modmgr reads it once the mod is installed.' }),
    ).toBeDefined()
    await ui.unmount()
  }
})

test('a name two marketplaces share is drawn with each marketplace', async ($, on) => {
  const entry = (name: string, marketplace: string) => ({
    id: `${name}@${marketplace}`,
    name,
    marketplace,
    kind: 'mod',
    blurb: `${name} from ${marketplace}`,
    source: `github.com/${marketplace}/${name}`,
  })
  const rows = [entry('twin', 'one'), entry('twin', 'two'), entry('solo', 'one')]
  host(on, {
    state: {
      view: { tab: 'discover', stack: [], query: '', search: '', sort: 'name', staged: {} },
      catalogPage: { rows, total: 3, community: 0, matched: 3, offset: 0, loading: false },
    },
  })
  const ui = await mountPane($, 'terminal', PANE(64, 24))
  expect((await ui.find({ key: 'found:twin@one' }))?.text).toBe('twin · one')
  expect((await ui.find({ key: 'found:twin@two' }))?.text).toBe('twin · two')
  expect((await ui.find({ key: 'found:solo@one' }))?.text).toBe('solo')
  await ui.unmount()
})

for (const mine of [false, true]) {
  test(`the header counts GitHub's mods${mine ? ' only while k shows them' : ''}`, async ($, on) => {
    host(on, {
      state: {
        view: {
          tab: 'discover',
          stack: [],
          query: '',
          search: '',
          sort: 'installs',
          staged: {},
          mine,
        },
        catalogPage: {
          rows: [],
          total: 3000,
          community: 3000,
          matched: 0,
          offset: 0,
          loading: false,
        },
      },
    })
    const ui = await mountPane($, 'terminal', PANE(80, 24))
    const said = await ui.find({ type: 'Text', text: '3,000 from GitHub' })
    if (mine) expect(said).toBeUndefined()
    else expect(said).toBeDefined()
    await ui.unmount()
  })
}
