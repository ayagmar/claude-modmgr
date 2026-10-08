// The community index build (scripts/build-mods.ts) with GitHub, git and the
// CLI faked: what it searches, what it counts as a mod, what it publishes and
// what it refuses. The scheduled workflow runs it for real.
import { describe, expect, it } from 'vitest'
import type { CliRun } from '../../plugin/hooks/domain/cli-results.ts'
import {
  COMMUNITY_URL,
  type CommunityMod,
  communityText,
  parseCommunity,
} from '../../plugin/hooks/domain/community.ts'
import {
  buildMods,
  type ModsDeps,
  metadataQuery,
  parseRepoList,
  SEEDS_URL,
  toMeta,
} from '../../scripts/build-mods.ts'
import {
  type Checkout,
  inspectCheckout,
  marketplaceEntries,
  modRoots,
} from '../../scripts/mods/inspect.ts'
import { createSearcher, PAUSE_MS, type SearchAnswer } from '../../scripts/mods/search.ts'

const SHA = 'c'.repeat(40)
const FACTS = { description: 'From GitHub.', stars: 4, pushed: 10 }

const report = (
  notes: string[],
  extra: { success?: boolean; warnings?: unknown[]; type?: string } = {},
): CliRun => ({
  exitCode: extra.success === false ? 1 : 0,
  stderr: '',
  stdout: JSON.stringify({
    success: extra.success ?? true,
    manifest: { type: 'plugin', errors: [], warnings: [], notes: [] },
    contents: [{ type: extra.type ?? 'hooks', errors: [], warnings: extra.warnings ?? [], notes }],
  }),
})

const MOD_REPORT = report([
  './register.tsx hooks: session.start, ui.render{component=Band}',
  './register.tsx calls: $.http.fetch, $.session.messages (via read)',
])

const checkout = (
  files: Record<string, string>,
  validate: (path: string) => CliRun = () => MOD_REPORT,
  repo = 'alice/mods',
): Checkout & { validated: string[] } => {
  const validated: string[] = []
  return {
    repo,
    commit: SHA,
    files: Object.keys(files),
    read: path => files[path],
    validate: async path => {
      validated.push(path)
      return validate(path)
    },
    validated,
  }
}

const HOOKS = JSON.stringify({ modules: ['./register.tsx'] })

describe('modRoots', () => {
  it('finds plugins whose hooks.json lists modules, leaving test material out', () => {
    const roots = modRoots(
      checkout({
        'hooks/hooks.json': HOOKS,
        'plugins/meter/hooks/hooks.json': HOOKS,
        'plugins/shell/hooks/hooks.json': JSON.stringify({ hooks: { Stop: [] } }),
        'plugins/empty/hooks/hooks.json': JSON.stringify({ modules: [] }),
        'plugins/broken/hooks/hooks.json': '{',
        'test/fixtures/x/hooks/hooks.json': HOOKS,
        'examples/demo/hooks/hooks.json': HOOKS,
        'plugins/meter/node_modules/m/hooks/hooks.json': HOOKS,
        'README.md': '',
      }),
    )
    expect(roots).toEqual(['', 'plugins/meter'])
  })
})

describe('marketplaceEntries', () => {
  it('maps the entries read from the checkout to their folders', () => {
    const market = marketplaceEntries('alice/mods', {
      name: 'alice-mods',
      metadata: { pluginRoot: './plugins' },
      plugins: [
        { name: 'meter', source: './plugins/meter/' },
        { name: 'band', source: 'band' },
        { name: 'root', source: { source: 'github', repo: 'Alice/Mods' } },
        { name: 'url', source: { source: 'url', url: 'https://github.com/alice/mods.git' } },
        { name: 'pinned', source: { source: 'github', repo: 'alice/mods', sha: SHA } },
        { name: 'elsewhere', source: { source: 'github', repo: 'bob/other' } },
        { name: 'climbs', source: '../outside' },
        { name: 'Bad Name', source: './x' },
        'not an entry',
      ],
    })
    expect(market?.name).toBe('alice-mods')
    expect([...(market?.folders ?? [])]).toEqual([
      ['plugins/meter', 'meter'],
      ['plugins/band', 'band'],
      ['', 'root'],
    ])
  })

  it('refuses a marketplace whose name no id could carry', () => {
    expect(marketplaceEntries('alice/mods', { name: 'Alice Mods', plugins: [] })).toBeUndefined()
  })
})

describe('inspectCheckout', () => {
  const marketplace = JSON.stringify({
    name: 'alice-mods',
    plugins: [{ name: 'meter', source: './plugins/meter' }],
  })

  it('publishes each mod with its capabilities and the marketplace that installs it', async () => {
    const repo = checkout({
      '.claude-plugin/marketplace.json': marketplace,
      'plugins/meter/hooks/hooks.json': HOOKS,
      'plugins/meter/.claude-plugin/plugin.json': JSON.stringify({
        name: 'meter',
        description: 'A meter\u001b[31m above the prompt.',
      }),
      'plugins/bare/hooks/hooks.json': HOOKS,
    })
    const mods = await inspectCheckout(repo, FACTS)
    expect(mods).toEqual([
      {
        repo: 'alice/mods',
        path: 'plugins/bare',
        commit: SHA,
        name: 'bare',
        description: 'From GitHub.',
        stars: 4,
        pushed: 10,
        check: 'passed',
        events: ['session.start', 'ui.render'],
        calls: ['http.fetch', 'session.messages'],
        envReads: [],
      },
      {
        repo: 'alice/mods',
        path: 'plugins/meter',
        commit: SHA,
        name: 'meter',
        description: 'A meter above the prompt.',
        stars: 4,
        pushed: 10,
        market: { name: 'alice-mods', plugin: 'meter' },
        check: 'passed',
        events: ['session.start', 'ui.render'],
        calls: ['http.fetch', 'session.messages'],
        envReads: [],
      },
    ])
    expect(repo.validated).toEqual([
      '.claude-plugin/marketplace.json',
      'plugins/bare',
      'plugins/meter/.claude-plugin/plugin.json',
    ])
  })

  it('says which mods validate with warnings or fail, and drops a marketplace the CLI refuses', async () => {
    const mods = await inspectCheckout(
      checkout(
        {
          '.claude-plugin/marketplace.json': marketplace,
          'plugins/meter/hooks/hooks.json': HOOKS,
          'plugins/warn/hooks/hooks.json': HOOKS,
          'plugins/fail/hooks/hooks.json': HOOKS,
          'plugins/odd/hooks/hooks.json': HOOKS,
          'plugins/nomod/hooks/hooks.json': HOOKS,
        },
        path => {
          if (path.endsWith('marketplace.json')) return report([], { success: false })
          if (path.endsWith('warn')) return report([], { warnings: [{ message: 'w' }] })
          if (path.endsWith('fail')) return report([], { success: false })
          if (path.endsWith('odd')) return { exitCode: 1, stdout: 'crash', stderr: '' }
          if (path.endsWith('nomod')) return report([], { type: 'skills' })
          return MOD_REPORT
        },
      ),
      FACTS,
    )
    expect(mods.map(mod => [mod.path, mod.check, mod.market])).toEqual([
      ['plugins/odd', 'failed', undefined],
      ['plugins/fail', 'failed', undefined],
      ['plugins/warn', 'warnings', undefined],
      ['plugins/meter', 'passed', undefined],
      ['plugins/nomod', 'failed', undefined],
    ])
  })

  it('leaves out bundled and repackaged mods, test harnesses and copies', async () => {
    const files = { 'hooks/hooks.json': HOOKS }
    expect(
      await inspectCheckout(checkout(files, undefined, 'anthropics/claude-code'), FACTS),
    ).toEqual([])
    expect(
      await inspectCheckout(checkout(files, undefined, 'davila7/claude-code-templates'), FACTS),
    ).toEqual([])
    expect(await inspectCheckout(checkout({ 'README.md': '' }), FACTS)).toEqual([])
    const harness = checkout({
      'hooks/hooks.json': HOOKS,
      '.claude-plugin/plugin.json': JSON.stringify({
        description: 'A test fixture for the engine.',
      }),
    })
    expect(await inspectCheckout(harness, FACTS)).toEqual([])
    const copies = checkout({
      'a/hooks/hooks.json': HOOKS,
      'a/.claude-plugin/plugin.json': JSON.stringify({ name: 'same' }),
      'bb/hooks/hooks.json': HOOKS,
      'bb/.claude-plugin/plugin.json': JSON.stringify({ name: 'same' }),
    })
    expect((await inspectCheckout(copies, FACTS)).map(mod => mod.path)).toEqual(['a'])
    const nameless = checkout({
      'hooks/hooks.json': HOOKS,
      '.claude-plugin/plugin.json': JSON.stringify({ name: '\u0007' }),
    })
    expect(await inspectCheckout(nameless, FACTS)).toEqual([])
  })

  it('names a mod at the repository root after the repository', async () => {
    const [root] = await inspectCheckout(checkout({ 'hooks/hooks.json': HOOKS }), FACTS)
    expect(root?.name).toBe('mods')
  })
})

describe('the searcher', () => {
  const page = (total: number, repos: string[], incomplete = false): SearchAnswer => ({
    page: { total, incomplete, repos },
  })

  const searcher = (answer: (kind: string, query: string, n: number) => SearchAnswer) => {
    const asked: string[] = []
    const sleeps: number[] = []
    const logs: string[] = []
    const search = createSearcher({
      search: async (kind, query, n) => {
        asked.push(`${kind} ${query} #${n}`)
        return answer(kind, query, n)
      },
      sleep: async ms => {
        sleeps.push(ms)
      },
      log: line => logs.push(line),
    })
    return { search, asked, sleeps, logs }
  }

  it('reads every page of a query under the cap, pausing between requests', async () => {
    const { search, asked, sleeps } = searcher((_k, _q, n) =>
      page(150, n === 1 ? ['a/one'] : ['b/two']),
    )
    expect(await search.code('q')).toEqual(['a/one', 'b/two'])
    expect(asked).toEqual(['code q #1', 'code q #2'])
    expect(sleeps).toEqual([PAUSE_MS.code])
  })

  it('splits a code query past the cap by file size', async () => {
    const { search, asked } = searcher((_k, query) => {
      if (!query.includes('size:')) return page(1500, [])
      if (query.endsWith('size:0..393215')) return page(1500, [])
      return page(1, [query.endsWith('size:0..196607') ? 'a/small' : 'b/large'])
    })
    expect(await search.code('q')).toEqual(['a/small', 'b/large'])
    expect(asked.at(-1)).toBe('code q size:196608..393215 #1')
  })

  it('splits a repository query by push date, and refuses an unsplit one past the cap', async () => {
    const { search } = searcher((_k, query) => {
      if (query.startsWith('broad pushed:1970-01-01T00:00:00Z')) {
        return page(query.endsWith('00:20:00Z') ? 1001 : 1, ['a/x'])
      }
      return page(1, ['b/y'])
    })
    expect(await search.repositories('broad', { from: 0, to: 1_200_000 })).toEqual(['a/x', 'b/y'])
    const capped = searcher(() => page(5000, []))
    await expect(capped.search.repositories('topic:x')).rejects.toThrow(/past 1000/)
    const tight = searcher(() => page(5000, []))
    await expect(tight.search.repositories('x', { from: 0, to: 30_000 })).rejects.toThrow(
      /still past/,
    )
    const flat = searcher(() => page(5000, []))
    await expect(flat.search.code('x')).rejects.toThrow(/still past 1000/)
  })

  it('waits out a rate limit, retries an incomplete page, and gives up on other errors', async () => {
    let calls = 0
    const { search, sleeps, logs } = searcher(() => {
      calls += 1
      if (calls === 1) return { status: 403, waitSeconds: 90, message: 'rate limit' }
      if (calls === 2) return page(1, [], true)
      return page(1, ['a/x'])
    })
    expect(await search.repositories('topic:x')).toEqual(['a/x'])
    expect(sleeps).toEqual([90_000, PAUSE_MS.repositories, 120_000, PAUSE_MS.repositories])
    expect(logs).toHaveLength(2)
    const bad = searcher(() => ({ status: 422, message: 'invalid query' }))
    await expect(bad.search.code('x')).rejects.toThrow(/422 invalid query/)
  })

  it('stops after its retries and when the waits pass their budget', async () => {
    const down = searcher(() => ({ status: 502, message: 'bad gateway' }))
    await expect(down.search.code('x')).rejects.toThrow(/502/)
    const slow = searcher(() => ({ status: 429, waitSeconds: 1300, message: 'slow down' }))
    await expect(slow.search.code('x')).rejects.toThrow(/budget/)
  })
})

describe('metadata', () => {
  it('asks GitHub for a batch of repositories by alias', () => {
    expect(metadataQuery(['a/b', 'c/d'])).toMatch(
      /^query \{ r0: repository\(owner: "a", name: "b"\) \{ .* \} r1: repository\(owner: "c", name: "d"\)/,
    )
  })

  it('reads what a repository says, and nothing of a private or missing one', () => {
    expect(
      toMeta({
        nameWithOwner: 'a/b',
        stargazerCount: 3,
        pushedAt: '1970-01-01T00:00:01Z',
        description: 'd',
        isArchived: false,
        parent: { nameWithOwner: 'z/b' },
      }),
    ).toEqual({
      repo: 'a/b',
      stars: 3,
      pushed: 1000,
      description: 'd',
      archived: false,
      parent: 'z/b',
    })
    expect(toMeta({ nameWithOwner: 'a/b', stargazerCount: 0 })).toEqual({
      repo: 'a/b',
      stars: 0,
      pushed: 0,
      description: '',
      archived: false,
    })
    expect(toMeta({ nameWithOwner: 'a/b', stargazerCount: 1, isPrivate: true })).toBeUndefined()
    expect(toMeta(null)).toBeUndefined()
    expect(toMeta({ nameWithOwner: 'bad', stargazerCount: 1 })).toBeUndefined()
  })

  it('reads a repository list, skipping comments and malformed lines', () => {
    expect(parseRepoList('# seeds\na/b\n\n  c/d  \nnot a repo\n')).toEqual(['a/b', 'c/d'])
  })
})

describe('buildMods', () => {
  const found = (repo: string, extra: Partial<CommunityMod> = {}): CommunityMod => ({
    repo,
    path: '',
    commit: SHA,
    name: repo.split('/')[1] ?? repo,
    description: '',
    stars: 0,
    pushed: 0,
    check: 'passed',
    events: [],
    calls: [],
    envReads: [],
    ...extra,
  })

  type World = {
    previous?: string
    seeds?: string
    search?: (kind: string, query: string) => string[]
    meta?: Record<string, Record<string, unknown> | null>
    inspect?: (repo: string) => CommunityMod[] | undefined
  }

  const deps = (world: World) => {
    const logs: string[] = []
    const inspected: string[] = []
    const built: ModsDeps = {
      search: async (kind, query) => {
        const repos = world.search?.(kind, query) ?? []
        return { page: { total: repos.length, incomplete: false, repos } }
      },
      graphql: async query => {
        const data: Record<string, unknown> = {}
        for (const match of query.matchAll(
          /r(\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\)/g,
        )) {
          const repo = `${match[2]}/${match[3]}`
          const meta = world.meta?.[repo]
          data[`r${match[1]}`] =
            meta === null ? null : { nameWithOwner: repo, stargazerCount: 1, ...meta }
        }
        return data
      },
      fetchText: async url =>
        url === COMMUNITY_URL ? world.previous : url === SEEDS_URL ? world.seeds : undefined,
      inspect: async repo => {
        inspected.push(repo)
        return world.inspect === undefined ? [found(repo)] : world.inspect(repo)
      },
      now: () => 20 * 24 * 60 * 60 * 1000,
      sleep: async () => {},
      log: line => logs.push(line),
    }
    return { built, logs, inspected }
  }

  it('publishes the mods of every candidate: searched, seeded and listed last time', async () => {
    const { built, logs, inspected } = deps({
      previous: communityText(1, [found('old/mod')]),
      seeds: 'seed/mod\n',
      search: (kind, query) =>
        kind === 'code' && query.startsWith('CLAUDE') ? ['code/mod', 'Seed/Mod'] : [],
    })
    const result = await buildMods(built)
    expect('text' in result).toBe(true)
    const parsed = 'text' in result ? parseCommunity(result.text) : undefined
    expect(parsed?.ok && parsed.value.mods.map(mod => mod.repo).sort()).toEqual([
      'code/mod',
      'old/mod',
      'seed/mod',
    ])
    expect(inspected.sort()).toEqual(['code/mod', 'old/mod', 'seed/mod'])
    expect(logs.join('\n')).toMatch(/candidates 3 \(seeds 1, last index 1\), public 3/)
  })

  it('drops private, archived, bundled and forked copies, and keeps the word of a repository it could not read', async () => {
    const { built } = deps({
      previous: communityText(1, [found('flaky/mod', { stars: 1, name: 'kept' })]),
      seeds:
        'gone/mod\nold/archive\nanthropics/claude-code\norig/mod\nfork/mod\nflaky/mod\nfork/lone\n',
      meta: {
        'gone/mod': null,
        'old/archive': { isArchived: true },
        'fork/mod': { parent: { nameWithOwner: 'orig/mod' } },
        'fork/lone': { parent: { nameWithOwner: 'elsewhere/x' } },
        'flaky/mod': { stargazerCount: 8 },
      },
      inspect: repo => (repo === 'flaky/mod' ? undefined : [found(repo)]),
    })
    const result = await buildMods(built)
    const parsed = 'text' in result ? parseCommunity(result.text) : undefined
    expect(parsed?.ok && parsed.value.mods.map(mod => [mod.repo, mod.name, mod.stars])).toEqual([
      ['flaky/mod', 'kept', 8],
      ['fork/lone', 'lone', 0],
      ['orig/mod', 'mod', 0],
    ])
  })

  it('goes on when a search fails, and refuses to publish nothing or much less than last time', async () => {
    const previous = communityText(
      1,
      Array.from({ length: 10 }, (_, i) => found(`a/m${i}`)),
    )
    const failing = deps({
      previous,
      inspect: repo => (repo === 'a/m0' || repo === 'a/m1' || repo === 'a/m2' ? [] : [found(repo)]),
    })
    const down: ModsDeps = {
      ...failing.built,
      search: async () => ({ status: 422, message: 'search is down' }),
    }
    expect(await buildMods(down)).toEqual({
      refused: '7 mods against 10 last time: nothing written',
    })
    expect(failing.logs.join('\n')).toMatch(/failed \(code search/)
    const empty = deps({ inspect: () => [] })
    expect(await buildMods(empty.built)).toEqual({ refused: 'no mods found: nothing written' })
  })

  it('refuses an index where most mods fail validate, as when validate itself broke', async () => {
    const { built } = deps({
      seeds: 'a/one\nb/two\nc/three\n',
      inspect: repo => [found(repo, { check: repo === 'c/three' ? 'passed' : 'failed' })],
    })
    expect(await buildMods(built)).toEqual({
      refused: '2 of 3 mods fail validate: nothing written',
    })
  })

  it('starts fresh from an unreadable published index', async () => {
    const { built, logs } = deps({ previous: '{', seeds: 'a/b' })
    expect('text' in (await buildMods(built))).toBe(true)
    expect(logs[0]).toBe('the published index is unreadable')
  })
})
