// What a result says about a mod (site/src/lib/present.ts): the words both
// the prerendered first page and the browser's rows use.
import { describe, expect, it } from 'vitest'
import { badgesOf, dayText, notablesOf, rangeText, reachesOf } from '../../site/src/lib/present.ts'
import { NOTABLE_BITS, pageOf, REACH_BITS } from '../../site/src/lib/search.ts'

describe('present', () => {
  it("names what a mod reaches in capabilities.ts's words and order", () => {
    const mod = { reach: REACH_BITS.display | REACH_BITS.network | REACH_BITS.machine }
    expect(reachesOf(mod)).toEqual(['Your machine', 'Network', 'Display only'])
    expect(badgesOf(mod)).toEqual([
      { short: 'Machine', full: 'Your machine' },
      { short: 'Network', full: 'Network' },
    ])
    expect(badgesOf({ reach: REACH_BITS.display })).toEqual([
      { short: 'Display only', full: 'Display only' },
    ])
    expect(badgesOf({ reach: 0 })).toEqual([])
  })

  it('says the notable combinations, most serious first', () => {
    const notable = NOTABLE_BITS['starts-model-calls'] | NOTABLE_BITS['runs-programs']
    expect(notablesOf({ notable })).toEqual([
      'Can run programs or change files on your machine',
      'Starts model calls (costs tokens)',
    ])
  })

  it('dates a push the same anywhere, and says where a page starts', () => {
    expect(dayText(20_000)).toBe('Oct 4, 2024')
    const matched = Array.from({ length: 2692 }, (_, i) => i)
    expect(rangeText(pageOf(matched, 2, 40))).toBe('41–80 of 2,692 mods')
    expect(rangeText(pageOf([7], 1, 40))).toBe('1–1 of 1 mod')
    expect(rangeText(pageOf([], 1, 40))).toBe('No mods match')
  })
})
