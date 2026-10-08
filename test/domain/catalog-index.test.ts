import { describe, expect, it } from 'vitest'
import { buildIndex, type CatalogKind, matchAll } from '../../plugin/hooks/domain/catalog.ts'
import {
  fromIndex,
  INDEX_MAX_BYTES,
  indexText,
  parseIndex,
} from '../../plugin/hooks/domain/catalog-index.ts'
import type { CatalogEntry } from '../../plugin/hooks/domain/cli-results.ts'
import { walkProbe } from '../../plugin/hooks/domain/detector.ts'
import { openKey } from '../../plugin/hooks/domain/store-schema.ts'

const SHA = 'a'.repeat(40)
const OTHER = 'b'.repeat(40)

const entry = (id: string, extra: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id: id as CatalogEntry['id'],
  name: id.split('@')[0] ?? id,
  description: '',
  marketplace: id.split('@')[1] ?? 'm',
  source: { kind: 'github', repo: 'o/r', sha: SHA },
  ...extra,
})

const file = (entries: unknown, more: Record<string, unknown> = {}): string =>
  JSON.stringify({ v: 1, at: 5, entries, ...more })

describe('parseIndex', () => {
  it('reads a well-formed index', () => {
    const parsed = parseIndex(file({ 'a@m': [SHA, 'mod'], 'b@m': ['local:1.0.0', 'plain'] }))
    expect(parsed).toEqual({
      ok: true,
      value: { v: 1, at: 5, entries: { 'a@m': [SHA, 'mod'], 'b@m': ['local:1.0.0', 'plain'] } },
    })
  })

  it.each([
    ['not JSON', '{'],
    ['not an object', '[]'],
    ['another version', file({}, { v: 2 })],
    ['no build time', file({}, { at: -1 })],
    ['no entries', file([])],
    ['a bad id', file({ 'no id here': [SHA, 'mod'] })],
    ['a bad kind', file({ 'a@m': [SHA, 'plugin'] })],
    ['a short entry', file({ 'a@m': [SHA] })],
    ['an empty key', file({ 'a@m': ['', 'mod'] })],
    ['a long key', file({ 'a@m': ['k'.repeat(101), 'mod'] })],
  ])('rejects %s whole', (_what, text) => {
    expect(parseIndex(text).ok).toBe(false)
  })

  it('refuses a body past its cap before parsing it', () => {
    expect(parseIndex(' '.repeat(INDEX_MAX_BYTES + 1))).toMatchObject({
      ok: false,
      error: { message: 'the index is too large' },
    })
  })
})

describe('fromIndex', () => {
  const index = {
    v: 1,
    at: 5,
    entries: {
      'same@m': [SHA, 'mod'],
      'moved@m': [OTHER, 'mod'],
      'cached@m': [SHA, 'hooks'],
      'local@m': ['local:2.0.0', 'plain'],
      'unsure@m': [SHA, 'unknown'],
    },
  } as const

  it('gives a remote entry’s kind only where the key is its own and the cache lacks it', () => {
    const entries = [
      entry('same@m'),
      entry('moved@m'),
      entry('cached@m'),
      entry('local@m', { source: { kind: 'relative', path: './x' }, version: '2.0.0' }),
      entry('unlisted@m'),
      entry('unpinned@m', { source: { kind: 'github', repo: 'o/r' } }),
      entry('unsure@m'),
    ]
    // A local entry is read from disk; `unknown` is no verdict.
    const given = fromIndex(entries, index, { 'cached@m': [SHA, 'hooks'] })
    expect(given).toEqual([['same@m', [SHA, 'mod']]])
  })

  it('a newer index corrects a kind cached at the same key', () => {
    const cache = { 'cached@m': [SHA, 'plain'] } as const
    expect(fromIndex([entry('cached@m')], index, cache)).toEqual([])
    expect(fromIndex([entry('cached@m')], index, cache, true)).toEqual([
      ['cached@m', [SHA, 'hooks']],
    ])
    expect(fromIndex([entry('cached@m')], index, { 'cached@m': [SHA, 'hooks'] }, true)).toEqual([])
  })

  it('takes the index over a cached kind at another key', () => {
    expect(fromIndex([entry('same@m')], index, { 'same@m': [OTHER, 'plain'] })).toEqual([
      ['same@m', [SHA, 'mod']],
    ])
  })
})

describe('indexText', () => {
  it('writes entries sorted by id, which parseIndex reads back', () => {
    const text = indexText(
      7,
      new Map([
        ['b@m', [SHA, 'plain'] as const],
        ['a@m', [OTHER, 'mod'] as const],
      ]),
    )
    expect(text).toBe(
      `{"v":1,"at":7,"entries":{"a@m":["${OTHER}","mod"],"b@m":["${SHA}","plain"]}}\n`,
    )
    expect(parseIndex(text).ok).toBe(true)
  })
})

describe('walkProbe', () => {
  it('follows the manifest to its hooks file', async () => {
    const files: Record<string, string> = {
      '/m/p/.claude-plugin/plugin.json': JSON.stringify({ hooks: './h/my hooks.json' }),
      '/m/p/h/my hooks.json': JSON.stringify({ modules: ['./r.ts'] }),
    }
    const kind = await walkProbe('/m/p/', false, async location =>
      files[location] === undefined ? { status: 404 } : { status: 200, text: files[location] },
    )
    expect(kind).toBe('mod')
  })

  it('stops when no more requests may go out', async () => {
    const asked: string[] = []
    const kind = await walkProbe(
      'https://raw.githubusercontent.com/o/r/x/',
      true,
      async location => {
        asked.push(location)
        return { status: 404 }
      },
      () => false,
    )
    expect(kind).toBeUndefined()
    expect(asked).toHaveLength(1)
  })
})

describe('the index check in the store', () => {
  it('keeps the index check’s times and drops anything else', () => {
    expect(openKey('catalogIndex', { v: 1, data: { at: 3, built: 2, more: true } }).data).toEqual({
      at: 3,
      built: 2,
    })
    expect(openKey('catalogIndex', { v: 1, data: { at: -1 } }).data).toEqual({})
  })
})
