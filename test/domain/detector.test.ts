import { describe, expect, it } from 'vitest'
import { type CatalogEntry, parseAvailable } from '../../plugin/hooks/domain/cli-results.ts'
import {
  afterFollowed,
  afterHooksJson,
  afterManifest,
  backoffMs,
  githubRepo,
  kindOfHooksJson,
  MAX_BODY,
  planProbe,
  safeSegments,
} from '../../plugin/hooks/domain/detector.ts'
import { runs } from './fixtures/cli-runs.ts'

const SHA = '09bf1539d41f9ff355ba3eb5d05d4a75813423bb'
const source = (value: CatalogEntry['source']) => ({ source: value })
const base = { base: 'https://raw.githubusercontent.com/o/r/sha/' }

describe('githubRepo', () => {
  it.each([
    ['https://github.com/o/r.git', ['o', 'r']],
    ['https://github.com/o/r', ['o', 'r']],
    ['https://github.com/o/r/', ['o', 'r']],
    ['https://github.com/o.x/r_y-z.git', ['o.x', 'r_y-z']],
    ['https://gitlab.com/o/r.git', undefined],
    ['https://github.com/o', undefined],
    ['https://github.com/../r', undefined],
    ['https://github.com/o/r%2F..', undefined],
    ['http://github.com/o/r', undefined],
  ] as const)('%s', (url, expected) => expect(githubRepo(url)).toEqual(expected))
})

describe('safeSegments', () => {
  it.each([
    ['plugins/a b', ['plugins', 'a%20b']],
    ['./plugins/x/', ['plugins', 'x']],
    ['', []],
    ['.', []],
    ['../etc', undefined],
    ['a/../b', undefined],
    ['/abs', undefined],
    ['a//b', undefined],
    ['a\\b', undefined],
    ['a/./b', undefined],
  ] as const)('%j', (path, expected) => expect(safeSegments(path)).toEqual(expected))
})

describe('planProbe', () => {
  it('plans a whole-repo url source at its sha', () => {
    expect(planProbe(source({ kind: 'url', url: 'https://github.com/o/r.git', sha: SHA }))).toEqual(
      {
        kind: 'remote',
        sha: SHA,
        base: `https://raw.githubusercontent.com/o/r/${SHA}/`,
      },
    )
  })

  it('plans a git-subdir with encoded segments', () => {
    const plan = planProbe(
      source({
        kind: 'git-subdir',
        url: 'https://github.com/o/r.git',
        path: 'plugins/my mod',
        sha: SHA,
      }),
    )
    expect(plan).toMatchObject({
      base: `https://raw.githubusercontent.com/o/r/${SHA}/plugins/my%20mod/`,
    })
  })

  it('plans github and relative sources', () => {
    expect(planProbe(source({ kind: 'github', repo: 'o/r', sha: SHA }))).toMatchObject({
      kind: 'remote',
    })
    expect(planProbe(source({ kind: 'relative', path: './plugins/x' }))).toEqual({
      kind: 'local',
      path: 'plugins/x',
    })
  })

  it.each([
    [{ kind: 'url', url: 'https://github.com/o/r.git' }, 'no pinned commit'],
    [{ kind: 'url', url: 'https://github.com/o/r.git', sha: 'main' }, 'no pinned commit'],
    [{ kind: 'url', url: 'https://example.com/r.git', sha: SHA }, 'not a GitHub repository'],
    [
      { kind: 'git-subdir', url: 'https://github.com/o/r.git', path: '../x', sha: SHA },
      'unsafe subdirectory',
    ],
    [{ kind: 'github', repo: 'o/r/x', sha: SHA }, 'malformed repo'],
    [{ kind: 'github', repo: 'o', sha: SHA }, 'malformed repo'],
    [{ kind: 'github', repo: '../r', sha: SHA }, 'malformed repo'],
    [{ kind: 'github', repo: 'o/r' }, 'no pinned commit'],
    [{ kind: 'relative', path: '../x' }, 'unsafe relative path'],
    [{ kind: 'command', command: 'x' }, 'source kind command'],
    [{ kind: 'other', type: 'npm' }, 'source kind other'],
  ] as const)('refuses %j', (value, reason) => {
    expect(planProbe(source(value as CatalogEntry['source']))).toEqual({ kind: 'unknown', reason })
  })

  it('plans most of the real catalogue remotely', () => {
    const parsed = parseAvailable(runs['list-available'])
    if (!parsed.ok) throw new Error('fixture')
    const plans = parsed.value.available.items.map(planProbe)
    const remote = plans.filter(plan => plan.kind === 'remote').length
    expect(remote / plans.length).toBeGreaterThan(0.85)
    for (const plan of plans) {
      if (plan.kind === 'remote')
        expect(plan.base).toMatch(/^https:\/\/raw\.githubusercontent\.com\/.+\/$/)
    }
  })
})

describe('probe steps', () => {
  it('classifies hooks.json', () => {
    expect(kindOfHooksJson({ modules: ['./register.ts'] })).toBe('mod')
    expect(kindOfHooksJson({ modules: [] })).toBe('hooks')
    expect(kindOfHooksJson({ hooks: { Stop: [] } })).toBe('hooks')
    expect(kindOfHooksJson({})).toBe('unknown')
    expect(kindOfHooksJson('x')).toBe('unknown')
  })

  it('walks hooks.json → manifest → followed file', () => {
    expect(afterHooksJson({ status: 200, text: '{"modules":["./r.ts"]}' }, base)).toEqual({
      done: 'mod',
    })
    expect(afterHooksJson({ status: 200, text: 'not json' }, base)).toEqual({ done: 'unknown' })
    expect(afterHooksJson({ status: 404 }, base)).toEqual({
      fetch: `${base.base}.claude-plugin/plugin.json`,
      stage: 'manifest',
    })
    expect(afterHooksJson({ status: 301 }, base)).toEqual({ done: 'unknown' })
  })

  it('reads the manifest hooks field', () => {
    const manifest = (value: unknown) => ({ status: 200, text: JSON.stringify(value) })
    expect(afterManifest(manifest({ name: 'x' }), base)).toEqual({ done: 'plain' })
    expect(afterManifest(manifest({ hooks: { modules: ['./m.ts'] } }), base)).toEqual({
      done: 'mod',
    })
    expect(afterManifest(manifest({ hooks: { hooks: {} } }), base)).toEqual({ done: 'hooks' })
    expect(afterManifest(manifest({ hooks: './custom/hooks.json' }), base)).toEqual({
      fetch: `${base.base}custom/hooks.json`,
      stage: 'followed',
    })
    expect(afterManifest(manifest({ hooks: ['./a.json'] }), base)).toMatchObject({
      stage: 'followed',
    })
    expect(afterManifest(manifest({ hooks: './hooks dir/h.json' }), base)).toEqual({
      fetch: `${base.base}hooks%20dir/h.json`,
      stage: 'followed',
    })
    // A local plugin's folder is read as written, not URL-encoded.
    expect(afterManifest(manifest({ hooks: './hooks dir/h.json' }), { base: '/mkt/p/' })).toEqual({
      fetch: '/mkt/p/hooks dir/h.json',
      stage: 'followed',
    })
    expect(afterManifest(manifest({ hooks: '../escape.json' }), base)).toEqual({ done: 'hooks' })
    expect(afterManifest(manifest({ hooks: 7 }), base)).toEqual({ done: 'hooks' })
    expect(afterManifest(manifest('str'), base)).toEqual({ done: 'unknown' })
    expect(afterManifest({ status: 404 }, base)).toEqual({ done: 'unknown' })
  })

  it('reads a followed hooks file', () => {
    expect(afterFollowed({ status: 200, text: '{"modules":["./m.ts"]}' })).toEqual({ done: 'mod' })
    expect(afterFollowed({ status: 200, text: '{}' })).toEqual({ done: 'hooks' })
    expect(afterFollowed({ status: 404 })).toEqual({ done: 'hooks' })
  })

  it('retries on rate limits and server errors at every stage', () => {
    for (const step of [
      (f: { status: number }) => afterHooksJson(f, base),
      (f: { status: number }) => afterManifest(f, base),
      afterFollowed,
    ]) {
      expect(step({ status: 429 })).toEqual({ retry: 'rate-limited' })
      expect(step({ status: 403 })).toEqual({ retry: 'rate-limited' })
      expect(step({ status: 503 })).toEqual({ retry: 'server' })
    }
  })

  it('refuses bodies over the cap', () => {
    const big = `{"modules":["./m.ts"],"pad":"${'x'.repeat(MAX_BODY)}"}`
    expect(afterHooksJson({ status: 200, text: big }, base)).toEqual({ done: 'unknown' })
  })

  it('backs off exponentially with a cap', () => {
    expect(backoffMs(0)).toBe(2000)
    expect(backoffMs(3)).toBe(16_000)
    expect(backoffMs(50)).toBe(300_000)
    expect(backoffMs(-1)).toBe(2000)
  })
})
