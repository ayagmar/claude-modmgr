// PLAN §6: a filter keystroke over the catalogue computes in < 16 ms. Measured
// at today's size (3.5k) and at 10k for growth (§11). The budget is asserted on
// the median of several runs, with headroom for slow CI machines.
import { describe, expect, it } from 'vitest'
import {
  buildIndex,
  type CatalogKind,
  matchAll,
  windowOf,
} from '../../plugin/hooks/domain/catalog.ts'
import { generateCatalog } from './fixtures/synthetic.ts'

const KEYSTROKE_BUDGET_MS = 16
const CI_HEADROOM = 2

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN
}

const kindOf = (id: string): CatalogKind => (id.length % 3 === 0 ? 'mod' : 'plain')

describe.each([3_545, 10_000])('search over %d entries', size => {
  const index = buildIndex(generateCatalog(size))
  // The prefixes a person types, one keystroke at a time.
  const typed = ['r', 're', 'rev', 'revi', 'revie', 'review', 'review g', 'review gi', 'review git']

  it.each(['mods', 'all'] as const)(
    `keeps a keystroke under ${KEYSTROKE_BUDGET_MS} ms (kind %s)`,
    kind => {
      const times: number[] = []
      for (let round = 0; round < 5; round += 1) {
        for (const text of typed) {
          const start = performance.now()
          // What a keystroke runs: one pass, then the window `$.state` gets.
          windowOf(matchAll(index, { text, kind, sort: 'installs' }, kindOf), undefined)
          times.push(performance.now() - start)
        }
      }
      expect(median(times)).toBeLessThan(KEYSTROKE_BUDGET_MS * CI_HEADROOM)
    },
  )

  it('builds the index in well under a second', () => {
    const start = performance.now()
    buildIndex(generateCatalog(size))
    expect(performance.now() - start).toBeLessThan(1000)
  })
})
