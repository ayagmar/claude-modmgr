// What a result says about a mod (site/src/lib/present.ts): the words both
// the prerendered first page and the browser's rows use.
import { describe, expect, it } from 'vitest'
import {
  badgesOf,
  dayText,
  flagParts,
  installNoteOf,
  notablesOf,
  pinsOf,
  rangeText,
  reachesOf,
  sourceOf,
} from '../../site/src/lib/present.ts'
import { installLineOf, NOTABLE_BITS, pageOf, REACH_BITS } from '../../site/src/lib/search.ts'

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

  it('gives the datasheet all seven pins, set where the mod reaches', () => {
    const pins = pinsOf({ reach: REACH_BITS.machine | REACH_BITS.display })
    expect(pins.map(pin => pin.label)).toEqual([
      'Your machine',
      'Network',
      'Session content',
      'What the model sees',
      'Tools and turns',
      'Other plugins',
      'Display only',
    ])
    expect(pins.filter(pin => pin.on).map(pin => pin.label)).toEqual([
      'Your machine',
      'Display only',
    ])
  })

  it('splits an install line before its flags and puts it back the same', () => {
    const mod = {
      name: 'band',
      description: '',
      repo: 'someone/mods',
      path: 'band',
      stars: 0,
      pushed: 0,
      reach: 0,
      notable: 0,
      check: 0 as const,
      plugin: 'band',
      marketplace: 'mods',
    }
    const line = installLineOf(mod)
    expect(flagParts(line)).toEqual(['/plugin install band', '--marketplace someone/mods'])
    expect(flagParts(line).join(' ')).toBe(line)
    expect(sourceOf(mod)).toBe('someone/mods/band')
    expect(sourceOf({ ...mod, path: '' })).toBe('someone/mods')
    expect(installNoteOf(mod)).toBe(
      'Adds the marketplace in someone/mods to your user settings, then installs band.',
    )
    expect(installNoteOf({ repo: 'someone/mods' })).toMatch(/^someone\/mods has no marketplace/)
  })
})
