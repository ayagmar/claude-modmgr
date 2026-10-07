import { describe, expect, it } from 'vitest'
import {
  isPseudoMarketplace,
  parseAbsolutePath,
  parseMarketplaceName,
  parsePluginId,
  parseScope,
  parseSha256,
  parseToggleScope,
  splitPluginId,
} from '../../plugin/hooks/domain/ids.ts'
import {
  arr,
  bool,
  compact,
  num,
  parseJson,
  rec,
  str,
  strings,
} from '../../plugin/hooks/domain/json.ts'
import { lruSet, lruSetMany, lruTouch, lruTrim } from '../../plugin/hooks/domain/lru.ts'
import {
  all,
  andThen,
  type ErrorKind,
  err,
  explain,
  fail,
  map,
  ok,
  unwrapOr,
} from '../../plugin/hooks/domain/result.ts'
import {
  hasHiddenCharacters,
  sanitize,
  tailLines,
  truncate,
} from '../../plugin/hooks/domain/sanitize.ts'

describe('result', () => {
  it('maps, chains and unwraps', () => {
    expect(map(ok(2), n => n * 2)).toEqual(ok(4))
    expect(map(err('x'), (n: number) => n * 2)).toEqual(err('x'))
    expect(andThen(ok(2), n => ok(n + 1))).toEqual(ok(3))
    expect(andThen(err('x'), (n: number) => ok(n))).toEqual(err('x'))
    expect(unwrapOr(err('x'), 5)).toBe(5)
    expect(unwrapOr(ok(1), 5)).toBe(1)
    expect(all([ok(1), ok(2)])).toEqual(ok([1, 2]))
    expect(all([ok(1), err('a'), err('b')])).toEqual(err('a'))
  })

  it('keeps a code only when given', () => {
    expect(fail('timeout', 'slow')).toEqual(err({ kind: 'timeout', message: 'slow' }))
    expect(fail('cli-failed', 'no', 'plugin_not_found').error.code).toBe('plugin_not_found')
  })

  it('explains every kind with a sentence and a next step', () => {
    const kinds: ErrorKind[] = [
      'cli-failed',
      'timeout',
      'parse',
      'network',
      'rate-limited',
      'rejected',
      'unavailable',
      'conflict',
      'store-full',
      'invalid',
    ]
    for (const kind of kinds) {
      const { sentence, next } = explain({ kind, message: '' })
      expect(sentence).toMatch(/\.$/)
      expect(next).toMatch(/\.$/)
    }
  })
})

describe('ids', () => {
  it.each(['turn-band@claude-plugins-official', 'a@b', 'x.y_z-1@m2', `${'a'.repeat(64)}@b`])(
    'accepts plugin id %s',
    id => expect(parsePluginId(id).ok).toBe(true),
  )
  it.each([
    'Turn@m',
    '-a@m',
    'a@-m',
    'a',
    '@m',
    'a@',
    'a@b@c',
    'a b@m',
    'a@m\n',
    `${'a'.repeat(65)}@b`,
    '../x@m',
    42,
    undefined,
  ])('refuses plugin id %j', id => {
    const result = parsePluginId(id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('invalid')
  })

  it('truncates long values in messages', () => {
    const result = parsePluginId('x'.repeat(100))
    expect(!result.ok && result.error.message).toMatch(/…"$/)
  })

  it('validates marketplace names, scopes and shas', () => {
    expect(parseMarketplaceName('claude-plugins-official').ok).toBe(true)
    expect(parseMarketplaceName('Bad Name').ok).toBe(false)
    expect(parseScope('managed').ok).toBe(true)
    expect(parseScope('session').ok).toBe(false)
    expect(parseToggleScope('project').ok).toBe(true)
    expect(parseToggleScope('managed').ok).toBe(false)
    expect(parseToggleScope(1).ok).toBe(false)
    expect(parseSha256('a'.repeat(64)).ok).toBe(true)
    expect(parseSha256('A'.repeat(64)).ok).toBe(false)
  })

  it.each([
    ['/home/u/mods/x', true],
    ['/', true],
    ['relative/x', false],
    ['-rf', false],
    ['/a/../b', false],
    ['/a\nb', false],
    ['/a\0b', false],
    [`/${'a'.repeat(5000)}`, false],
    [null, false],
  ] as const)('path %j → %s', (path, valid) => {
    expect(parseAbsolutePath(path).ok).toBe(valid)
  })

  it('splits ids and spots loader-reserved marketplaces', () => {
    const inline = parsePluginId('probe@inline')
    const real = parsePluginId('probe@mkt')
    if (!inline.ok || !real.ok) throw new Error('fixture ids')
    expect(splitPluginId(inline.value)).toEqual({ name: 'probe', marketplace: 'inline' })
    expect(isPseudoMarketplace(inline.value)).toBe(true)
    expect(isPseudoMarketplace(real.value)).toBe(false)
  })
})

describe('sanitize', () => {
  it('strips ANSI, OSC, controls and bidi overrides', () => {
    expect(sanitize('\u001b[31mred\u001b[0m')).toBe('red')
    expect(sanitize('\u001b]8;;https://evil\u0007link\u001b]8;;\u0007')).toBe('link')
    expect(sanitize('a\u0000b\u0007c\u0085d')).toBe('abcd')
    expect(sanitize('safe\u202egnp.exe')).toBe('safegnp.exe')
    expect(sanitize('zero\u200bwidth\ufeff')).toBe('zerowidth')
    expect(sanitize('\u001bPq')).toBe('q')
    expect(sanitize('\u009d0;title\u009cafter')).toBe('after')
  })

  it('collapses whitespace unless multiline', () => {
    expect(sanitize('a \n\t b')).toBe('a b')
    expect(sanitize('a\t\nb  \n\n\n\nc', { multiline: true, max: 100 })).toBe('a\nb\n\nc')
  })

  it('caps length without splitting surrogate pairs', () => {
    expect(sanitize('abcdef', { max: 4 })).toBe('abc…')
    expect(truncate('😀😀😀', 2)).toBe('😀…')
    expect(truncate('abc', 0)).toBe('')
    expect(truncate('ab ', 2)).toBe('a…')
  })

  it('returns empty for non-strings', () => {
    expect(sanitize(undefined)).toBe('')
    expect(sanitize(5)).toBe('')
  })

  it('keeps the last lines of streamed output', () => {
    expect(tailLines(['one\ntwo', '', 'three\r\nfour'], 2)).toEqual(['three', 'four'])
    expect(tailLines(['x'.repeat(10)], 5, 4)).toEqual(['xxx…'])
  })
})

describe('json readers', () => {
  const record = { s: 'x', n: 1, nan: Number.NaN, b: true, r: { a: 1 }, a: [1, 'two'] }
  it('read typed fields', () => {
    expect(str(record, 's')).toBe('x')
    expect(str(record, 'n')).toBeUndefined()
    expect(num(record, 'n')).toBe(1)
    expect(num(record, 'nan')).toBeUndefined()
    expect(bool(record, 'b')).toBe(true)
    expect(bool(record, 's')).toBeUndefined()
    expect(rec(record, 'r')).toEqual({ a: 1 })
    expect(rec(record, 'a')).toBeUndefined()
    expect(arr(record, 'a')).toEqual([1, 'two'])
    expect(arr(record, 'r')).toBeUndefined()
    expect(strings(arr(record, 'a'))).toEqual(['two'])
    expect(strings(undefined)).toEqual([])
  })
  it('parses JSON safely and compacts', () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 })
    expect(parseJson('{')).toBeUndefined()
    expect(compact({ a: 1, b: undefined })).toEqual({ a: 1 })
  })
})

describe('lru', () => {
  it('moves a set key to the end and evicts the oldest', () => {
    let map = lruSet({}, 'a', 1, 2)
    map = lruSet(map, 'b', 2, 2)
    map = lruSet(map, 'a', 3, 2)
    expect(Object.keys(map)).toEqual(['b', 'a'])
    map = lruSet(map, 'c', 4, 2)
    expect(map).toEqual({ a: 3, c: 4 })
    expect(lruSet(map, 'd', 5, 0)).toEqual({})
  })
  it('sets many with one trim, touches and trims', () => {
    const map = lruSetMany(
      { a: 1 },
      [
        ['b', 2],
        ['c', 3],
        ['a', 4],
      ],
      2,
    )
    expect(map).toEqual({ c: 3, a: 4 })
    expect(Object.keys(lruTouch(map, 'c'))).toEqual(['a', 'c'])
    expect(lruTouch(map, 'missing')).toBe(map)
    expect(lruTrim(map, 5)).toBe(map)
    expect(lruTrim(map, 1)).toEqual({ a: 4 })
  })
})

describe('hasHiddenCharacters', () => {
  it('spots controls, bidi and zero-width characters but not tabs or newlines', () => {
    expect(hasHiddenCharacters('plain\ttext\n')).toBe(false)
    expect(hasHiddenCharacters(`a${String.fromCharCode(0x202e)}b`)).toBe(true)
    expect(hasHiddenCharacters(`x${String.fromCharCode(0x1b)}[0m`)).toBe(true)
    expect(hasHiddenCharacters(`x${String.fromCharCode(0x200b)}`)).toBe(true)
  })
})
