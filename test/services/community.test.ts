import { describe, expect, it } from 'vitest'
import { communityId } from '../../plugin/hooks/domain/catalog.ts'
import {
  COMMUNITY_MAX_BYTES,
  COMMUNITY_URL,
  type CommunityMod,
  communityText,
} from '../../plugin/hooks/domain/community.ts'
import { INITIAL_VIEW } from '../../plugin/hooks/domain/state.ts'
import { createCatalog } from '../../plugin/hooks/services/catalog.ts'
import {
  COMMUNITY_MAX_AGE_MS,
  COMMUNITY_RETRY_MS,
  createCommunity,
  trialUrl,
} from '../../plugin/hooks/services/community.ts'
import { createStore } from '../../plugin/hooks/services/store.ts'
import { runs } from '../domain/fixtures/cli-runs.ts'
import { fixtureCli } from './cli-world.ts'
import { out, type World, world } from './fakes.ts'

/** The same mod with no marketplace listing it. */
const unlisted = ({ market: _market, ...rest }: CommunityMod): CommunityMod => rest

const SHA = 'd'.repeat(40)

const mod = (repo: string, extra: Partial<CommunityMod> = {}): CommunityMod => ({
  repo,
  path: '',
  commit: SHA,
  name: repo.split('/')[1] ?? repo,
  description: `${repo} draws a band.`,
  stars: 5,
  pushed: 1,
  market: { name: 'band-mods', plugin: repo.split('/')[1] ?? repo },
  check: 'passed',
  events: ['ui.render'],
  calls: ['http.fetch', 'session.messages'],
  envReads: [],
  ...extra,
})

const publish = (w: World, mods: CommunityMod[], url = COMMUNITY_URL) =>
  w.http.answers.set(url, { status: 200, text: communityText(1, mods) })

describe('the community index service', () => {
  it('reads the index once, then again past twelve hours', async () => {
    const w = world()
    publish(w, [mod('alice/band')])
    const community = createCommunity(w.ports, { allowed: async () => true })
    expect((await community.read())?.mods).toHaveLength(1)
    await community.read()
    expect(w.http.gets).toEqual([COMMUNITY_URL])
    expect(w.http.limits).toEqual([COMMUNITY_MAX_BYTES])
    w.clock.time += COMMUNITY_MAX_AGE_MS
    await community.read()
    expect(w.http.gets).toHaveLength(2)
  })

  it('reads nothing with remote reads off', async () => {
    const w = world()
    const community = createCommunity(w.ports, { allowed: async () => false })
    expect(await community.read()).toBeUndefined()
    expect(w.http.gets).toEqual([])
  })

  it('keeps what it held when a read fails, and asks again only after an hour', async () => {
    const w = world()
    const debug: string[] = []
    publish(w, [mod('alice/band')])
    const community = createCommunity(w.ports, {
      allowed: async () => true,
      debug: line => debug.push(line),
    })
    await community.read()
    w.clock.time += COMMUNITY_MAX_AGE_MS
    w.http.answers.set(COMMUNITY_URL, { status: 200, text: '{' })
    expect((await community.read())?.mods).toHaveLength(1)
    await community.read()
    expect(w.http.gets).toHaveLength(2)
    w.clock.time += COMMUNITY_RETRY_MS
    w.http.answers.set(COMMUNITY_URL, { throws: 'offline' })
    expect((await community.read())?.mods).toHaveLength(1)
    w.clock.time += COMMUNITY_RETRY_MS
    w.http.answers.set(COMMUNITY_URL, { status: 500, text: '' })
    await community.read()
    expect(debug).toEqual([
      expect.stringMatching(/unusable/),
      expect.stringMatching(/offline/),
      expect.stringMatching(/answered 500/),
    ])
  })

  it('reads the file beside an index being tried out, every time', async () => {
    expect(trialUrl('http://127.0.0.1:8765/v1.json')).toBe('http://127.0.0.1:8765/mods-v1.json')
    expect(trialUrl('file:///v1.json')).toBeUndefined()
    expect(trialUrl(undefined)).toBeUndefined()
    const w = world({ env: { MODMGR_INDEX_URL: 'http://127.0.0.1:8765/v1.json' } })
    publish(w, [mod('alice/band')], 'http://127.0.0.1:8765/mods-v1.json')
    const community = createCommunity(w.ports, { allowed: async () => true })
    await community.read()
    await community.read()
    expect(w.http.gets).toEqual([
      'http://127.0.0.1:8765/mods-v1.json',
      'http://127.0.0.1:8765/mods-v1.json',
    ])
  })
})

describe('Discover with community mods', () => {
  const setup = async (mods: CommunityMod[]) => {
    const w = world()
    fixtureCli(w.process)
      .when(['list', '--json', '--available'], out(runs['list-available'].stdout))
      .when(['marketplace', 'list'], out(runs['marketplace-list'].stdout))
    publish(w, mods)
    const store = createStore(w.ports)
    await store.load()
    const community = createCommunity(w.ports, { allowed: async () => true })
    const catalog = createCatalog(w.ports, store, undefined, undefined, community)
    await w.state.update('view', () => ({ ...INITIAL_VIEW, tab: 'discover', sort: 'installs' }))
    await catalog.load()
    return { w, catalog }
  }

  it('lists the community mods no marketplace has, with what they can do, after the catalogue', async () => {
    const { w, catalog } = await setup([
      mod('alice/band', { stars: 2 }),
      unlisted(mod('bob/meter', { stars: 9, check: 'warnings' })),
      mod('carol/broken', { check: 'failed' }),
    ])
    const page = await w.state.read('catalogPage')
    const community = page.rows.filter(row => row.community !== undefined)
    expect(community.map(row => [row.id, row.stars])).toEqual([
      ['github.com/bob/meter', 9],
      ['github.com/alice/band', 2],
    ])
    expect(community[1]).toMatchObject({
      name: 'band',
      marketplace: 'alice/band',
      kind: 'mod',
      notable: ['reads-and-sends'],
      community: { repo: 'alice/band', path: '', commit: SHA, installId: 'band@band-mods' },
    })
    expect(community[0]?.community?.installId).toBeUndefined()
    // The catalogue's own mods (here none are known yet) would come first; the rows end with these.
    expect(page.rows.at(-1)?.id).toBe('github.com/alice/band')
    expect(catalog.mod('github.com/alice/band')?.repo).toBe('alice/band')
    expect(catalog.entries().some(entry => entry.id.startsWith('github.com/'))).toBe(false)
    expect(catalog.priority().some(id => id.startsWith('github.com/'))).toBe(false)
  })

  it('leaves out what a marketplace already lists, by its files or its id, and what is installed', async () => {
    const listed = JSON.parse(runs['list-available'].stdout) as { installed: { id: string }[] }
    const [plugin = '', market = ''] = (listed.installed[0]?.id ?? '').split('@')
    const { w } = await setup([
      // The fixture's 42crunch entry comes from this folder (a git-subdir source).
      unlisted(mod('42crunch-ai/Claude-Plugins', { path: 'plugins/api-security-testing' })),
      mod('x/same-id', {
        market: { name: 'claude-plugins-official', plugin: '42crunch-api-security-testing' },
      }),
      mod('y/installed', { market: { name: market, plugin } }),
      mod('z/new'),
    ])
    const ids = (await w.state.read('catalogPage')).rows.map(row => row.id)
    expect(ids.filter(id => id.startsWith('github.com/'))).toEqual(['github.com/z/new'])
    expect(communityId({ repo: 'a/b', path: 'c' })).toBe('github.com/a/b/c')
  })

  it('searches community mods by name, description and repository', async () => {
    const { w, catalog } = await setup([mod('alice/band'), mod('bob/meter')])
    await w.state.update('view', view => ({ ...view, search: 'bob' }))
    await catalog.show()
    expect((await w.state.read('catalogPage')).rows.map(row => row.id)).toEqual([
      'github.com/bob/meter',
    ])
  })
})
