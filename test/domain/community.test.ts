import { describe, expect, it } from 'vitest'
import {
  COMMUNITY_MAX_BYTES,
  type CommunityMod,
  communityKey,
  communityText,
  isProjectMod,
  isRepo,
  isRepoPath,
  parseCommunity,
} from '../../plugin/hooks/domain/community.ts'

const SHA = 'a'.repeat(40)

const mod = (extra: Partial<CommunityMod> = {}): CommunityMod => ({
  repo: 'alice/mods',
  path: 'plugins/meter',
  commit: SHA,
  name: 'meter',
  description: 'A meter above the prompt.',
  stars: 3,
  pushed: 1_000,
  check: 'passed',
  events: ['ui.render', 'session.start'],
  calls: ['ui.status'],
  envReads: [],
  ...extra,
})

const file = (mods: unknown[], more: Record<string, unknown> = {}): string =>
  JSON.stringify({ v: 1, at: 5, words: ['ui.render', 'ui.status'], mods, ...more })

const raw = (extra: Record<string, unknown> = {}) => ({
  repo: 'alice/mods',
  path: '',
  commit: SHA,
  name: 'meter',
  description: '',
  stars: 0,
  pushed: 0,
  check: 'warnings',
  events: [0],
  calls: [1],
  envReads: [],
  ...extra,
})

describe('the community index', () => {
  it('reads back what CI writes, most starred first, words stored once', () => {
    const mods = [
      mod(),
      mod({
        repo: 'bob/band',
        path: '',
        stars: 9,
        market: { name: 'bob-mods', plugin: 'band' },
        check: 'warnings',
        envReads: ['GITHUB_TOKEN'],
      }),
    ]
    const text = communityText(7, mods)
    expect(text.endsWith('\n')).toBe(true)
    expect(text.match(/"ui\.render"/g)).toHaveLength(1)
    expect(parseCommunity(text)).toEqual({
      ok: true,
      value: { v: 1, at: 7, mods: [mods[1], mods[0]] },
    })
  })

  it('orders mods with as many stars by repository and path', () => {
    const text = communityText(1, [
      mod({ path: 'b' }),
      mod({ path: 'a' }),
      mod({ repo: 'a/z', path: '' }),
    ])
    const parsed = parseCommunity(text)
    expect(parsed.ok && parsed.value.mods.map(communityKey)).toEqual([
      'a/z',
      'alice/mods/a',
      'alice/mods/b',
    ])
  })

  it.each([
    ['not JSON', '{'],
    ['not an object', '[]'],
    ['another version', file([], { v: 2 })],
    ['no build time', file([], { at: -1 })],
    ['no words', file([], { words: 'x' })],
    ['a word too long', file([], { words: ['w'.repeat(101)] })],
    ['no mods', file([], { mods: {} })],
    ['a mod that is not an object', file([1])],
    ['a bad repository', file([raw({ repo: 'no-slash' })])],
    ['a repository that climbs', file([raw({ repo: '../x' })])],
    ['a path that climbs', file([raw({ path: 'a/../b' })])],
    ['an absolute path', file([raw({ path: '/etc' })])],
    ['a short commit', file([raw({ commit: 'abc' })])],
    ['an empty name', file([raw({ name: '' })])],
    ['a long description', file([raw({ description: 'd'.repeat(301) })])],
    ['negative stars', file([raw({ stars: -1 })])],
    ['a fractional push time', file([raw({ pushed: 1.5 })])],
    ['an unknown check', file([raw({ check: 'ok' })])],
    ['a word out of range', file([raw({ events: [7] })])],
    ['words that are not a list', file([raw({ calls: 'ui.status' })])],
    ['a bad marketplace name', file([raw({ market: { name: 'Bad Name', plugin: 'x' } })])],
    ['a marketplace that is not an object', file([raw({ market: 'x' })])],
    ['a mod listed twice', file([raw(), raw()])],
  ])('rejects %s whole', (_what, text) => {
    expect(parseCommunity(text).ok).toBe(false)
  })

  it('refuses a body past its cap before parsing it, and too many mods', () => {
    expect(parseCommunity(' '.repeat(COMMUNITY_MAX_BYTES + 1))).toMatchObject({
      ok: false,
      error: { message: 'the community index is too large' },
    })
    const many = Array.from({ length: 20_001 }, (_, i) => raw({ path: `p${i}` }))
    expect(parseCommunity(file(many)).ok).toBe(false)
  })

  it("tells a project's own mod from a published one by its .claude folder", () => {
    expect(isProjectMod('.claude/mods/firstmate-calm')).toBe(true)
    expect(isProjectMod('.claude')).toBe(true)
    expect(isProjectMod('.claudex/mods/x')).toBe(false)
    expect(isProjectMod('plugins/.claude/x')).toBe(false)
    expect(isProjectMod('')).toBe(false)
  })

  it('checks repositories and paths as GitHub and the CLI spell them', () => {
    expect(isRepo('alice/mods.v2')).toBe(true)
    expect(isRepo('alice/..')).toBe(false)
    expect(isRepo(3)).toBe(false)
    expect(isRepoPath('')).toBe(true)
    expect(isRepoPath('plugins/meter')).toBe(true)
    expect(isRepoPath('plugins//meter')).toBe(false)
    expect(isRepoPath('p'.repeat(201))).toBe(false)
    expect(communityKey({ repo: 'a/b', path: '' })).toBe('a/b')
    expect(communityKey({ repo: 'a/b', path: 'c' })).toBe('a/b/c')
  })
})
