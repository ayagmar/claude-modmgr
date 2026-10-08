import { describe, expect, it } from 'vitest'
import {
  buildIndex,
  type CatalogKind,
  formatCount,
  matchAll,
  tokens,
  windowOf,
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

describe('matching', () => {
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
  const rows = (text: string, sort: 'name' | 'installs' = 'name') =>
    windowOf(matchAll(index, { text, sort }, kindOf), undefined).rows

  it('keeps one kind when asked', () => {
    expect(matchAll(index, { text: '', sort: 'name', only: 'mod' }, kindOf)).toHaveLength(2)
    expect(matchAll(index, { text: '', sort: 'name' }, kindOf)).toHaveLength(4)
  })

  it('matches every word anywhere in name, description, marketplace or id', () => {
    const found = rows('  SECRETS  community ')
    expect(found.map(row => row.id)).toEqual(['redactor@community'])
    expect(found[0]).toMatchObject({
      kind: 'mod',
      blurb: 'Redacts secrets',
      marketplace: 'community',
    })
    expect(rows('nothing-matches')).toEqual([])
  })

  it('carries installs only when known', () => {
    const found = windowOf(
      matchAll(index, { text: '', sort: 'installs', only: 'mod' }, kindOf),
      undefined,
    ).rows
    expect(found[0]).toMatchObject({ id: 'turn-band@official', installs: 1500 })
    expect(found[1]).not.toHaveProperty('installs')
  })

  it('works on the real catalogue', () => {
    const matched = matchAll(buildIndex(real), { text: 'git', sort: 'installs' }, allKinds)
    expect(matched.length).toBeGreaterThan(0)
    expect(windowOf(matched, undefined).rows.length).toBeLessThanOrEqual(50)
  })

  it('sanitises hostile catalogue text', () => {
    const hostile = buildIndex(syntheticCatalog)
    const found = windowOf(
      matchAll(hostile, { text: '', sort: 'name' }, allKinds),
      undefined,
      100,
    ).rows
    for (const row of found) {
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
})
