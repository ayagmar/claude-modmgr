// The dialog's layout at sizes the landing page doesn't show, drawn by the
// real ui/Pane.tsx over the fixture world with the demo's renderer.
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../../plugin/hooks/domain/config.ts'
import { createActions } from '../../plugin/hooks/services/actions.ts'
import { createRuntime } from '../../plugin/hooks/services/runtime.ts'
import { drawPane } from '../../plugin/hooks/ui/Pane.tsx'
import { runs } from '../domain/fixtures/cli-runs.ts'
import { fixtureCli, markMods } from '../services/cli-world.ts'
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
      { el: ELEMENTS as never, surface: 'terminal', read: w.state.read, act },
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
    await rt.dev.notice('redactor: tool.call hook failed: it threw')
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
      expect(lines.some(line => /\d–\d of 5 {2}g: first {2}b: last/.test(line))).toBe(true)
      // Every row the pane has, no more: the footer stays in view.
      expect(lines).toHaveLength(10)
    }
  })
})
