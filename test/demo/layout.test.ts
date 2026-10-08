// The dialog's layout at sizes the landing page doesn't show, drawn by the
// real ui/Pane.tsx over the fixture world with the demo's renderer.
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../../plugin/hooks/domain/config.ts'
import { createActions } from '../../plugin/hooks/services/actions.ts'
import { createRuntime } from '../../plugin/hooks/services/runtime.ts'
import { drawPane } from '../../plugin/hooks/ui/Pane.tsx'
import { fixtureCli } from '../services/cli-world.ts'
import { world } from '../services/fakes.ts'
import { ELEMENTS, installJsx, render } from './render.ts'

const setup = async () => {
  installJsx()
  const w = world()
  fixtureCli(w.process)
  const rt = createRuntime(w.ports, DEFAULT_CONFIG, 'layout')
  w.state.values.queue = { owner: 'layout', jobs: [] }
  await rt.store.load()
  await rt.registry.refresh()
  const act = createActions(w.ports, rt)
  const draw = async (bodyColumns: number, bodyRows: number) =>
    render(
      await drawPane(
        { el: ELEMENTS as never, surface: 'terminal', read: w.state.read, act },
        { bodyColumns, bodyRows, isFocused: true },
      ),
      bodyColumns,
    ).map(line => line.map(segment => segment.text).join(''))
  return { act, draw }
}

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
