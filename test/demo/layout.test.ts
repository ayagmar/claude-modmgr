// The dialog's layout at sizes the landing page doesn't show, drawn by the
// real ui/Pane.tsx over the fixture world with the demo's renderer.
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../../plugin/hooks/domain/config.ts'
import { createActions } from '../../plugin/hooks/services/actions.ts'
import { createRuntime } from '../../plugin/hooks/services/runtime.ts'
import { drawPane, overlayEnd } from '../../plugin/hooks/ui/Pane.tsx'
import { runs } from '../domain/fixtures/cli-runs.ts'
import { fixtureCli, fixtureManifests, markMods } from '../services/cli-world.ts'
import { out, world } from '../services/fakes.ts'
import { ELEMENTS, installJsx, render } from './render.ts'

type Node = {
  readonly type: unknown
  readonly props: Record<string, unknown> | null
  readonly children: unknown[]
}
const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && 'type' in value && 'children' in value

/** The keys of a tree's Buttons and Inputs in document order: the ring's stops, hidden ones too. */
const stopsOf = (node: unknown): string[] =>
  Array.isArray(node)
    ? node.flatMap(stopsOf)
    : !isNode(node)
      ? []
      : node.type === 'Button' || node.type === 'Input'
        ? [String(node.props?.key)]
        : node.children.flatMap(stopsOf)

const setup = async () => {
  installJsx()
  const w = world()
  fixtureManifests(w.fs)
  fixtureCli(w.process)
    .when(['list', '--json', '--available'], out(runs['list-available'].stdout))
    .when(['marketplace', 'list'], out(runs['marketplace-list'].stdout))
  const rt = createRuntime(w.ports, DEFAULT_CONFIG, 'layout')
  w.state.values.queue = { owner: 'layout', jobs: [] }
  await rt.store.load()
  await rt.registry.refresh()
  const act = createActions(w.ports, rt)
  const tree = (bodyColumns: number, bodyRows: number) =>
    drawPane(
      { el: ELEMENTS as never, surface: 'terminal', read: w.state.read, act, ownRoot: '/modmgr' },
      { bodyColumns, bodyRows, isFocused: true },
    )
  const draw = async (bodyColumns: number, bodyRows: number) =>
    render(await tree(bodyColumns, bodyRows), bodyColumns).map(line =>
      line.map(segment => segment.text).join(''),
    )
  return { w, rt, act, tree, draw }
}

describe('the ring’s stops', () => {
  // The terminal's ring keeps its place by position among the stops: a window
  // that scrolled rows out of the stops slid another row under the ring.
  it('stay the same on every tab while the selection scrolls the window', async () => {
    const { w, rt, act, tree, draw } = await setup()
    const scrolls = async (select: () => Promise<void>) => {
      const before = await draw(96, 12)
      const stops = stopsOf(await tree(96, 12))
      await select()
      expect(await draw(96, 12)).not.toEqual(before)
      expect(stopsOf(await tree(96, 12))).toEqual(stops)
    }
    await scrolls(() => act.focusRow('turn-band@fixtures'))
    await act.tab('discover')
    await rt.catalog.load()
    markMods(rt.store, rt.catalog)
    await rt.catalog.show()
    const found = w.state.values.catalogPage.rows.at(-1)?.id
    expect(found).toBeDefined()
    await scrolls(() => act.focusFound(found ?? ''))
    await act.tab('health')
    const items = stopsOf(await tree(96, 12)).filter(key => key.startsWith('health:'))
    expect(items.length).toBeGreaterThan(4)
    await scrolls(() => act.focusHealth((items.at(-1) ?? '').slice('health:'.length)))
  })
})

describe('the line under the list', () => {
  it('wraps the pager under what is staged when both do not fit, the apply key whole', async () => {
    const { act, draw } = await setup()
    await act.toggle('redactor@fixtures')
    for (const columns of [46, 60]) {
      const lines = await draw(columns, 10)
      expect(lines.some(line => line.includes('s: review and apply'))).toBe(true)
      expect(
        lines.some(line => /\d–\d of 5 {2}‹ prev {2}next › {2}g: first {2}b: last/.test(line)),
      ).toBe(true)
      // Every row the pane has, no more: the footer stays in view.
      expect(lines).toHaveLength(10)
    }
  })
})

describe('a tab with nothing to select', () => {
  it('gives the body to what it says, with no detail beside it', async () => {
    const { w, act, draw } = await setup()
    await act.tab('dev')
    w.state.values.dev = { ...w.state.values.dev, rows: [] }
    const lines = await draw(96, 12)
    expect(lines.some(line => line.includes('No mods under development in this session.'))).toBe(
      true,
    )
    expect(lines.join('\n')).not.toMatch(/Select a mod/)
    expect(lines.some(line => line.includes('│'))).toBe(false)
  })
})

describe('a review taller than the pane', () => {
  // What is drawn, not what is in the tree: the pane clips what doesn't fit.
  it('scrolls a declared command one line long row by row, to its last character', async () => {
    const { w, act, draw } = await setup()
    w.state.values.review = {
      action: 'install',
      targets: [{ id: 'cmdmod@cmdmkt', op: 'install', scope: 'user' }],
      notable: [],
      changesRepoFile: false,
      declaredCommand: { text: `printf '%s' ${'a'.repeat(850)}; echo Z`, sha256: 'f'.repeat(64) },
    }
    w.state.values.view = { ...w.state.values.view, stack: ['review'] }
    let frame = await draw(64, 12)
    expect(frame.some(line => line.includes('run it and install'))).toBe(true)
    let seen = false
    for (let step = 0; step < 60 && !seen; step += 1) {
      await act.scroll(1, overlayEnd())
      frame = await draw(64, 12)
      // The command's last character: no other line of the frame ends in Z.
      seen = frame.some(line => line.trimEnd().endsWith('Z'))
    }
    expect(seen).toBe(true)
  })
})

describe('the welcome and the keys in a short pane', () => {
  /** Scrolls the overlay on top to its end, collecting every frame's lines. */
  const scrollThrough = async (
    act: Awaited<ReturnType<typeof setup>>['act'],
    draw: () => Promise<string[]>,
  ) => {
    const frames = [await draw()]
    for (let step = 0; step < 40; step += 1) {
      await act.scroll(1, overlayEnd())
      frames.push(await draw())
    }
    return frames
  }

  it('keeps the welcome’s start key in view and scrolls to each tab it names', async () => {
    const { w, act, draw } = await setup()
    w.state.values.view = { ...w.state.values.view, stack: ['welcome'] }
    const frames = await scrollThrough(act, () => draw(46, 12))
    expect(frames.every(frame => frame.some(line => line.includes('enter: start')))).toBe(true)
    const seen = frames.flat().join('\n')
    for (const tab of ['Installed', 'Discover', 'Dev', 'Health']) expect(seen).toMatch(tab)
    expect(seen).toMatch('what needs you, each with a fix')
  })

  it('scrolls the keys to their last action and the note under them', async () => {
    const { w, act, draw } = await setup()
    w.state.values.view = { ...w.state.values.view, stack: ['help'] }
    const first = await draw(64, 24)
    expect(first.join('\n')).not.toMatch('applied together')
    const seen = (await scrollThrough(act, () => draw(64, 24))).flat().join('\n')
    expect(seen).toMatch('Actions')
    expect(seen).toMatch('applied together with s')
  })
})

describe('a detail too short for every explanation', () => {
  it('names the command that explains each thing the mod can do', async () => {
    const { act, draw } = await setup()
    await act.focusRow('redactor@fixtures')
    // Tall enough for the compact form, too short for the full one.
    const frame = (await draw(96, 20)).join('\n')
    expect(frame).not.toMatch('Reads environment variables that look like secrets (')
    expect(frame).toMatch('/mods info redactor@fixtures explains each one.')
  })
})

describe('what a mod is', () => {
  it('heads its detail with what its plugin.json says, a line when space is short', async () => {
    const { act, draw } = await setup()
    await act.focusRow('redactor@fixtures')
    const said = 'Redacts secrets from what the model reads and posts a digest.'
    expect((await draw(140, 30)).join('\n')).toMatch(said)
    const compact = await draw(96, 20)
    expect(compact.some(line => line.includes('Redacts secrets'))).toBe(true)
    expect(compact.join('\n')).toMatch('/mods info redactor@fixtures explains each one.')
  })
})

describe('installing from a repository', () => {
  /** The hrefs of a tree's Links in document order. */
  const hrefsOf = (node: unknown): string[] =>
    Array.isArray(node)
      ? node.flatMap(hrefsOf)
      : !isNode(node)
        ? []
        : node.type === 'Link'
          ? [String(node.props?.href)]
          : node.children.flatMap(hrefsOf)

  it('links the repository the review installs from, to read before confirming', async () => {
    const { w, tree, draw } = await setup()
    w.state.values.review = {
      action: 'install',
      targets: [{ id: 'guard@m', op: 'install', scope: 'user' }],
      notable: [],
      changesRepoFile: false,
      source: 'o/guard',
    }
    w.state.values.view = { ...w.state.values.view, stack: ['review'] }
    expect(hrefsOf(await tree(96, 30))).toEqual(['https://github.com/o/guard'])
    expect((await draw(96, 30)).join('\n')).toMatch('From the marketplace at github.com/o/guard:')
  })
})
