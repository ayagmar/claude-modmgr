// The landing page's terminal mock (PLAN §8, R23): frames drawn by the real
// ui/Pane.tsx over the fixture world the tests use, through the real actions,
// rendered to text. `site/src/data/demo.ts` must match what this draws, so the
// site can't drift from the UI; `RENDER_DEMO=1 pnpm vitest run test/demo`
// writes it again.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../../plugin/hooks/domain/config.ts'
import { createActions } from '../../plugin/hooks/services/actions.ts'
import { createRuntime } from '../../plugin/hooks/services/runtime.ts'
import { drawPane } from '../../plugin/hooks/ui/Pane.tsx'
import type { View } from '../../plugin/types/index.d.ts'
import { runs } from '../domain/fixtures/cli-runs.ts'
import { bumpTurnBand, fixtureCli, markMods } from '../services/cli-world.ts'
import { out, world } from '../services/fakes.ts'
import { ELEMENTS, installJsx, type Line, render, tidy } from './render.ts'

const COLUMNS = 96
const ROWS = 20
const DEMO = join(import.meta.dirname, '../../site/src/data/demo.ts')

/**
 * Sample mods in the fixtures marketplace, as Discover shows them once the
 * index has classified them. The official catalogue in the fixtures holds none
 * known to be mods, and calling a real plugin a mod would mislead.
 */
const SAMPLES = [
  ['secret-scrub', 'Masks tokens and keys in tool output before the model reads it.', 4210],
  ['commit-guard', 'Stops a commit while the tests fail, and says which ones.', 2870],
  ['turn-timer', 'Shows how long the current turn has run, above the prompt.', 1930],
  ['cost-meter', 'Counts the tokens each turn spends, on the status line.', 1240],
  ['quiet-hours', 'Holds notifications while a turn runs; shows them after.', 610],
] as const
const SCRUB = 'secret-scrub@fixtures'

/** The fixture catalogue with the samples in it, as `claude plugin list --available --json` says it. */
const catalogue = (): string => {
  const listed = JSON.parse(runs['list-available'].stdout) as { available: unknown[] }
  const samples = SAMPLES.map(([name, description, installCount], index) => ({
    pluginId: `${name}@fixtures`,
    name,
    description,
    marketplaceName: 'fixtures',
    version: '1.0.0',
    source: { source: 'github', repo: `modmgr-fixtures/${name}`, sha: String(index).repeat(40) },
    installCount,
  }))
  return JSON.stringify({ ...listed, available: [...samples, ...listed.available] })
}

type Frame = { readonly title: string; readonly caption: string; readonly lines: Line[] }

const frames = async (): Promise<Frame[]> => {
  installJsx()
  const w = world()
  fixtureCli(w.process)
    .when(['list', '--json', '--available'], out(catalogue()))
    .when(['marketplace', 'list'], out(runs['marketplace-list'].stdout))
  const rt = createRuntime(w.ports, DEFAULT_CONFIG, 'demo')
  w.state.values.queue = { owner: 'demo', jobs: [] }
  await rt.store.load()
  await rt.registry.refresh()
  // turn-band 0.4.0 now runs programs: the capability diff the site shows.
  bumpTurnBand(w.process)
    // Later answers win: the catalogue's own, after the bump's `list --json`.
    .when(['list', '--json', '--available'], out(catalogue()))
  await rt.registry.refresh()
  const act = createActions(w.ports, rt)
  const draw = async (title: string, caption: string): Promise<Frame> => {
    const tree = await drawPane(
      { el: ELEMENTS as never, surface: 'terminal', read: w.state.read, act },
      { bodyColumns: COLUMNS, bodyRows: ROWS, isFocused: true },
    )
    return { title, caption, lines: render(tree, COLUMNS).map(tidy) }
  }
  const setView = (change: Partial<View>) => {
    w.state.values.view = { ...w.state.values.view, ...change }
  }
  const shown: Frame[] = []
  // The ring on redactor: beside the list, its detail says what it can do.
  await act.focusRow('redactor@fixtures')
  shown.push(await draw('Installed', 'Every mod, what it can do at a glance, and what changed.'))
  await act.open('turn-band@fixtures')
  shown.push(
    await draw('Detail', 'An update gave turn-band a new power: said before it surprises you.'),
  )
  await act.back()
  await act.tab('discover')
  markMods(
    rt.store,
    rt.catalog,
    SAMPLES.map(([name]) => `${name}@fixtures`),
  )
  // As once the index is read: every entry it covers is known, and nothing is left to probe.
  rt.detector.dispose()
  await rt.detector.whenIdle()
  const { total } = w.state.values.detect
  w.state.values.detect = { checked: total, total, found: SAMPLES.length, running: false }
  setView({ sort: 'installs', found: SCRUB })
  await rt.catalog.show()
  w.state.values.detect = { checked: total, total, found: SAMPLES.length, running: false }
  shown.push(await draw('Discover', 'The mods in every marketplace you have, found at once.'))
  await act.install(SCRUB)
  shown.push(await draw('Review', 'Nothing runs before you read what will run, and where.'))
  await act.cancel()
  await rt.dev.notice('redactor: tool.call hook failed: it threw')
  await act.tab('health')
  shown.push(await draw('Health', 'What needs you, worst first, each with a one-key fix.'))
  return shown
}

const fileOf = (shown: readonly Frame[]): string =>
  [
    '// Generated by test/demo/demo.test.ts from ui/Pane.tsx over the fixture world.',
    '// Do not edit: `RENDER_DEMO=1 pnpm vitest run test/demo` writes it again.',
    '',
    'export type Segment = {',
    '  readonly text: string',
    '  readonly tone?: string',
    '  readonly bold?: true',
    '  readonly dim?: true',
    '  readonly underline?: true',
    '  readonly ring?: true',
    '}',
    'export type Frame = {',
    '  readonly title: string',
    '  readonly caption: string',
    '  readonly lines: readonly (readonly Segment[])[]',
    '}',
    '',
    `export const COLUMNS = ${COLUMNS}`,
    '',
    `export const FRAMES: readonly Frame[] = ${JSON.stringify(shown, null, 2)}`,
    '',
  ].join('\n')

describe('the landing page’s demo', () => {
  it('matches what the dialog draws', async () => {
    const shown = await frames()
    expect(shown.map(frame => frame.title)).toEqual([
      'Installed',
      'Detail',
      'Discover',
      'Review',
      'Health',
    ])
    for (const frame of shown) {
      for (const line of frame.lines) {
        expect(line.reduce((sum, seg) => sum + [...seg.text].length, 0)).toBeLessThanOrEqual(
          COLUMNS,
        )
      }
    }
    const text = fileOf(shown)
    if (process.env.RENDER_DEMO === '1') writeFileSync(DEMO, text)
    expect(readFileSync(DEMO, 'utf8')).toBe(text)
  })
})
