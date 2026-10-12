// A first catalogue sync writes about 3,400 entries in one batch, on the
// module's event loop. It used to copy the map per entry: seconds, past the
// engine's 5 s hook timeout on a slow machine.
import { describe, expect, it } from 'vitest'
import { lruSetMany } from '../../plugin/hooks/domain/lru.ts'

const BATCH_BUDGET_MS = 100

const entries = (count: number, prefix: string): [string, number][] =>
  Array.from({ length: count }, (_, i) => [`${prefix}${i}`, i])

describe('lruSetMany at catalogue scale', () => {
  it(`writes 3,400 entries over 3,000 kept ones in under ${BATCH_BUDGET_MS} ms`, () => {
    const kept = Object.fromEntries(entries(3_000, 'old'))
    const start = performance.now()
    const next = lruSetMany(kept, entries(3_400, 'new'), 5_000)
    expect(performance.now() - start).toBeLessThan(BATCH_BUDGET_MS)
    expect(Object.keys(next)).toHaveLength(5_000)
  })

  it('makes a re-written key the newest and drops the oldest past the cap', () => {
    const next = lruSetMany(
      { a: 1, b: 2, c: 3 },
      [
        ['a', 9],
        ['d', 4],
      ],
      3,
    )
    expect(Object.entries(next)).toEqual([
      ['c', 3],
      ['a', 9],
      ['d', 4],
    ])
  })
})
