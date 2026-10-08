// The landing page's mod search (site/src/lib/search.ts): matching, ranking,
// filters, sorts and pages, on hand-made rows and on 3,000 generated ones.
import { describe, expect, it } from 'vitest'
import {
  indexOf,
  installLineOf,
  linkOf,
  type Mod,
  pageLinks,
  pageOf,
  REACH_BITS,
  type Row,
  search,
  shortCount,
  toMod,
} from '../../site/src/lib/search.ts'

const row = (name: string, extra: Partial<Record<keyof Mod, unknown>> = {}): Row => [
  name,
  (extra.description as string) ?? `${name} does a thing`,
  (extra.repo as string) ?? `alice/${name}`,
  (extra.path as string) ?? '',
  (extra.stars as number) ?? 0,
  (extra.pushed as number) ?? 0,
  (extra.reach as number) ?? 0,
  0,
  (extra.check as 0 | 1 | 2) ?? 0,
  (extra.plugin as string) ?? '',
]

const index = indexOf(
  [
    row('meter', { stars: 5, pushed: 3, reach: REACH_BITS.display }),
    row('token-meter', { stars: 9, pushed: 1, reach: REACH_BITS.network, plugin: 'tm@alice' }),
    row('guard', { description: 'stops a meter from running', stars: 50, pushed: 2, check: 2 }),
    row('band', { repo: 'meterworks/band', stars: 1, reach: REACH_BITS.machine }),
  ].map(toMod),
)
const names = (places: readonly number[]) => places.map(i => index.mods[i]?.name)

describe('search', () => {
  it('ranks the name above the rest, then by stars', () => {
    expect(names(search(index, { text: 'meter', sort: 'relevance' }))).toEqual([
      'meter',
      'token-meter',
      'guard',
      'band',
    ])
  })

  it('needs every word, in any field', () => {
    expect(names(search(index, { text: 'METER   running', sort: 'relevance' }))).toEqual(['guard'])
    expect(names(search(index, { text: 'meterworks', sort: 'relevance' }))).toEqual(['band'])
    expect(search(index, { text: 'nothing like it', sort: 'relevance' })).toEqual([])
  })

  it('sorts by stars with no words, and by stars, recency or name when asked', () => {
    expect(names(search(index, { text: '', sort: 'relevance' }))).toEqual([
      'guard',
      'token-meter',
      'meter',
      'band',
    ])
    expect(names(search(index, { text: '', sort: 'recent' }))).toEqual([
      'meter',
      'guard',
      'token-meter',
      'band',
    ])
    expect(names(search(index, { text: '', sort: 'name' }))).toEqual([
      'band',
      'guard',
      'meter',
      'token-meter',
    ])
  })

  it('filters by what a mod reaches, how it installs and whether it validates', () => {
    const query = { text: '', sort: 'stars' as const }
    expect(
      names(search(index, { ...query, without: REACH_BITS.network | REACH_BITS.machine })),
    ).toEqual(['guard', 'meter'])
    expect(names(search(index, { ...query, installable: true }))).toEqual(['token-meter'])
    expect(names(search(index, { ...query, working: true }))).toEqual([
      'token-meter',
      'meter',
      'band',
    ])
  })

  it('stays fast over 3,000 mods', () => {
    const many = indexOf(
      Array.from({ length: 3000 }, (_, i) =>
        toMod(
          row(`mod-${i}`, {
            description: `a mod numbered ${i} with a longer description`.repeat(3),
            stars: i,
          }),
        ),
      ),
    )
    const started = performance.now()
    for (const text of ['m', 'mo', 'mod', 'mod-2', 'mod-29', 'numbered 2', 'zz']) {
      search(many, { text, sort: 'relevance' })
    }
    // Seven keystrokes, well under a frame each on a laptop.
    expect(performance.now() - started).toBeLessThan(200)
  })
})

describe('pages', () => {
  it('clamps the page and says where it starts', () => {
    const matched = Array.from({ length: 95 }, (_, i) => i)
    expect(pageOf(matched, 2, 40)).toMatchObject({ page: 2, pages: 3, total: 95, from: 41 })
    expect(pageOf(matched, 9, 40).items).toEqual(matched.slice(80))
    expect(pageOf(matched, Number.NaN, 40).page).toBe(1)
    expect(pageOf([], 3, 40)).toEqual({ page: 1, pages: 1, total: 0, items: [], from: 0 })
  })

  it('offers the first, the last and the pages around, with gaps', () => {
    expect(pageLinks(1, 1)).toEqual([1])
    expect(pageLinks(1, 3)).toEqual([1, 2, 3])
    expect(pageLinks(5, 10)).toEqual([1, 0, 4, 5, 6, 0, 10])
    expect(pageLinks(3, 10)).toEqual([1, 2, 3, 4, 0, 10])
  })
})

describe('what a result links to', () => {
  it('links the folder and says how to install it', () => {
    const listed = toMod(
      row('band', { repo: 'a/mods', path: 'plugins/band', plugin: 'band@a-mods' }),
    )
    expect(linkOf(listed)).toBe('https://github.com/a/mods/tree/HEAD/plugins/band')
    expect(installLineOf(listed)).toBe('/plugin install band --marketplace a/mods')
    const bare = toMod(row('solo', { repo: 'b/solo' }))
    expect(linkOf(bare)).toBe('https://github.com/b/solo')
    expect(installLineOf(bare)).toBe(
      'git clone https://github.com/b/solo && claude --plugin-dir solo',
    )
    const nested = toMod(row('x', { repo: 'b/r', path: 'p/x' }))
    expect(installLineOf(nested)).toBe(
      'git clone https://github.com/b/r && claude --plugin-dir r/p/x',
    )
    expect([shortCount(999), shortCount(1234), shortCount(12_345)]).toEqual(['999', '1.2k', '12k'])
  })
})
