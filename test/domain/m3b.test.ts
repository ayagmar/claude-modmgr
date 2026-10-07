// M3b's pure logic: the capability history and its diff, capsHistory's
// store version, the update / remove / undo reviews and the summary the band,
// the status line and the title share.
import { describe, expect, it } from 'vitest'
import { notableVerb } from '../../plugin/hooks/domain/capabilities.ts'
import {
  acknowledge,
  CAPS_HISTORY_CAP,
  capsLine,
  capsNewOf,
  nextRecord,
  recordCaps,
} from '../../plugin/hooks/domain/caps-history.ts'
import type { Job } from '../../plugin/hooks/domain/jobs.ts'
import {
  type CapsRecord,
  envelope,
  envelopeOf,
  KEY_VERSIONS,
  openKey,
} from '../../plugin/hooks/domain/store-schema.ts'
import {
  bandOf,
  batchLineOf,
  bytesLabel,
  footerRowsFor,
  marketplaceOf,
  removeReview,
  specsOf,
  statusLineOf,
  summaryOf,
  titleOf,
  undoReview,
  updateReview,
  whyNoRemove,
  whyNoUpdate,
} from '../../plugin/hooks/domain/view.ts'
import type { Attention, JobQueue, ModRow } from '../../plugin/types/index.d.ts'

/** Overrides where `undefined` stands for "left out". */
type Loose<T> = { [K in keyof T]?: T[K] | undefined }

const row = (name: string, more: Loose<ModRow> = {}): ModRow =>
  ({
    id: `${name}@m`,
    name,
    version: '1.0.0',
    origin: 'marketplace',
    scope: 'user',
    enabled: true,
    toggleable: true,
    notableCount: 0,
    problems: 0,
    mixed: false,
    ...more,
  }) as ModRow

const ATTENTION: Attention = { updates: 0, problems: 0, reloadPending: false, capsChanged: 0 }
const IDLE: JobQueue = { owner: 'o', jobs: [] }

describe('the capability history', () => {
  it('records a first sight and says nothing new', () => {
    expect(nextRecord(undefined, { id: 'a', version: '1', notable: ['runs-programs'] })).toEqual({
      version: '1',
      notable: ['runs-programs'],
    })
  })

  it('keeps what a version change added, since the version before', () => {
    const before: CapsRecord = { version: '0.3.1', notable: ['changes-model-input'] }
    const after = nextRecord(before, {
      id: 'a',
      version: '0.4.0',
      notable: ['runs-programs', 'changes-model-input'],
    })
    expect(after).toEqual({
      version: '0.4.0',
      notable: ['runs-programs', 'changes-model-input'],
      added: ['runs-programs'],
      since: '0.3.1',
    })
    expect(capsNewOf(after)).toEqual({ since: '0.3.1', added: ['runs-programs'] })
    // The same version again changes nothing.
    expect(nextRecord(after, { id: 'a', version: '0.4.0', notable: after.notable })).toEqual(after)
  })

  it('carries unseen items across a later update, since the first one', () => {
    const seen: CapsRecord = {
      version: '0.4.0',
      notable: ['runs-programs'],
      added: ['runs-programs'],
      since: '0.3.1',
    }
    expect(
      nextRecord(seen, { id: 'a', version: '0.5.0', notable: ['runs-programs', 'secret-env'] }),
    ).toEqual({
      version: '0.5.0',
      notable: ['runs-programs', 'secret-env'],
      added: ['runs-programs', 'secret-env'],
      since: '0.3.1',
    })
    // An item the next version dropped is no longer new.
    expect(nextRecord(seen, { id: 'a', version: '0.5.0', notable: [] })).toEqual({
      version: '0.5.0',
      notable: [],
    })
  })

  it('a version change that adds nothing records quietly', () => {
    expect(
      nextRecord(
        { version: '1', notable: ['runs-programs'] },
        { id: 'a', version: '2', notable: [] },
      ),
    ).toEqual({ version: '2', notable: [] })
  })

  it('writes only when a record changed, and keeps removed mods up to the cap', () => {
    const first = recordCaps({}, [{ id: 'a', version: '1', notable: [] }])
    expect(first.changed).toBe(true)
    const again = recordCaps(first.history, [{ id: 'a', version: '1', notable: [] }])
    expect(again.changed).toBe(false)
    const many = Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [`old${i}`, { version: '1', notable: [] }]),
    )
    const trimmed = recordCaps(many, [{ id: 'a', version: '1', notable: [] }], 3)
    expect(Object.keys(trimmed.history)).toEqual(['old3', 'old4', 'a'])
    expect(trimmed.changed).toBe(true)
    expect(CAPS_HISTORY_CAP).toBeGreaterThan(200)
  })

  it('an acknowledged record keeps its facts and drops what was new', () => {
    const history = {
      a: { version: '2', notable: ['x'], added: ['x'], since: '1' },
      b: { version: '1', notable: [] },
    }
    expect(acknowledge(history, 'a')).toEqual({ ...history, a: { version: '2', notable: ['x'] } })
    expect(acknowledge(history, 'b')).toBe(history)
    expect(acknowledge(history, 'nope')).toBe(history)
    expect(capsNewOf(undefined)).toBeUndefined()
  })

  it('says one line: the mod and the item, or counts', () => {
    expect(capsLine([row('a')])).toBeUndefined()
    const one = row('tb', { capsNew: { since: '1', added: ['runs-programs'] } })
    expect(capsLine([one, row('b')])).toBe('tb can now run programs')
    expect(capsLine([row('tb', { capsNew: { since: '1', added: ['x', 'y'] } })])).toBe(
      'tb can do 2 new things',
    )
    expect(capsLine([one, row('c', { capsNew: { since: '1', added: ['x'] } })])).toBe(
      '2 mods can do more since an update',
    )
    expect(notableVerb('unknown-id')).toBe('do more (unknown-id)')
  })
})

describe('capsHistory in the store', () => {
  it('is written at version 2 and reads version 1 forward', () => {
    expect(KEY_VERSIONS.capsHistory).toBe(2)
    expect(envelopeOf('capsHistory', {})).toEqual({ v: 2, data: {} })
    expect(envelopeOf('prefs', openKey('prefs', undefined).data).v).toBe(1)
    const old = openKey('capsHistory', envelope({ a: { version: '1', notable: ['x'] } }, 1))
    expect(old).toEqual({ data: { a: { version: '1', notable: ['x'] } }, note: 'migrated' })
  })

  it('checks added and since together, and leaves a newer key alone', () => {
    const read = openKey(
      'capsHistory',
      envelope(
        {
          a: { version: '2', notable: ['x'], added: ['x'], since: '1' },
          b: { version: '2', notable: ['x'], added: ['x'] },
          c: { version: '2', notable: [], added: [], since: '1' },
        },
        2,
      ),
    ).data
    expect(read).toEqual({
      a: { version: '2', notable: ['x'], added: ['x'], since: '1' },
      b: { version: '2', notable: ['x'] },
      c: { version: '2', notable: [] },
    })
    expect(openKey('capsHistory', envelope({}, 3)).note).toBe('newer')
  })
})

describe('update and remove', () => {
  it('says why a row has no update or remove', () => {
    expect(whyNoUpdate(row('a'))).toBeUndefined()
    expect(whyNoUpdate(row('a', { scope: 'managed', toggleable: false }))).toMatch(/organisation/)
    expect(whyNoUpdate(row('a', { origin: 'folder-marketplace' }))).toMatch(/folder/)
    expect(whyNoUpdate(row('a', { origin: 'skills-dir' }))).toMatch(/skills folder/)
    expect(
      whyNoUpdate(row('a', { origin: 'env-dir', scope: undefined, toggleable: false })),
    ).toMatch(/CLAUDE_CODE_PLUGIN_DIRS/)
    expect(whyNoRemove(row('a', { origin: 'folder-marketplace' }))).toBeUndefined()
    expect(whyNoRemove(row('a', { scope: 'managed', toggleable: false }))).toMatch(/organisation/)
    expect(whyNoRemove(row('a', { origin: 'skills-dir' }))).toMatch(/delete its folder/)
  })

  it('an update refreshes each marketplace once, then updates each mod', () => {
    const review = updateReview([
      row('a', { id: 'a@two' }),
      row('b', { id: 'b@one', scope: 'project' }),
      row('c', { id: 'c@two' }),
    ])
    expect(review).toMatchObject({
      action: 'update',
      marketplaces: ['one', 'two'],
      changesRepoFile: false,
    })
    expect(specsOf(review)).toEqual([
      { kind: 'marketplace-update', target: 'one' },
      { kind: 'marketplace-update', target: 'two' },
      { kind: 'update', target: 'a@two', args: { scope: 'user' } },
      { kind: 'update', target: 'b@one', args: { scope: 'project' } },
      { kind: 'update', target: 'c@two', args: { scope: 'user' } },
    ])
    expect(marketplaceOf('x@y')).toBe('y')
  })

  it('a remove keeps the data by default and says what goes with it', () => {
    const review = removeReview(row('a', { scope: 'local' }), {
      notable: [],
      parts: { skills: 2, agents: 0, mcp: 0 },
      dataBytes: 2048,
    })
    expect(review).toEqual({
      action: 'remove',
      targets: [{ id: 'a@m', op: 'remove', scope: 'local', version: '1.0.0' }],
      notable: [],
      changesRepoFile: true,
      keepData: true,
      dataBytes: 2048,
      parts: { skills: 2, agents: 0, mcp: 0 },
    })
    expect(specsOf(review)).toEqual([
      { kind: 'remove', target: 'a@m', args: { scope: 'local', keepData: true } },
    ])
    expect(specsOf({ ...review, keepData: false })).toEqual([
      { kind: 'remove', target: 'a@m', args: { scope: 'local', keepData: false } },
    ])
    expect(removeReview(row('b'), undefined)).toEqual({
      action: 'remove',
      targets: [{ id: 'b@m', op: 'remove', scope: 'user', version: '1.0.0' }],
      notable: [],
      changesRepoFile: false,
      keepData: true,
    })
  })

  it('an undo that reinstalls says what comes back and whether its data did', () => {
    const removed: Job = {
      id: 'j',
      kind: 'remove',
      state: 'ok',
      tail: [],
      target: 'gone@m',
      args: { scope: 'user', keepData: true },
    }
    const disabled: Job = { id: 'k', kind: 'disable', state: 'ok', tail: [], target: 'b@m' }
    const review = undoReview(
      [
        { spec: { kind: 'install', target: 'gone@m', args: { scope: 'user' } }, undoes: removed },
        { spec: { kind: 'enable', target: 'b@m' }, undoes: disabled },
        { spec: { kind: 'remove', target: 'c@m' }, undoes: disabled },
        { spec: { kind: 'update', target: 'c@m' }, undoes: disabled },
      ],
      [row('b')],
      id =>
        id === 'gone@m'
          ? { notable: ['runs-programs'] }
          : id === 'c@m'
            ? { notable: [], parts: { skills: 1, agents: 0, mcp: 0 } }
            : undefined,
    )
    expect(review).toEqual({
      action: 'undo',
      targets: [
        { id: 'gone@m', op: 'install', scope: 'user', keptData: true },
        { id: 'b@m', op: 'enable' },
        { id: 'c@m', op: 'remove' },
      ],
      notable: ['gone: Can run programs or change files on your machine'],
      changesRepoFile: false,
      parts: { skills: 1, agents: 0, mcp: 0 },
    })
    expect(specsOf(review)).toEqual([
      { kind: 'install', target: 'gone@m', args: { scope: 'user' } },
      { kind: 'enable', target: 'b@m' },
      { kind: 'remove', target: 'c@m', args: { keepData: true } },
    ])
  })
})

describe('the summary: band, status line and title agree', () => {
  const job = (more: Loose<Job>): Job =>
    ({
      id: 'j',
      kind: 'update',
      state: 'queued',
      tail: [],
      batch: 'b',
      target: 'a@m',
      ...more,
    }) as Job

  it('says nothing when idle', () => {
    const summary = summaryOf({ attention: ATTENTION, queue: IDLE, mods: [] })
    expect(statusLineOf(summary)).toBeUndefined()
    expect(titleOf(summary)).toBe('mods')
    expect(bandOf(summary, { isWorking: false })).toBeUndefined()
  })

  it('applying, then reloading, then a reload owed', () => {
    const queue = {
      owner: 'o',
      jobs: [
        job({ id: '1', state: 'running' }),
        job({ id: '2' }),
        job({ id: 'r', kind: 'reload', target: undefined }),
      ],
    }
    expect(statusLineOf(summaryOf({ attention: ATTENTION, queue, mods: [] }))).toBe('applying 2…')
    const reloading = {
      owner: 'o',
      jobs: [job({ id: 'r', kind: 'reload', state: 'running', target: undefined })],
    }
    expect(statusLineOf(summaryOf({ attention: ATTENTION, queue: reloading, mods: [] }))).toBe(
      'reloading plugins…',
    )
    const owed = summaryOf({
      attention: { ...ATTENTION, reloadPending: true },
      queue: IDLE,
      mods: [],
    })
    expect(statusLineOf(owed)).toBe('reload to apply')
    expect(bandOf(owed, { isWorking: false })?.text).toBe('mods · reload to apply')
  })

  it('what updates added, in all three', () => {
    const mods = [row('turn-band', { capsNew: { since: '0.3.1', added: ['runs-programs'] } })]
    const summary = summaryOf({ attention: { ...ATTENTION, updates: 2 }, queue: IDLE, mods })
    expect(statusLineOf(summary)).toBe('2 updates · turn-band can now run programs')
    expect(bandOf(summary, { isWorking: false })?.text).toBe(
      'mods · 2 updates · turn-band can now run programs',
    )
    expect(titleOf(summary)).toBe('mods · 2 updates · 1 can do more')
  })

  it('the echo of a reload stays in the band', () => {
    const summary = summaryOf({
      attention: { ...ATTENTION, lastReload: 'Reloaded: 2 plugins' },
      queue: IDLE,
      mods: [],
    })
    expect(statusLineOf(summary)).toBeUndefined()
    expect(bandOf(summary, { isWorking: false })?.text).toBe('mods · Reloaded: 2 plugins')
  })
})

describe('the batch line for updates and removes', () => {
  const job = (id: string, more: Loose<Job>): Job =>
    ({
      id,
      kind: 'update',
      state: 'ok',
      tail: [],
      batch: 'b',
      target: 'a@m',
      endedAt: 1,
      ...more,
    }) as Job
  const line = (jobs: Job[]) => batchLineOf({ owner: 'o', jobs }, true)?.text

  it('a marketplace refresh is a step, not a change', () => {
    expect(
      batchLineOf(
        {
          owner: 'o',
          jobs: [
            job('m', { kind: 'marketplace-update', target: 'mkt', state: 'running' }),
            job('1', { state: 'queued' }),
          ],
        },
        false,
      ),
    ).toEqual({ tone: 'busy', text: 'refresh marketplace mkt…' })
    expect(
      batchLineOf(
        {
          owner: 'o',
          jobs: [job('m', { kind: 'marketplace-update' }), job('1', { state: 'running' })],
        },
        false,
      )?.text,
    ).toBe('update a@m (1 of 1)…')
  })

  it('counts what updated and what was already current', () => {
    const reload = job('r', { kind: 'reload', target: undefined })
    expect(line([job('1', {}), reload])).toBe('1 updated, plugins reloaded')
    expect(line([job('1', { unchanged: true })])).toBe('already up to date')
    expect(line([job('1', { unchanged: true }), job('2', { unchanged: true })])).toBe(
      'all already up to date',
    )
    expect(line([job('1', {}), job('2', { unchanged: true })])).toBe(
      '1 updated, 1 already up to date',
    )
    expect(line([job('1', { kind: 'remove' })])).toBe('a removed')
    expect(line([job('1', { kind: 'install' })])).toBe('a installed')
    expect(line([job('1', { kind: 'enable' })])).toBe('1 change applied')
    expect(line([job('1', { kind: 'disable', unchanged: true })])).toBe('nothing needed changing')
    expect(
      line([job('1', { kind: 'disable' }), job('2', { kind: 'enable', unchanged: true })]),
    ).toBe('1 change applied, 1 already so')
  })
})

describe('layout helpers', () => {
  it('wraps the footer by its items', () => {
    expect(footerRowsFor([], 64)).toBe(1)
    expect(footerRowsFor([10, 10, 10], 34)).toBe(1)
    expect(footerRowsFor([10, 10, 10], 33)).toBe(2)
    expect(footerRowsFor([40, 40], 30)).toBe(2)
  })

  it('reads a size', () => {
    expect(bytesLabel(12)).toBe('12 B')
    expect(bytesLabel(12_400)).toBe('12 KB')
    expect(bytesLabel(3_500_000)).toBe('3.3 MB')
  })
})
