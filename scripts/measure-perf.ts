// Measures the pure computations behind the performance budgets on this machine and
// prints a Markdown table for docs/PERF.md: the catalogue index and a keystroke
// over 3.5k and 10k entries, and what a pane draw computes over 200 mods
// (rows, window, summary, Health's items). The host-bound budgets (first paint,
// CLI runs, session.start) are measured live with `debugTimings` (docs/PERF.md).
//
// It reuses the vitest benchmark's synthetic catalogue generator (test/domain/fixtures).
//
//   node scripts/measure-perf.ts

import { buildIndex, type CatalogKind, matchAll, windowOf } from '../plugin/hooks/domain/catalog.ts'
import { healthItemsOf } from '../plugin/hooks/domain/health.ts'
import { INITIAL } from '../plugin/hooks/domain/state.ts'
import { filterRows, selectedRow, summaryOf, windowAround } from '../plugin/hooks/domain/view.ts'
import type { ModRow } from '../plugin/types/index.d.ts'
import { generateCatalog } from '../test/domain/fixtures/synthetic.ts'

const ROUNDS = 25

const stats = (times: number[]): { median: number; p95: number } => {
  const sorted = [...times].sort((a, b) => a - b)
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? Number.NaN
  return { median: at(0.5), p95: at(0.95) }
}

const measure = (fn: () => void, rounds = ROUNDS): { median: number; p95: number } => {
  fn() // warm up
  const times: number[] = []
  for (let i = 0; i < rounds; i += 1) {
    const start = performance.now()
    fn()
    times.push(performance.now() - start)
  }
  return stats(times)
}

const rows: string[] = []
const row = (what: string, budget: string, result: { median: number; p95: number }) =>
  rows.push(
    `| ${what} | ${budget} | ${result.median.toFixed(2)} ms | ${result.p95.toFixed(2)} ms |`,
  )

const kindOf = (id: string): CatalogKind => (id.length % 3 === 0 ? 'mod' : 'plain')
const typed = ['r', 're', 'rev', 'revi', 'revie', 'review', 'review g', 'review gi', 'review git']

for (const size of [3_545, 10_000]) {
  const entries = generateCatalog(size)
  row(
    `catalogue index build, ${size.toLocaleString('en-US')} entries`,
    '≤ 1.5 s with the CLI read',
    measure(() => {
      buildIndex(entries)
    }, 9),
  )
  const index = buildIndex(entries)
  for (const kind of ['mods', 'all'] as const) {
    let i = 0
    row(
      `keystroke (match + window), ${size.toLocaleString('en-US')} entries, ${kind}`,
      '< 16 ms',
      measure(() => {
        const text = typed[i % typed.length] ?? ''
        i += 1
        windowOf(matchAll(index, { text, kind, sort: 'installs' }, kindOf), undefined)
      }, 90),
    )
  }
}

const mods: ModRow[] = Array.from({ length: 200 }, (_, n) => ({
  id: `mod-${n}@m`,
  name: `mod-${n}`,
  version: '1.0.0',
  origin: 'marketplace',
  scope: 'user',
  enabled: n % 4 !== 0,
  toggleable: true,
  notableCount: n % 3,
  problems: n % 17 === 0 ? 1 : 0,
  mixed: false,
  ...(n % 11 === 0 ? { updateTo: '1.1.0' } : {}),
}))
const view = { ...INITIAL.view, selected: 'mod-150@m' }
row(
  'a row move over 200 mods (filter, selection, window, summary)',
  '< 16 ms',
  measure(() => {
    const shown = filterRows(mods, view.query)
    const at = shown.indexOf(selectedRow(view, mods) ?? (shown[0] as ModRow))
    windowAround(shown.length, at, 20)
    summaryOf({ attention: INITIAL.attention, queue: INITIAL.queue, mods })
  }, 200),
)
row(
  "Health's items over 200 mods",
  'part of a draw',
  measure(() => {
    healthItemsOf({
      mods,
      dev: INITIAL.dev,
      attention: INITIAL.attention,
      degraded: INITIAL.degraded,
      sync: INITIAL.sync,
      detect: INITIAL.detect,
      queue: INITIAL.queue,
      facts: { ...INITIAL.health, at: 1 },
    })
  }, 200),
)

console.log(
  `Node ${process.version}, ${ROUNDS}+ rounds each (warm), ${new Date().toISOString().slice(0, 10)}\n`,
)
console.log('| What | Budget | Median | p95 |')
console.log('|---|---|---|---|')
for (const line of rows) console.log(line)
