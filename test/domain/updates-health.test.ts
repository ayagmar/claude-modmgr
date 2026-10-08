// What can update, when the next check is due, the
// store key that keeps it, Health's items and their fixes, the debug log's
// lines, and the status line's one clause.
import { describe, expect, it } from 'vitest'
import type { InstalledEntry } from '../../plugin/hooks/domain/cli-results.ts'
import {
  agoLabel,
  type HealthInput,
  healthItemsOf,
  healthKey,
  healthOfKey,
  loadStates,
  loggedFailures,
  problemCount,
} from '../../plugin/hooks/domain/health.ts'
import type { AbsolutePath, PluginId } from '../../plugin/hooks/domain/ids.ts'
import { INITIAL } from '../../plugin/hooks/domain/state.ts'
import { envelope, openKey, readUpdates } from '../../plugin/hooks/domain/store-schema.ts'
import {
  foundUpdates,
  marketplaceEntriesOf,
  nextCheckIn,
  updateOf,
  updateTo,
} from '../../plugin/hooks/domain/updates.ts'
import { statusLineOf, summaryOf } from '../../plugin/hooks/domain/view.ts'
import type { DevState, HealthFacts, JobQueue, ModRow } from '../../plugin/types/index.d.ts'

const SHA = 'a'.repeat(40)
const OTHER = `${'b'.repeat(12)}${'c'.repeat(28)}`

const installed = (id: string, more: Partial<InstalledEntry> = {}): InstalledEntry => ({
  id: id as PluginId,
  scope: 'user',
  enabled: true,
  version: '1.0.0',
  installPath: `/cache/${id}` as AbsolutePath,
  ...more,
})

describe('what can update', () => {
  const file = JSON.stringify({
    plugins: [
      { name: 'declared', version: '1.2.0', source: './declared' },
      {
        name: 'pinned',
        source: { source: 'git-subdir', url: 'https://github.com/o/r.git', path: 'p', sha: SHA },
      },
      { name: 'local', source: './local' },
      { name: 7 },
      'junk',
    ],
  })

  it('reads a marketplace file’s entries', () => {
    const entries = marketplaceEntriesOf(file)
    expect([...entries.keys()]).toEqual(['declared', 'pinned', 'local'])
    expect(entries.get('declared')).toEqual({
      version: '1.2.0',
      source: { kind: 'relative', path: './declared' },
    })
    expect(marketplaceEntriesOf('{}').size).toBe(0)
    expect(marketplaceEntriesOf('nope').size).toBe(0)
  })

  it('says an update only when it is sure', () => {
    const entries = marketplaceEntriesOf(file)
    const declared = entries.get('declared')
    const pinned = entries.get('pinned')
    expect(updateOf(installed('declared@m'), declared)).toBe('1.2.0')
    expect(updateOf(installed('declared@m', { version: '1.2.0' }), declared)).toBeUndefined()
    expect(updateOf(installed('declared@m', { version: '2.0.0' }), declared)).toBeUndefined()
    expect(updateOf(installed('declared@m', { version: 'weird' }), declared)).toBeUndefined()
    // A commit-named version against the pinned commit.
    expect(updateOf(installed('pinned@m', { version: 'bbbbbbbbbbbb' }), pinned)).toBe(
      'aaaaaaaaaaaa',
    )
    expect(updateOf(installed('pinned@m', { version: 'aaaaaaaaaaaa' }), pinned)).toBeUndefined()
    // A plugin version against a pinned commit: the CLI decides by version, so unknown.
    expect(updateOf(installed('pinned@m'), pinned)).toBeUndefined()
    // A relative source names no commit: unknown.
    expect(
      updateOf(installed('local@m', { version: 'bbbbbbbbbbbb' }), entries.get('local')),
    ).toBeUndefined()
    // Not the CLI's to update: a folder marketplace, managed, launch-command, no version.
    const folder = installed('declared@m', { readFromFolder: '/mkt/declared' as AbsolutePath })
    expect(updateOf(folder, declared)).toBeUndefined()
    expect(updateOf(installed('declared@m', { scope: 'managed' }), declared)).toBeUndefined()
    expect(updateOf(installed('declared@inline', { scope: 'session' }), declared)).toBeUndefined()
    const { version: _v, ...noVersion } = installed('declared@m')
    expect(updateOf(noVersion, declared)).toBeUndefined()
    expect(updateOf(installed('declared@m'), undefined)).toBeUndefined()
    const badSha = { source: { kind: 'url' as const, url: 'u', sha: 'xyz' } }
    expect(updateOf(installed('p@m', { version: 'bbbbbbbbbbbb' }), badSha)).toBeUndefined()
  })

  it('finds them across marketplaces and shows one while it still applies', () => {
    const marketplaces = new Map([['m', marketplaceEntriesOf(file)]])
    const found = foundUpdates(
      [
        installed('declared@m'),
        installed('pinned@m', { version: OTHER.slice(0, 12) }),
        installed('x@gone'),
      ],
      marketplaces,
    )
    expect(found).toEqual({
      'declared@m': { from: '1.0.0', to: '1.2.0' },
      'pinned@m': { from: 'bbbbbbbbbbbb', to: 'aaaaaaaaaaaa' },
    })
    const updates = { at: 1, found }
    expect(updateTo(updates, installed('declared@m'))).toBe('1.2.0')
    // Updated since (here or elsewhere): no longer shown.
    expect(updateTo(updates, installed('declared@m', { version: '1.2.0' }))).toBeUndefined()
    expect(updateTo(updates, installed('other@m'))).toBeUndefined()
  })

  it('knows when the next check is due', () => {
    const hour = 3_600_000
    expect(nextCheckIn(undefined, 6, 0)).toBe(0)
    expect(nextCheckIn(1000, 6, 1000 + hour)).toBe(5 * hour)
    expect(nextCheckIn(0, 6, 10 * hour)).toBe(0)
    expect(nextCheckIn(0, 0, 0)).toBeUndefined()
  })

  it('keeps the last check in the store, shape-checked', () => {
    expect(
      readUpdates({ at: 5, found: { 'a@m': { from: '1', to: '2' }, 'b@m': { from: 1 } } }),
    ).toEqual({
      at: 5,
      found: { 'a@m': { from: '1', to: '2' } },
    })
    expect(readUpdates({ at: -1, found: 'x' })).toEqual({ found: {} })
    expect(readUpdates(null)).toEqual({ found: {} })
    expect(openKey('updates', envelope({ at: 1, found: {} }))).toEqual({
      data: { at: 1, found: {} },
    })
    expect(openKey('updates', envelope({}, 2)).note).toBe('newer')
  })
})

const row = (name: string, more: Partial<ModRow> = {}): ModRow => ({
  id: `${name}@m`,
  name,
  origin: 'marketplace',
  scope: 'user',
  enabled: true,
  toggleable: true,
  notableCount: 0,
  problems: 0,
  mixed: false,
  ...more,
})

const facts = (more: Partial<HealthFacts> = {}): HealthFacts => ({
  ...INITIAL.health,
  at: 10 * 3_600_000,
  debugLog: { state: 'read', path: '/cfg/debug/s.txt' },
  detector: { spent: 40, budget: 600, remote: true },
  cache: { bytes: 2048, full: false },
  updates: { every: 6, at: 7 * 3_600_000 },
  ...more,
})

const input = (more: Partial<HealthInput> = {}): HealthInput => ({
  mods: [],
  dev: INITIAL.dev,
  attention: INITIAL.attention,
  degraded: INITIAL.degraded,
  sync: INITIAL.sync,
  detect: { checked: 120, total: 3545, found: 3, running: false },
  queue: INITIAL.queue,
  facts: facts(),
  ...more,
})

describe('Health’s items', () => {
  it('shows seeded problems, worst first, each with its fix', () => {
    const dev: DevState = {
      rows: [{ key: '/dev/tb', name: 'tb', how: 'plugin-dir', path: '/dev/tb' }],
      failures: { tb: { count: 2, lastReason: 'reload failed', lastAt: 1 } },
      loading: false,
    }
    const items = healthItemsOf(
      input({
        mods: [
          row('fresh', { updateTo: '1.2.0' }),
          row('grown', { capsNew: { since: '0.3.1', added: ['runs-programs'] } }),
          row('hurt', { problems: 2 }),
        ],
        dev,
        facts: facts({ logged: { quiet: 'tool.call (Error)' } }),
      }),
    )
    const mine = items.filter(item => item.group !== 'modmgr')
    expect(mine.map(item => [item.group, item.tone, item.text, item.fixLabel])).toEqual([
      ['hurt', 'bad', 'validate finds 2 errors in it', 'see it'],
      ['quiet', 'bad', 'a hook failed: tool.call (Error) (debug log)', undefined],
      ['tb', 'bad', '2 failures while it reloaded; last: reload failed', 'validate'],
      ['grown', 'warn', 'since 0.3.1 it can run programs', 'review it'],
      ['fresh', 'info', '1.2.0 is available', 'update'],
    ])
    expect(mine.find(item => item.group === 'tb')?.fix).toEqual({
      kind: 'validate',
      key: '/dev/tb',
    })
    expect(mine.find(item => item.group === 'fresh')?.fix).toEqual({
      kind: 'update',
      id: 'fresh@m',
    })
    expect(problemCount(items)).toBe(3)
  })

  it('says modmgr’s own state', () => {
    const queue: JobQueue = { owner: 'o', jobs: [] }
    const items = healthItemsOf(
      input({
        mods: [
          row('a'),
          row('b', { enabled: false }),
          row('c', { scope: 'managed', toggleable: false }),
        ],
        attention: { ...INITIAL.attention, reloadPending: true },
        degraded: { process: true, network: false, acceptCommand: true, reason: 'no claude CLI' },
        sync: {
          refreshing: false,
          skipped: 0,
          error: { kind: 'timeout', message: 'list ran past 30 s' },
        },
        queue,
        facts: facts({
          chain: [{ event: 'session.append', text: 'a then b rewrite each row (session.append).' }],
          cache: { bytes: 0, full: true },
          debugLog: { state: 'none' },
          detector: {
            spent: 0,
            budget: 600,
            remote: false,
            why: 'detectRemote is off in its options',
          },
        }),
      }),
    )
    const texts = items.map(
      item => `${item.group}: ${item.text}${item.fixLabel ? ` → ${item.fixLabel}` : ''}`,
    )
    expect(texts).toEqual([
      'Hook order: a then b rewrite each row (session.append).',
      'modmgr: no claude CLI',
      "modmgr: couldn't read the installed list: list ran past 30 s → try again",
      'modmgr: changes wait for a plugin reload → reload',
      "modmgr: modmgr's cache is full; what it knows is not saved → clear cache",
      'modmgr: Claude Code refuses declared-command acceptances from this session; accept them in a terminal',
      'modmgr: 1 enabled · 1 disabled · 1 managed',
      'modmgr: updates checked 3 h ago, every 6 hours → check now',
      'modmgr: detector: local catalogues only (detectRemote is off in its options); 3 mods found',
      'modmgr: A hook that fails is logged only in a session started with --debug → copy command',
    ])
  })

  it('says when updates were never checked, or are off; the detector’s budget; the cache', () => {
    const texts = (more: Partial<HealthFacts>) =>
      healthItemsOf(input({ facts: facts(more) })).map(item => item.text)
    expect(texts({ updates: { every: 6 } })).toContain('updates checked never, every 6 hours')
    expect(texts({ updates: { every: 0, off: 'updateCheckHours is 0' } })).toContain(
      'update checks are off: updateCheckHours is 0',
    )
    expect(texts({})).toContain(
      'detector: 120 of 3,545 checked, 3 mods found, 560 requests left this session',
    )
    expect(texts({})).toContain('cache: 2 KB')
    const fresh = healthItemsOf(
      input({ detect: { checked: 0, total: 0, found: 0, running: false } }),
    )
    expect(fresh.map(item => item.text)).toContain(
      'detector: not run yet; it starts when Discover opens',
    )
    // A reload already queued is not owed.
    const queued = healthItemsOf(
      input({
        attention: { ...INITIAL.attention, reloadPending: true },
        queue: { owner: 'o', jobs: [{ id: 'r', kind: 'reload', state: 'queued', tail: [] }] },
      }),
    )
    expect(queued.some(item => item.key === 'own:reload')).toBe(false)
  })

  it('counts load states, and keys its rows', () => {
    expect(loadStates([])).toBeUndefined()
    expect(
      loadStates([row('a'), row('b', { origin: 'env-dir', toggleable: false, scope: 'user' })]),
    ).toBe('1 enabled · 1 from the launch command')
    expect(healthOfKey(healthKey('a@m:update'))).toBe('a@m:update')
    expect(healthOfKey('row:x')).toBeUndefined()
    expect(healthOfKey(undefined)).toBeUndefined()
    expect(agoLabel(10)).toBe('just now')
    expect(agoLabel(5 * 60_000)).toBe('5 min ago')
    expect(agoLabel(3 * 3_600_000)).toBe('3 h ago')
    expect(agoLabel(3 * 86_400_000)).toBe('3 days ago')
  })

  it('reads the last hook failure per plugin from a debug log', () => {
    const log = [
      '2026-10-08T01:00:00.000Z [WARN] hook failed closed: quiet-bash: errorKind=Error errorChars=24 (tool.call; its .catch answered)',
      '2026-10-08T01:00:01.000Z [DEBUG] something else',
      '2026-10-08T01:00:02.000Z [WARN] hook failed closed: quiet-bash@fixtures: errorKind=TypeError errorChars=3 (prompt.submit; no .catch)',
      '2026-10-08T01:00:03.000Z [WARN] hook failed closed: redactor: errorKind=Error errorChars=9 (session.append; skipped)',
    ].join('\n')
    expect(loggedFailures(log)).toEqual({
      'quiet-bash': 'prompt.submit (TypeError)',
      redactor: 'session.append (Error)',
    })
    expect(loggedFailures('')).toEqual({})
  })
})

describe('the status line: one clause', () => {
  const idle = { owner: 'o', jobs: [] }
  it('says the most important thing only', () => {
    const news = summaryOf({
      attention: { ...INITIAL.attention, updates: 2, reloadPending: true },
      queue: idle,
      mods: [],
    })
    expect(statusLineOf(news)).toBe('reload to apply')
    expect(statusLineOf({ ...news, reloadOwed: false })).toBe('2 updates')
    expect(statusLineOf({ ...news, reloadOwed: false, newsDismissed: true })).toBeUndefined()
    expect(statusLineOf({ ...news, reloading: true })).toBe('reloading plugins…')
    expect(statusLineOf({ ...news, pending: 3 })).toBe('applying 3…')
  })
})
