import { describe, expect, it } from 'vitest'
import {
  buildIndex,
  type CatalogKind,
  clampPage,
  formatCount,
  pageLabel,
  search,
  tokens,
} from '../../plugin/hooks/domain/catalog.ts'
import { type CatalogEntry, parseAvailable } from '../../plugin/hooks/domain/cli-results.ts'
import { hasHiddenCharacters } from '../../plugin/hooks/domain/sanitize.ts'
import { runs } from './fixtures/cli-runs.ts'
import { syntheticCatalog } from './fixtures/synthetic.ts'

const real = (() => {
  const parsed = parseAvailable(runs['list-available'])
  if (!parsed.ok) throw new Error(parsed.error.message)
  return parsed.value.available.items
})()

const entry = (id: string, extra: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id: id as CatalogEntry['id'],
  name: id.split('@')[0] ?? id,
  description: '',
  marketplace: id.split('@')[1] ?? 'm',
  source: { kind: 'relative', path: './x' },
  ...extra,
})

const allKinds = (): CatalogKind => 'mod'

describe('buildIndex', () => {
  it('indexes the real catalogue and drops duplicate ids', () => {
    const index = buildIndex([...real, ...real.slice(0, 5)])
    expect(index.size).toBe(real.length)
  })

  it('sorts by installs (unknown last), name and marketplace', () => {
    const index = buildIndex([
      entry('b@m2', { installs: 10 }),
      entry('a@m3'),
      entry('c@m1', { installs: 500 }),
    ])
    expect(index.order.installs.map(item => item.entry.id)).toEqual(['c@m1', 'b@m2', 'a@m3'])
    expect(index.order.name.map(item => item.entry.id)).toEqual(['a@m3', 'b@m2', 'c@m1'])
    expect(index.order.marketplace.map(item => item.entry.id)).toEqual(['c@m1', 'b@m2', 'a@m3'])
  })
})

describe('search', () => {
  const index = buildIndex([
    entry('turn-band@official', { description: 'Shows last-turn duration', installs: 1500 }),
    entry('redactor@community', { description: 'Redacts secrets' }),
    entry('quiet-bash@official', { description: 'Formatter after Bash' }),
    entry('docs@official', { description: 'A skill for docs' }),
  ])
  const kinds: Record<string, CatalogKind> = {
    'turn-band@official': 'mod',
    'redactor@community': 'mod',
    'quiet-bash@official': 'hooks',
    'docs@official': 'plain',
  }
  const kindOf = (id: string): CatalogKind => kinds[id] ?? 'unknown'

  it('filters by kind', () => {
    const query = { text: '', sort: 'name', page: 0 } as const
    expect(search(index, { ...query, kind: 'mods' }, kindOf).matched).toBe(2)
    expect(search(index, { ...query, kind: 'hooks' }, kindOf).matched).toBe(3)
    expect(search(index, { ...query, kind: 'all' }, kindOf).matched).toBe(4)
  })

  it('matches every word anywhere in name, description, marketplace or id', () => {
    const result = search(
      index,
      { text: '  SECRETS  community ', kind: 'all', sort: 'name', page: 0 },
      kindOf,
    )
    expect(result.rows.map(row => row.id)).toEqual(['redactor@community'])
    expect(result.rows[0]).toMatchObject({
      kind: 'mod',
      blurb: 'Redacts secrets',
      marketplace: 'community',
    })
    expect(
      search(index, { text: 'nothing-matches', kind: 'all', sort: 'name', page: 0 }, kindOf)
        .matched,
    ).toBe(0)
  })

  it('carries installs only when known', () => {
    const rows = search(index, { text: '', kind: 'mods', sort: 'installs', page: 0 }, kindOf).rows
    expect(rows[0]).toMatchObject({ id: 'turn-band@official', installs: 1500 })
    expect(rows[1]).not.toHaveProperty('installs')
  })

  it('pages and clamps', () => {
    const query = { text: '', kind: 'all', sort: 'name', pageSize: 3 } as const
    const second = search(index, { ...query, page: 1 }, kindOf)
    expect(second).toMatchObject({ page: 1, pages: 2, matched: 4, total: 4 })
    expect(second.rows).toHaveLength(1)
    expect(search(index, { ...query, page: 99 }, kindOf).page).toBe(1)
    expect(search(index, { ...query, page: -2 }, kindOf).page).toBe(0)
  })

  it('works on the real catalogue', () => {
    const result = search(
      buildIndex(real),
      { text: 'git', kind: 'all', sort: 'installs', page: 0 },
      allKinds,
    )
    expect(result.matched).toBeGreaterThan(0)
    expect(result.rows.length).toBeLessThanOrEqual(50)
  })

  it('sanitises hostile catalogue text', () => {
    const hostile = buildIndex(syntheticCatalog)
    const rows = search(
      hostile,
      { text: '', kind: 'all', sort: 'name', page: 0, pageSize: 100 },
      allKinds,
    ).rows
    for (const row of rows) {
      expect(hasHiddenCharacters(row.name)).toBe(false)
      expect(hasHiddenCharacters(row.blurb)).toBe(false)
      expect(Array.from(row.name).length).toBeLessThanOrEqual(64)
      expect(Array.from(row.blurb).length).toBeLessThanOrEqual(140)
    }
  })
})

describe('helpers', () => {
  it('tokenises', () => {
    expect(tokens('  Foo\tBAR ')).toEqual(['foo', 'bar'])
    expect(tokens('')).toEqual([])
  })
  it.each([
    [0, '0'],
    [999, '999'],
    [1000, '1k'],
    [1540, '1.5k'],
    [12_345, '12k'],
    [3_456_789, '3.4M'],
    [2_000_000, '2M'],
  ])('formatCount(%d) = %s', (count, text) => expect(formatCount(count)).toBe(text))
  it('labels pages', () => {
    expect(pageLabel({ page: 1, matched: 312 }, 20)).toBe('21–40 of 312')
    expect(pageLabel({ page: 0, matched: 0 })).toBe('0 of 0')
    expect(pageLabel({ page: 6, matched: 312 })).toBe('301–312 of 312')
  })
  it('clamps pages', () => {
    expect(clampPage(Number.NaN, 3)).toBe(0)
    expect(clampPage(2.7, 3)).toBe(2)
    expect(clampPage(5, 0)).toBe(0)
  })
})
