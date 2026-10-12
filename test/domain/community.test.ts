import { describe, expect, it } from 'vitest'
import {
  COMMUNITY_MAX_BYTES,
  type CommunityMod,
  communityKey,
  communityText,
  communityV1Text,
  isProjectMod,
  isRepo,
  isRepoPath,
  parseCommunity,
  V1_MAX_BYTES,
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
  JSON.stringify({ v: 2, at: 5, words: ['ui.render', 'ui.status'], mods, ...more })

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
      value: { v: 2, at: 7, mods: [mods[1], mods[0]] },
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
    ['another version', file([], { v: 3 })],
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

  it('refuses a body past its cap before parsing it', () => {
    expect(parseCommunity(' '.repeat(COMMUNITY_MAX_BYTES + 1))).toMatchObject({
      ok: false,
      error: { message: 'the community index is too large' },
    })
  })

  it('reads every mod of a large index, and the version 1 file an older build left', () => {
    const many = Array.from({ length: 20_001 }, (_, i) => raw({ path: `p${i}` }))
    const parsed = parseCommunity(file(many))
    expect(parsed.ok && parsed.value.mods).toHaveLength(20_001)
    expect(parseCommunity(file([raw()], { v: 1 })).ok).toBe(true)
  })

  it('keeps the most-starred mods that fit what modmgr 0.4.0 reads in the version 1 file', () => {
    // Multi-byte text: counted in UTF-8 bytes, 10,000 of these pass 4 MiB.
    const description = 'é'.repeat(150)
    const mods = Array.from({ length: 10_000 }, (_, i) =>
      mod({ repo: `o/r${i}`, path: '', stars: i, description }),
    )
    const text = communityV1Text(1, mods)
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(V1_MAX_BYTES)
    expect(JSON.parse(text).v).toBe(1)
    const parsed = parseCommunity(text)
    if (!parsed.ok) throw new Error(parsed.error.message)
    const kept = parsed.value.mods
    expect(kept.length).toBeGreaterThan(5_000)
    expect(kept.length).toBeLessThan(10_000)
    // The ones left out are the least starred.
    expect(kept.at(-1)?.stars).toBe(10_000 - kept.length)
    // A small index fits whole.
    expect(parseCommunity(communityV1Text(1, mods.slice(0, 3))).ok && 3).toBe(3)
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
