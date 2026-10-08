// Domain modules added in M2: argv, mods, store schema, config, version,
// queue ownership, marketplace sources and the state defaults.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { argvOf, commandOfJob, TIMEOUTS } from '../../plugin/hooks/domain/argv.ts'
import { parseInstalledList } from '../../plugin/hooks/domain/cli-results.ts'
import { DEFAULT_CONFIG, parseConfig, trafficOff } from '../../plugin/hooks/domain/config.ts'
import {
  type AbsolutePath,
  type MarketplaceName,
  type PluginId,
  parseMarketplaceSource,
  type Sha256,
} from '../../plugin/hooks/domain/ids.ts'
import type { Job } from '../../plugin/hooks/domain/jobs.ts'
import {
  claim,
  isClaimedBy,
  lastWriteAt,
  RELOAD_SETTLE_MS,
  reloadReadyAt,
  takeOver,
} from '../../plugin/hooks/domain/jobs.ts'
import {
  type Analysis,
  analysisKey,
  analysisOf,
  isToggleable,
  modDetail,
  modRow,
  originOf,
  sortRows,
} from '../../plugin/hooks/domain/mods.ts'
import { INITIAL, SHAPES } from '../../plugin/hooks/domain/state.ts'
import {
  bytesOf,
  capped,
  emptyStore,
  envelope,
  fitBudget,
  openKey,
  readAnalysis,
  readPrefs,
  STORE_KEYS,
} from '../../plugin/hooks/domain/store-schema.ts'
import { parseValidateReport } from '../../plugin/hooks/domain/validate-report.ts'
import { compareVersions } from '../../plugin/hooks/domain/version.ts'
import { runs } from './fixtures/cli-runs.ts'

const id = (value: string) => value as PluginId
const job = (fields: Partial<Job> & Pick<Job, 'kind'>): Job => ({
  id: 'j',
  state: 'queued',
  tail: [],
  ...fields,
})

describe('argv', () => {
  it('builds every command as an argv array without -y', () => {
    const sha = 'a'.repeat(64) as Sha256
    const cases: Array<[Parameters<typeof argvOf>[0], string]> = [
      [{ op: 'version' }, 'claude --version'],
      [{ op: 'list' }, 'claude plugin list --json'],
      [{ op: 'list', dataSize: true }, 'claude plugin list --json --data-size'],
      [{ op: 'available' }, 'claude plugin list --json --available'],
      [{ op: 'marketplaces' }, 'claude plugin marketplace list --json'],
      [{ op: 'details', id: id('a@m') }, 'claude plugin details a@m'],
      [{ op: 'validate', path: '/p' as AbsolutePath }, 'claude plugin validate --json /p'],
      [
        { op: 'validate', path: '/p' as AbsolutePath, strict: true },
        'claude plugin validate --json --strict /p',
      ],
      [{ op: 'test', path: '/p' as AbsolutePath }, 'claude plugin test /p'],
      [{ op: 'enable', id: id('a@m') }, 'claude plugin enable a@m --json'],
      [
        { op: 'disable', id: id('a@m'), scope: 'local' },
        'claude plugin disable a@m --scope local --json',
      ],
      [
        { op: 'install', id: id('a@m'), scope: 'project', acceptSha: sha },
        `claude plugin install a@m --scope project --accept-command ${sha} --json`,
      ],
      [{ op: 'update', id: id('a@m') }, 'claude plugin update a@m --json'],
      [
        { op: 'update', id: id('a@m'), scope: 'managed', acceptSha: sha },
        `claude plugin update a@m --scope managed --accept-command ${sha} --json`,
      ],
      [{ op: 'uninstall', id: id('a@m') }, 'claude plugin uninstall a@m --json'],
      [
        { op: 'marketplace-add', source: 'o/r' as never },
        'claude plugin marketplace add o/r --json',
      ],
      [{ op: 'marketplace-update' }, 'claude plugin marketplace update'],
      [
        { op: 'marketplace-update', name: 'm' as MarketplaceName },
        'claude plugin marketplace update m --json',
      ],
    ]
    for (const [command, line] of cases) {
      expect(argvOf(command).join(' ')).toBe(line)
      expect(argvOf(command)).not.toContain('-y')
      expect(TIMEOUTS[command.op]).toBeLessThanOrEqual(600_000)
    }
  })

  it('checks a queued job again before it becomes a command', () => {
    expect(commandOfJob(job({ kind: 'enable', target: 'a@m', args: { scope: 'user' } }))).toEqual({
      ok: true,
      value: { op: 'enable', id: 'a@m', scope: 'user' },
    })
    expect(commandOfJob(job({ kind: 'remove', target: 'a@m' }))).toEqual({
      ok: true,
      value: { op: 'uninstall', id: 'a@m' },
    })
    expect(commandOfJob(job({ kind: 'install', target: 'a@m' }))).toMatchObject({
      ok: true,
      value: { op: 'install', scope: 'user' },
    })
    expect(
      commandOfJob(job({ kind: 'update', target: 'a@m', args: { scope: 'user' } })),
    ).toMatchObject({
      ok: true,
      value: { op: 'update', scope: 'user' },
    })
    expect(commandOfJob(job({ kind: 'validate', args: { path: '/x' } }))).toMatchObject({
      ok: true,
      value: { op: 'validate', strict: true },
    })
    expect(commandOfJob(job({ kind: 'marketplace-update' }))).toEqual({
      ok: true,
      value: { op: 'marketplace-update' },
    })
  })

  it('refuses unsafe or impossible jobs', () => {
    const refused = [
      job({ kind: 'enable', target: '-x@m' }),
      job({ kind: 'enable', target: 'a@inline' }),
      job({ kind: 'disable', target: 'a@m', args: { scope: 'managed' } }),
      job({ kind: 'remove', target: 'a@m', args: { scope: 'x' as never } }),
      job({ kind: 'install', target: 'a@builtin' }),
      job({ kind: 'install', target: 'a@m', args: { scope: 'managed' } }),
      job({ kind: 'install', target: 'a@m', args: { acceptSha: 'nope' } }),
      job({ kind: 'update', target: 'A@m' }),
      job({ kind: 'update', target: 'a@m', args: { scope: 'all' as never } }),
      job({ kind: 'update', target: 'a@m', args: { acceptSha: 'z' } }),
      job({ kind: 'test', args: { path: 'relative' } }),
      job({ kind: 'validate', args: { path: '/a/../b' } }),
      job({ kind: 'marketplace-add', args: { source: '--evil' } }),
      job({ kind: 'marketplace-update', target: 'Bad Name' }),
      job({ kind: 'reload' }),
    ]
    for (const item of refused) {
      const result = commandOfJob(item)
      expect(result.ok, JSON.stringify(item)).toBe(false)
      if (!result.ok) expect(result.error.kind).toBe('invalid')
    }
  })
})

describe('marketplace sources', () => {
  it('accepts owner/repo, https URLs and absolute paths', () => {
    for (const value of [
      'ayagmar/modmgr',
      'https://example.com/m.git',
      'https://h:8443',
      '/srv/mkt',
    ]) {
      expect(parseMarketplaceSource(value).ok, value).toBe(true)
    }
  })

  it('refuses flags, other schemes, climbs and hidden characters', () => {
    for (const value of [
      '-rf',
      'http://example.com/x',
      'git@github.com:o/r.git',
      'o/..',
      'relative/path/x',
      `https://example.com/${String.fromCharCode(0x202e)}`,
      `https://example.com/${'a'.repeat(2050)}`,
      3,
    ]) {
      expect(parseMarketplaceSource(value).ok, String(value)).toBe(false)
    }
  })
})

describe('config', () => {
  it('reads userConfig with defaults and bounds', () => {
    expect(parseConfig({})).toEqual(DEFAULT_CONFIG)
    expect(parseConfig({ updateCheckHours: 500, detectRemote: false, debugTimings: true })).toEqual(
      {
        updateCheckHours: 168,
        detectRemote: false,
        debugTimings: true,
      },
    )
    expect(parseConfig({ updateCheckHours: -1 }).updateCheckHours).toBe(0)
    expect(parseConfig({ updateCheckHours: Number.NaN, detectRemote: 'yes' })).toEqual(
      DEFAULT_CONFIG,
    )
  })

  it('reads the traffic switch conservatively', () => {
    expect(trafficOff(undefined)).toBe(false)
    expect(trafficOff(' ')).toBe(false)
    expect(trafficOff('0')).toBe(false)
    expect(trafficOff('FALSE')).toBe(false)
    expect(trafficOff('1')).toBe(true)
    expect(trafficOff('yes')).toBe(true)
  })
})

describe('versions', () => {
  it('compares x.y.z', () => {
    expect(compareVersions('2.1.292', '2.1.292')).toBe(0)
    expect(compareVersions('2.1.300', '2.1.292')).toBeGreaterThan(0)
    expect(compareVersions('2.0.999', '2.1.0')).toBeLessThan(0)
    expect(compareVersions('2.1.292-dev', '2.1.292')).toBe(0)
    expect(compareVersions('dev', '2.1.292')).toBeUndefined()
  })
})

describe('queue ownership', () => {
  const running = job({ id: 'a', kind: 'disable', state: 'running' })
  const queued = job({ id: 'b', kind: 'enable' })

  it("takes over: interrupts another owner's running job, not its own", () => {
    const queue = { owner: 'old', jobs: [running, queued] }
    expect(takeOver(queue, 'new', 9).jobs.map(j => j.state)).toEqual(['interrupted', 'queued'])
    expect(takeOver(queue, 'old', 9)).toBe(queue)
  })

  it('claims only for the owner and only the next runnable job', () => {
    const queue = { owner: 'me', jobs: [queued] }
    expect(isClaimedBy(claim(queue, 'me', 'b', 5), 'me', 'b')).toBe(true)
    expect(claim(queue, 'other', 'b', 5)).toBe(queue)
    expect(claim(queue, 'me', 'zz', 5)).toBe(queue)
    expect(isClaimedBy(queue, 'me', 'b')).toBe(false)
  })

  it('times a reload 1.5 s after the last write (F38)', () => {
    const jobs = [
      job({ id: 'a', kind: 'disable', state: 'ok', endedAt: 100 }),
      job({ id: 'b', kind: 'enable', state: 'failed', endedAt: 300 }),
      job({ id: 'c', kind: 'validate', state: 'ok', endedAt: 900 }),
      job({ id: 'd', kind: 'enable', state: 'queued' }),
      job({ id: 'e', kind: 'reload', state: 'ok', endedAt: 950 }),
    ]
    expect(lastWriteAt(jobs)).toBe(300)
    expect(reloadReadyAt(jobs)).toBe(300 + RELOAD_SETTLE_MS)
    expect(reloadReadyAt([])).toBe(0)
  })
})

describe('mods', () => {
  const listed = parseInstalledList(runs.list)
  const entries = listed.ok ? listed.value.items : []
  const entry = (name: string) => {
    const found = entries.find(item => item.id.startsWith(`${name}@`))
    if (found === undefined) throw new Error(name)
    return found
  }
  const report = (name: string) => {
    const parsed = parseValidateReport(
      (runs as Record<string, { stdout: string; exitCode: number; stderr: string }>)[
        `validate-${name}`
      ] ?? runs['validate-turn-band'],
    )
    if (!parsed.ok) throw new Error(name)
    return parsed.value
  }

  it('builds a row from an entry and its analysis', () => {
    const analysis = analysisOf(
      report('spawner'),
      { skills: 1, agents: 0, hooks: 0, mcp: 0, lsp: 0, tokens: 40 },
      7,
    )
    const row = modRow(entry('spawner'), analysis)
    expect(row).toMatchObject({
      id: 'spawner@fixtures',
      name: 'spawner',
      version: '1.0.0',
      origin: 'folder-marketplace',
      scope: 'local',
      enabled: true,
      toggleable: true,
      mixed: true,
    })
    expect(row.notableCount).toBeGreaterThan(0)
    const detail = modDetail(entry('spawner'), analysis)
    expect(detail).toMatchObject({ tokens: 40, mixedCounts: { skills: 1, agents: 0, mcp: 0 } })
    expect(detail.validate).toEqual({ errors: 0, warnings: analysis.warnings, at: 7 })
  })

  it('names origins and what can be toggled', () => {
    const base = entry('turn-band')
    const { readFromFolder: _r, ...installed } = base
    expect(originOf(installed)).toBe('marketplace')
    expect(originOf({ ...installed, id: id('x@skills-dir') })).toBe('skills-dir')
    const inline = { ...installed, id: id('x@inline'), scope: 'session' as const }
    expect(originOf(inline)).toBe('env-dir')
    expect(isToggleable(inline)).toBe(false)
    expect(isToggleable({ ...installed, scope: 'managed' })).toBe(false)
    const row = modRow(inline, analysisOf(report('turn-band'), undefined, 1))
    expect(row.scope).toBeUndefined()
    expect(row.mixed).toBe(false)
  })

  it('keys analyses by root and version', () => {
    const tb = entry('turn-band')
    expect(analysisKey(tb)).toBe(
      '/tmp/modmgr-fixtures/mkt/turn-band@0.0.0'.replace('0.0.0', tb.folderVersion ?? ''),
    )
    const { readFromFolder: _r, installPath: _i, ...bare } = tb
    expect(analysisKey(bare)).toBeUndefined()
    const { folderVersion: _f, version: _v, ...noVersion } = tb
    expect(analysisKey(noVersion)).toMatch(/@\?$/)
    expect(modDetail(bare, analysisOf(report('turn-band'), undefined, 1)).root).toBeUndefined()
  })

  it('sorts rows by name, then id', () => {
    const analysis = analysisOf(report('turn-band'), undefined, 1)
    const rows = sortRows([
      modRow({ ...entry('turn-band'), id: id('zed@b') }, analysis),
      modRow({ ...entry('turn-band'), id: id('alpha@m') }, analysis),
      modRow({ ...entry('turn-band'), id: id('alpha@a') }, analysis),
    ])
    expect(rows.map(row => row.id)).toEqual(['alpha@a', 'alpha@m', 'zed@b'])
  })
})

describe('store schema', () => {
  const analysis: Analysis = {
    mod: true,
    events: [],
    calls: [],
    envReads: [],
    errors: 1,
    warnings: 0,
    at: 2,
    parts: { skills: 1, agents: 0, mcp: 0 },
    tokens: 9,
  }

  it('migrates a key forward, step by step', () => {
    const migrations = {
      prefs: [
        (data: unknown) => ({ ...(data as object), tab: 'dev' }),
        (data: unknown) => ({ ...(data as object), sort: 'installs' }),
      ],
    }
    const opened = openKey('prefs', envelope({}, 1), migrations, 3)
    expect(opened).toEqual({
      data: { tab: 'dev', sort: 'installs', firstRunDone: false },
      note: 'migrated',
    })
    expect(openKey('prefs', envelope({}, 1), {}, 2).note).toBe('malformed')
    expect(openKey('prefs', { v: 0, data: {} }).note).toBe('malformed')
  })

  it('reads values field by field', () => {
    expect(readPrefs(null).tab).toBe('installed')
    expect(readPrefs({ tab: 'nope', firstRunDone: 'yes' })).toMatchObject({
      tab: 'installed',
      firstRunDone: false,
    })
    expect(readAnalysis(analysis)).toEqual(analysis)
    expect(readAnalysis({ ...analysis, parts: { skills: -1 }, tokens: 'x' })).toEqual({
      mod: true,
      events: [],
      calls: [],
      envReads: [],
      errors: 1,
      warnings: 0,
      at: 2,
    })
    expect(readAnalysis({ ...analysis, errors: 1.5 })).toBeUndefined()
    expect(readAnalysis('x')).toBeUndefined()
    const detect = openKey('detect', envelope({ a: ['s', 'mod'], b: ['s', 'weird'], c: 'x' })).data
    expect(detect).toEqual({ a: ['s', 'mod'] })
    const caps = openKey(
      'capsHistory',
      envelope({ a: { version: '1', notable: ['x'] }, b: { version: 2 } }),
    ).data
    expect(caps).toEqual({ a: { version: '1', notable: ['x'] } })
    expect(openKey('history', envelope('nope')).data).toEqual([])
    expect(
      openKey(
        'history',
        envelope([
          { id: 'a', kind: 'enable', state: 'ok', endedAt: 1, target: 't', error: 'e' },
          'x',
        ]),
      ).data,
    ).toEqual([{ id: 'a', kind: 'enable', state: 'ok', endedAt: 1, target: 't', error: 'e' }])
    expect(openKey('validate', envelope(null)).data).toEqual({})
  })

  it('caps keys and fits a budget, or says it can not', () => {
    const store = emptyStore()
    expect(capped('prefs', store.prefs)).toBe(store.prefs)
    expect(capped('capsHistory', store.capsHistory)).toBe(store.capsHistory)
    const sizes = Object.fromEntries(STORE_KEYS.map(key => [key, bytesOf(store[key])])) as Record<
      (typeof STORE_KEYS)[number],
      number
    >
    expect(fitBudget(store, sizes, 1)).toBeUndefined()
    const fits = fitBudget(store, sizes, 10_000)
    expect(fits?.changed).toEqual([])
  })
})

describe('state defaults', () => {
  it('has a shape tag for every key', () => {
    expect(Object.keys(SHAPES).sort()).toEqual(Object.keys(INITIAL).sort())
    for (const [key, shape] of Object.entries(SHAPES))
      expect(shape).toMatch(new RegExp(`^${key}/\\d+$`))
  })

  it('register.tsx keeps each atom under the tag domain/state.ts names', () => {
    const source = readFileSync(
      join(import.meta.dirname, '../../plugin/hooks/register.tsx'),
      'utf8',
    )
    const tags = Object.fromEntries(
      [...source.matchAll(/key: '(\w+)' \} as const,[\s\S]*?shape: '([\w/]+)'/g)].map(m => [
        m[1],
        m[2],
      ]),
    )
    expect(tags).toEqual(SHAPES)
  })
})
