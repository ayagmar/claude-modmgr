// Discover's pure logic: matching the catalogue around a selection, where an entry
// comes from, probe keys, the install / declared-command / marketplace reviews
// and what Discover draws.
import { describe, expect, it } from 'vitest'
import { buildIndex, matchAll, sourceLabel, windowOf } from '../../plugin/hooks/domain/catalog.ts'
import { parseAvailable } from '../../plugin/hooks/domain/cli-results.ts'
import { localBase, planProbe, probeKey } from '../../plugin/hooks/domain/detector.ts'
import {
  acceptReview,
  awaitingAcceptance,
  detectLine,
  foundKey,
  foundOfKey,
  foundRow,
  installReview,
  isInstallScope,
  marketplaceReview,
  nextSort,
  withScope,
} from '../../plugin/hooks/domain/discover.ts'
import { INITIAL, INITIAL_VIEW } from '../../plugin/hooks/domain/state.ts'
import { commandLine, escapeStep, specsOf } from '../../plugin/hooks/domain/view.ts'
import type { Job } from '../../plugin/types/index.d.ts'
import { runs } from './fixtures/cli-runs.ts'

const available = (() => {
  const parsed = parseAvailable(runs['list-available'])
  if (!parsed.ok) throw new Error('fixture')
  return parsed.value.available.items
})()
const index = buildIndex(available)
const SHA = '5e549c09f0d775042a59d57dd4fc222b2d9ad6babc928bf603998e1661f65695'

describe('the catalogue around a selection', () => {
  it('matches in sort order and windows around the selected entry', () => {
    const all = matchAll(index, { text: '', sort: 'name' }, () => 'unknown')
    expect(all).toHaveLength(index.size)
    const middle = all[100]?.item.id
    const { rows, offset } = windowOf(all, middle, 50)
    expect(rows).toHaveLength(50)
    expect(offset).toBe(75)
    expect(rows[25]?.id).toBe(middle)
    expect(windowOf(all, 'nope@x', 50).offset).toBe(0)
    expect(windowOf(all, all.at(-1)?.item.id, 50).offset).toBe(all.length - 50)
    expect(windowOf(all.slice(0, 3), undefined, 50).rows).toHaveLength(3)
  })

  it('keeps only the kind asked for, and every search word', () => {
    const kinds = (id: string): 'mod' | 'plain' => (id.startsWith('a') ? 'mod' : 'plain')
    const mods = matchAll(index, { text: '', sort: 'installs', only: 'mod' }, kinds)
    expect(mods.every(match => match.kind === 'mod')).toBe(true)
    const aws = matchAll(index, { text: 'aws serverless', sort: 'name' }, kinds)
    expect(aws.map(match => match.item.id)).toContain('aws-serverless@claude-plugins-official')
  })

  it('says where an entry comes from', () => {
    const named = (id: string) =>
      sourceLabel(index.byId.get(id)?.entry ?? { source: { kind: 'other', type: 'x' } })
    expect(named('aws-serverless@claude-plugins-official')).toBe(
      'github.com/awslabs/agent-plugins plugins/aws-serverless',
    )
    expect(named('cmdmod@cmdmkt')).toBe('a command its marketplace runs')
    expect(named('agent-sdk-dev@claude-plugins-official')).toBe('its marketplace folder')
    expect(sourceLabel({ source: { kind: 'github', repo: 'a/b' } })).toBe('github.com/a/b')
    expect(sourceLabel({ source: { kind: 'url', url: 'https://gitlab.com/a/b.git' } })).toBe(
      'gitlab.com/a/b',
    )
    expect(sourceLabel({ source: { kind: 'other', type: 'npm' } })).toBe('another source')
  })
})

describe('probe keys', () => {
  it('a remote entry by its commit, a local one by its version, the rest none', () => {
    const remote = planProbe({
      source: { kind: 'github', repo: 'a/b', sha: 'a'.repeat(40) },
    })
    expect(probeKey(remote, '1.0.0')).toBe('a'.repeat(40))
    expect(probeKey(planProbe({ source: { kind: 'relative', path: './p' } }), '2')).toBe('local:2')
    expect(probeKey(planProbe({ source: { kind: 'relative', path: './p' } }), undefined)).toBe(
      'local:?',
    )
    expect(probeKey(planProbe({ source: { kind: 'command', command: 'x' } }), '1')).toBeUndefined()
  })

  it('a local folder sits inside its marketplace root', () => {
    expect(localBase('/m/root/', 'plugins/a')).toBe('/m/root/plugins/a/')
    expect(localBase('/m/root', '')).toBe('/m/root/')
    expect(localBase(undefined, 'a')).toBeUndefined()
    expect(localBase('relative', 'a')).toBeUndefined()
  })
})

describe('the install review', () => {
  const entry = { id: 'a@m', name: 'a', version: '1.0.0' }

  it('says what it can do when read, else that it will be read once installed', () => {
    const read = installReview(entry, 'user', { notable: ['runs-programs'], hasModule: true })
    expect(read).toEqual({
      action: 'install',
      targets: [{ id: 'a@m', op: 'install', scope: 'user', version: '1.0.0' }],
      notable: ['a: Can run programs or change files on your machine'],
      changesRepoFile: false,
    })
    expect(installReview({ id: 'a@m', name: 'a' }, 'user', undefined)).toMatchObject({
      uninspected: true,
      targets: [{ id: 'a@m', op: 'install', scope: 'user' }],
    })
    expect(specsOf(read)).toEqual([{ kind: 'install', target: 'a@m', args: { scope: 'user' } }])
  })

  it('takes another scope, which says it changes this repository', () => {
    const review = installReview(entry, 'user', undefined)
    const project = withScope(review, 'project')
    expect(project.targets[0]?.scope).toBe('project')
    expect(project.changesRepoFile).toBe(true)
    expect(withScope(review, 'managed')).toBe(review)
    expect(withScope({ ...review, action: 'remove' }, 'local')).toEqual({
      ...review,
      action: 'remove',
    })
    expect(isInstallScope('local')).toBe(true)
    expect(isInstallScope('managed')).toBe(false)
  })
})

describe('a declared command', () => {
  const stopped: Job = {
    id: 'j',
    kind: 'install',
    state: 'failed',
    tail: [],
    target: 'cmdmod@cmdmkt',
    args: { scope: 'local' },
    shown: { kind: 'command_source', command: '/tmp/emit.sh', sha256: SHA },
  }

  it('is reviewed verbatim and accepted by its sha', () => {
    const review = acceptReview(stopped)
    expect(review).toEqual({
      action: 'install',
      targets: [{ id: 'cmdmod@cmdmkt', op: 'install', scope: 'local' }],
      notable: [],
      changesRepoFile: true,
      declaredCommand: { text: '/tmp/emit.sh', sha256: SHA },
    })
    const specs = review === undefined ? [] : specsOf(review)
    expect(specs).toEqual([
      { kind: 'install', target: 'cmdmod@cmdmkt', args: { scope: 'local', acceptSha: SHA } },
    ])
    expect(specs[0] === undefined ? undefined : commandLine(specs[0])).toBe(
      `claude plugin install cmdmod@cmdmkt --scope local --accept-command ${SHA} --json`,
    )
  })

  it('a headers helper and an update are accepted the same way', () => {
    const helper = acceptReview({
      ...stopped,
      kind: 'update',
      args: {},
      shown: { kind: 'entry_helper', command: 'helper', sha256: SHA },
    })
    expect(helper).toMatchObject({
      action: 'update',
      headersHelper: { text: 'helper', sha256: SHA },
      changesRepoFile: false,
    })
    expect(helper === undefined ? [] : specsOf(helper)).toEqual([
      { kind: 'update', target: 'cmdmod@cmdmkt', args: { acceptSha: SHA } },
    ])
  })

  it('only a stopped install or update waits for one', () => {
    const { shown: _shown, ...plain } = stopped
    expect(acceptReview(plain)).toBeUndefined()
    expect(acceptReview({ ...stopped, kind: 'remove' })).toBeUndefined()
    const { target: _target, ...noTarget } = stopped
    expect(acceptReview(noTarget)).toBeUndefined()
    expect(awaitingAcceptance([plain, stopped])).toBe(stopped)
    // A later install of the same mod (the accepted one, or a retry) settles it.
    expect(awaitingAcceptance([stopped, plain])).toBeUndefined()
    expect(awaitingAcceptance([stopped, { ...plain, target: 'other@m' }])).toBe(stopped)
    expect(awaitingAcceptance([{ ...stopped, state: 'ok' }])).toBeUndefined()
  })
})

describe('adding a marketplace', () => {
  it('reviews a GitHub repo, a URL or an absolute folder, and refuses the rest', () => {
    const asked = marketplaceReview(' anthropics/claude-plugins-official ')
    expect(asked).toEqual({
      review: {
        action: 'marketplace',
        targets: [],
        notable: [],
        changesRepoFile: false,
        source: 'anthropics/claude-plugins-official',
      },
    })
    if ('review' in asked) {
      expect(specsOf(asked.review)).toEqual([
        { kind: 'marketplace-add', args: { source: 'anthropics/claude-plugins-official' } },
      ])
    }
    expect('review' in marketplaceReview('/srv/mkt')).toBe(true)
    expect(marketplaceReview('--evil')).toMatchObject({
      error: expect.stringMatching(/not a marketplace source/),
    })
    expect(
      specsOf({ action: 'marketplace', targets: [], notable: [], changesRepoFile: false }),
    ).toEqual([])
  })
})

describe('what Discover draws', () => {
  it('resolves the selection, cycles the kind and sort, keys its rows', () => {
    const page = { ...INITIAL.catalogPage, rows: [] as never[] }
    expect(foundRow(INITIAL_VIEW, page)).toBeUndefined()
    const rows = windowOf(
      matchAll(index, { text: '', sort: 'name' }, () => 'unknown'),
      undefined,
      3,
    ).rows
    const shown = { ...page, rows }
    expect(foundRow({ ...INITIAL_VIEW, found: rows[1]?.id ?? '' }, shown)).toBe(rows[1])
    expect(foundRow({ ...INITIAL_VIEW, found: 'gone@x' }, shown)).toBe(rows[0])
    expect([
      nextSort('installs'),
      nextSort('stars'),
      nextSort('name'),
      nextSort('marketplace'),
    ]).toEqual(['stars', 'name', 'marketplace', 'installs'])
    expect(foundOfKey(foundKey('a@m'))).toBe('a@m')
    expect(foundOfKey('row:a@m')).toBeUndefined()
    expect(foundOfKey(undefined)).toBeUndefined()
  })

  it('counts what the detector found', () => {
    expect(detectLine({ checked: 0, total: 0, found: 0, running: false })).toBeUndefined()
    expect(detectLine({ checked: 1804, total: 3544, found: 12, running: false })).toBe(
      '12 mods among 1,804 of 3,544 checked',
    )
    expect(detectLine({ checked: 3544, total: 3544, found: 1, running: false })).toBe('1 mod')
    expect(detectLine({ checked: 1, total: 2, found: 0, running: true })).toBe(
      '0 mods so far · checking 1 of 2',
    )
    expect(detectLine({ checked: 0, total: 200, found: 0, running: true })).toBe(
      'checking 200 entries…',
    )
  })

  it('Esc clears the search on Discover, the filter on Installed', () => {
    const discover = { ...INITIAL_VIEW, tab: 'discover' as const, search: 'aws', query: 'x' }
    expect(escapeStep(discover, true)).toEqual({
      kind: 'clear-query',
      view: { ...discover, search: '' },
    })
    expect(escapeStep({ ...discover, search: '' }, true)).toEqual({ kind: 'close' })
    expect(escapeStep({ ...INITIAL_VIEW, query: 'x' }, true)).toMatchObject({ kind: 'clear-query' })
  })
})
