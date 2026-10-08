import { describe, expect, it } from 'vitest'
import { argvOf, commandOfJob } from '../../plugin/hooks/domain/argv.ts'
import {
  buildIndex,
  communityId,
  githubKeyOf,
  installIdOf,
  matchAll,
  windowOf,
} from '../../plugin/hooks/domain/catalog.ts'
import type { CatalogEntry } from '../../plugin/hooks/domain/cli-results.ts'
import type { CommunityMod } from '../../plugin/hooks/domain/community.ts'
import {
  acceptReview,
  communityInstallReview,
  communityLink,
  withScope,
} from '../../plugin/hooks/domain/discover.ts'
import { commandLine, specsOf } from '../../plugin/hooks/domain/view.ts'

/** The same mod with no marketplace listing it. */
const unlisted = ({ market: _market, ...rest }: CommunityMod): CommunityMod => rest

const SHA = 'e'.repeat(40)

const mod = (repo: string, extra: Partial<CommunityMod> = {}): CommunityMod => ({
  repo,
  path: '',
  commit: SHA,
  name: repo.split('/')[1] ?? repo,
  description: '',
  stars: 1,
  pushed: 1,
  market: { name: 'm', plugin: repo.split('/')[1] ?? repo },
  check: 'passed',
  events: ['prompt.submit'],
  calls: ['process.run'],
  envReads: [],
  ...extra,
})

const entry = (id: string, installs?: number): CatalogEntry => ({
  id: id as CatalogEntry['id'],
  name: id.split('@')[0] ?? id,
  description: '',
  marketplace: id.split('@')[1] ?? 'm',
  source: { kind: 'relative', path: './x' },
  ...(installs === undefined ? {} : { installs }),
})

describe('community mods in the catalogue index', () => {
  it('orders the catalogue first by installs, then community mods by stars', () => {
    const index = buildIndex(
      [entry('a@m', 5), entry('b@m')],
      [mod('o/low', { stars: 1 }), mod('o/high', { stars: 9 })],
    )
    expect(index.order.installs.map(item => item.id)).toEqual([
      'a@m',
      'b@m',
      'github.com/o/high',
      'github.com/o/low',
    ])
    expect(index.order.marketplace.map(item => item.id)).toEqual([
      'a@m',
      'b@m',
      'github.com/o/high',
      'github.com/o/low',
    ])
    const matched = matchAll(index, { text: '', sort: 'name', only: 'mod' }, () => 'plain')
    expect(windowOf(matched, 'github.com/o/low').rows.map(row => row.id)).toEqual([
      'github.com/o/high',
      'github.com/o/low',
    ])
  })

  it("takes one mod from each repository before any repository's second", () => {
    const index = buildIndex(
      [],
      [
        mod('big/a', { stars: 90, path: 'a', name: 'a' }),
        mod('big/a', { stars: 90, path: 'b', name: 'b' }),
        mod('big/a', { stars: 90, path: 'c', name: 'c' }),
        mod('small/x', { stars: 5 }),
      ],
    )
    expect(index.order.installs.map(item => item.id)).toEqual([
      'github.com/big/a/a',
      'github.com/small/x',
      'github.com/big/a/b',
      'github.com/big/a/c',
    ])
  })

  it('finds where an entry lives on GitHub', () => {
    expect(githubKeyOf({ kind: 'github', repo: 'A/B' })).toBe('a/b')
    expect(githubKeyOf({ kind: 'url', url: 'https://github.com/A/B.git' })).toBe('a/b')
    expect(
      githubKeyOf({ kind: 'git-subdir', url: 'https://github.com/a/b', path: './plugins/x/' }),
    ).toBe('a/b/plugins/x')
    expect(githubKeyOf({ kind: 'url', url: 'https://gitlab.com/a/b' })).toBeUndefined()
    expect(githubKeyOf({ kind: 'relative', path: './x' })).toBeUndefined()
  })

  it('names a mod by its place on GitHub, and installs it by its marketplace id', () => {
    expect(communityId(mod('o/r', { path: 'p/q' }))).toBe('github.com/o/r/p/q')
    expect(installIdOf(mod('o/r'))).toBe('r@m')
    expect(installIdOf(unlisted(mod('o/r')))).toBeUndefined()
    expect(communityLink({ repo: 'o/r', path: '', commit: SHA })).toBe('https://github.com/o/r')
    expect(communityLink({ repo: 'o/r', path: 'p', commit: SHA })).toBe(
      `https://github.com/o/r/tree/${SHA}/p`,
    )
  })
})

describe('installing a community mod', () => {
  it('reviews what it can do and the marketplace the install adds', () => {
    const review = communityInstallReview(mod('o/guard'), 'user')
    expect(review).toEqual({
      action: 'install',
      targets: [{ id: 'guard@m', op: 'install', scope: 'user' }],
      notable: [
        'guard: Can run programs or change files on your machine',
        'guard: Can change what the model reads',
      ],
      changesRepoFile: false,
      source: 'o/guard',
      indexedAt: SHA,
    })
    expect(communityInstallReview(unlisted(mod('o/r')), 'user')).toBeUndefined()
    expect(review && withScope(review, 'project')).toMatchObject({
      source: 'o/guard',
      changesRepoFile: true,
    })
  })

  it('runs the install from that marketplace, by the bare name', () => {
    const review = communityInstallReview(mod('o/guard'), 'local')
    if (review === undefined) throw new Error('installable')
    const [spec] = specsOf(review)
    expect(spec).toEqual({
      kind: 'install',
      target: 'guard@m',
      args: { scope: 'local', source: 'o/guard' },
    })
    expect(spec && commandLine(spec)).toBe(
      'claude plugin install guard --marketplace o/guard --scope local --json',
    )
  })

  it('keeps the marketplace when a declared command is accepted, and checks it again', () => {
    const job = {
      id: 'j',
      kind: 'install' as const,
      target: 'guard@m',
      args: { scope: 'user' as const, source: 'o/guard' },
      state: 'failed' as const,
      tail: [],
      shown: { kind: 'command_source' as const, command: 'echo hi', sha256: 'f'.repeat(64) },
    }
    const review = acceptReview(job)
    expect(review?.source).toBe('o/guard')
    const [spec] = review === undefined ? [] : specsOf(review)
    expect(spec?.args).toEqual({ scope: 'user', source: 'o/guard', acceptSha: 'f'.repeat(64) })
    const bad = commandOfJob({ ...job, args: { source: '-rf /' } })
    expect(bad.ok).toBe(false)
    const plain = commandOfJob({ ...job, args: {} })
    expect(plain.ok && argvOf(plain.value)).toEqual([
      'claude',
      'plugin',
      'install',
      'guard@m',
      '--scope',
      'user',
      '--json',
    ])
  })
})
