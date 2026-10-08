import { describe, expect, it } from 'vitest'
import {
  type CliRun,
  lastJsonObject,
  parseAvailable,
  parseCatalogEntry,
  parseCatalogSource,
  parseDetails,
  parseInstalledEntry,
  parseInstalledList,
  parseMarketplaces,
  parseOpResult,
  parseShownCommand,
} from '../../plugin/hooks/domain/cli-results.ts'
import { runs } from './fixtures/cli-runs.ts'

const run = (stdout: string, exitCode = 0, stderr = ''): CliRun => ({ stdout, exitCode, stderr })
const okValue = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}
const errKind = (result: { ok: boolean; error?: { kind: string } }): string | undefined =>
  result.ok ? undefined : result.error?.kind

describe('lastJsonObject', () => {
  it('takes the last JSON object line after human lines (F26)', () => {
    const line = lastJsonObject(runs['install-command-refused'].stdout)
    expect(line?.failureCode).toBe('command_source_refused')
  })
  it('skips non-object and broken lines', () => {
    expect(lastJsonObject('{"a":1}\n[1,2]\n{broken\n')).toEqual({ a: 1 })
    expect(lastJsonObject('nothing here')).toBeUndefined()
  })
})

describe('parseOpResult on real captures', () => {
  it.each([
    'install-ok-user',
    'install-ok-project',
    'install-ok-local',
    'install-ok-plain',
    'install-quiet-bash',
    'disable-ok',
    'disable-project',
    'enable-ok',
    'uninstall-ok',
    'uninstall-project',
    'marketplace-add-ok',
    'marketplace-update-ok',
  ] as const)('%s is done', name => {
    const outcome = okValue(parseOpResult(runs[name]))
    expect(outcome.status).toBe('done')
    if (outcome.status === 'done') expect(outcome.unchanged).toBe(false)
  })

  it('reads the plugin id and scope', () => {
    const outcome = okValue(parseOpResult(runs['install-ok-project']))
    expect(outcome).toMatchObject({ pluginId: 'redactor@fixtures', scope: 'project' })
  })

  it.each(['disable-again', 'enable-again'] as const)('%s is unchanged, not a failure', name => {
    const outcome = okValue(parseOpResult(runs[name]))
    expect(outcome).toMatchObject({ status: 'done', unchanged: true })
  })

  it('reads update outcomes', () => {
    expect(okValue(parseOpResult(runs['update-bumped']))).toMatchObject({
      update: { outcome: 'updated', from: '0.2.0', to: '0.3.0' },
    })
    expect(okValue(parseOpResult(runs['update-current']))).toMatchObject({
      update: { outcome: 'up_to_date', from: '0.3.1', to: '0.3.1' },
    })
  })

  it.each([
    ['install-not-found', 'not_found'],
    ['install-bad-marketplace', undefined],
    ['update-not-installed', undefined],
    ['uninstall-not-installed', undefined],
    ['marketplace-add-missing', 'invalid_source'],
    ['marketplace-update-unknown', undefined],
  ] as const)('%s fails as cli-failed', (name, code) => {
    const result = parseOpResult(runs[name])
    expect(errKind(result)).toBe('cli-failed')
    if (!result.ok && code !== undefined) expect(result.error.code).toBe(code)
    if (!result.ok) expect(result.error.message.length).toBeGreaterThan(0)
  })

  it('falls back to stderr when no JSON was printed', () => {
    const result = parseOpResult(runs['install-bad-scope'])
    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: 'cli-failed',
        message: 'Invalid scope: galaxy. Must be one of: user, project, local.',
      },
    })
  })

  it('needs acceptance for a declared command (F25)', () => {
    const outcome = okValue(parseOpResult(runs['install-command-refused']))
    expect(outcome.status).toBe('needs-acceptance')
    if (outcome.status !== 'needs-acceptance') return
    expect(outcome.changed).toBe(false)
    expect(outcome.shown).toMatchObject({
      kind: 'command_source',
      pluginId: 'cmdmod@cmdmkt',
      command: '/tmp/modmgr-fixtures/emit.sh',
      mode: 'copy',
    })
    expect(outcome.shown.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('reports a changed command when the given sha no longer matches', () => {
    const outcome = okValue(parseOpResult(runs['install-command-wrong-sha']))
    expect(outcome).toMatchObject({ status: 'needs-acceptance', changed: true })
  })

  it('treats a matched sha that still failed as rejected (F27)', () => {
    const stdout = runs['install-command-wrong-sha'].stdout.replace(
      '"acceptCommandMatched":false',
      '"acceptCommandMatched":true',
    )
    expect(errKind(parseOpResult(run(stdout, 1)))).toBe('rejected')
  })

  it('treats "ignored inside a Claude Code session" as rejected (F27)', () => {
    const stdout = `--accept-command is ignored inside a Claude Code session: run this in your own terminal\n${runs['install-command-refused'].stdout}`
    expect(errKind(parseOpResult(run(stdout, 1)))).toBe('rejected')
  })

  it('is a parse error when exit 0 printed no JSON', () => {
    expect(errKind(parseOpResult(run('done\n')))).toBe('parse')
  })

  it('names the exit code when nothing at all was printed', () => {
    expect(parseOpResult(run('', 3))).toMatchObject({ ok: false, error: { message: 'exit 3' } })
  })

  it('accepts an ok line without a plugin id', () => {
    expect(
      okValue(parseOpResult(run('{"command":"marketplace-add","outcome":"ok"}'))),
    ).toMatchObject({
      status: 'done',
      command: 'marketplace-add',
      message: '',
    })
  })

  it('names a failure with no message by its command', () => {
    expect(parseOpResult(run('{"outcome":"failed"}', 1))).toMatchObject({
      ok: false,
      error: { message: 'unknown failed' },
    })
  })

  it('sanitises hostile messages', () => {
    const outcome = okValue(
      parseOpResult(
        run('{"command":"install","outcome":"ok","message":"ok\\u001b[31m\\u202eevil"}'),
      ),
    )
    expect(outcome.status === 'done' && outcome.message).toBe('okevil')
  })
})

describe('parseShownCommand', () => {
  it('reads an entry_helper', () => {
    expect(
      parseShownCommand({
        kind: 'entry_helper',
        pluginId: 'a@b',
        command: 'helper',
        archiveUrl: 'https://x/a.zip',
        catalogRevision: 'git:abc',
        sha256: 'a'.repeat(64),
      }),
    ).toMatchObject({ kind: 'entry_helper', archiveUrl: 'https://x/a.zip' })
  })
  it.each([
    undefined,
    { kind: 'other', pluginId: 'a@b', command: 'c', catalogRevision: 'r', sha256: 'a'.repeat(64) },
    {
      kind: 'command_source',
      pluginId: 'a@b',
      command: 'c',
      catalogRevision: 'r',
      sha256: 'short',
    },
    { kind: 'command_source', command: 'c', catalogRevision: 'r', sha256: 'a'.repeat(64) },
  ])('refuses %j', value => {
    expect(parseShownCommand(value)).toBeUndefined()
  })
})

describe('parseInstalledList', () => {
  it('reads every scope and field from a real list', () => {
    const { items, skipped } = okValue(parseInstalledList(runs.list))
    expect(skipped).toBe(0)
    expect(items.map(item => item.id)).toContain('turn-band@fixtures')
    const project = items.find(item => item.id === 'redactor@fixtures')
    expect(project).toMatchObject({
      scope: 'project',
      projectEnabled: true,
      projectPath: '/tmp/modmgr-fixtures/project',
      readFromFolder: '/tmp/modmgr-fixtures/mkt/redactor',
    })
    expect(items.find(item => item.id === 'spawner@fixtures')?.scope).toBe('local')
  })

  it('reads a toggled state', () => {
    const { items } = okValue(parseInstalledList(runs['list-after-toggles']))
    expect(items.find(item => item.id === 'redactor@fixtures')?.enabled).toBe(false)
  })

  it('reads dataDirSize and session-scoped inline dirs (F33, F34)', () => {
    const entry = parseInstalledEntry({
      id: 'env-b@inline',
      version: '0.0.1',
      scope: 'session',
      enabled: true,
      installPath: '/x/env-b',
      dataDirSize: { bytes: 12345, human: '12.1KB' },
    })
    expect(entry).toMatchObject({ scope: 'session', dataBytes: 12345 })
  })

  it('skips malformed entries and counts them', () => {
    const stdout = JSON.stringify([
      { id: 'ok@m', scope: 'user', enabled: true },
      { id: 'Bad Id', scope: 'user', enabled: true },
      { id: 'x@m', scope: 'galaxy', enabled: true },
      { id: 'y@m', scope: 'user' },
      { id: 'z@m', scope: 'user', enabled: true, installPath: 'relative/path' },
      'nope',
    ])
    const { items, skipped } = okValue(parseInstalledList(run(stdout)))
    expect(items.map(item => item.id)).toEqual(['ok@m', 'z@m'])
    expect(items[1]?.installPath).toBeUndefined()
    expect(skipped).toBe(4)
  })

  it('fails on a non-array and on garbage', () => {
    expect(errKind(parseInstalledList(run('{}')))).toBe('parse')
    expect(errKind(parseInstalledList(run('garbage')))).toBe('parse')
    expect(errKind(parseInstalledList(run('', 1, 'boom')))).toBe('cli-failed')
  })
})

describe('parseAvailable', () => {
  it('reads the trimmed real catalogue', () => {
    const { installed, available } = okValue(parseAvailable(runs['list-available']))
    expect(installed.items.length).toBeGreaterThan(0)
    expect(available.items.length).toBeGreaterThan(150)
    expect(available.skipped).toBe(0)
    const kinds = new Set(available.items.map(item => item.source.kind))
    expect(kinds).toEqual(new Set(['url', 'git-subdir', 'relative', 'command']))
  })

  it('fails without the two lists', () => {
    expect(errKind(parseAvailable(run('{"installed":[]}')))).toBe('parse')
    expect(errKind(parseAvailable(run('[]')))).toBe('parse')
  })
})

describe('parseCatalogEntry and parseCatalogSource', () => {
  it('reads installs and version, dropping negatives', () => {
    const base = { pluginId: 'a@m', name: 'a', marketplaceName: 'm', source: './a' }
    expect(parseCatalogEntry({ ...base, installCount: 1500.7, version: '1.0.0' })).toMatchObject({
      installs: 1500,
      version: '1.0.0',
      description: '',
    })
    expect(parseCatalogEntry({ ...base, installCount: -3 })?.installs).toBeUndefined()
    expect(parseCatalogEntry({ ...base, installCount: null })?.installs).toBeUndefined()
    expect(parseCatalogEntry({ ...base, pluginId: 'BAD' })).toBeUndefined()
    expect(parseCatalogEntry(7)).toBeUndefined()
  })

  it.each([
    ['./x', { kind: 'relative', path: './x' }],
    [
      { source: 'url', url: 'https://github.com/a/b.git', sha: 's' },
      { kind: 'url', sha: 's' },
    ],
    [
      { source: 'git-subdir', url: 'u', path: 'p', ref: 'r' },
      { kind: 'git-subdir', path: 'p', ref: 'r' },
    ],
    [
      { source: 'github', repo: 'a/b' },
      { kind: 'github', repo: 'a/b' },
    ],
    [
      { source: 'command', command: 'c' },
      { kind: 'command', command: 'c' },
    ],
    [
      { source: 'npm', package: 'x' },
      { kind: 'other', type: 'npm' },
    ],
    [{ source: 'url' }, { kind: 'other', type: 'url' }],
    [{}, { kind: 'other', type: 'unknown' }],
    [42, { kind: 'other', type: 'number' }],
  ] as const)('%j', (value, expected) => {
    expect(parseCatalogSource(value)).toMatchObject(expected)
  })
})

describe('parseMarketplaces', () => {
  it('reads github and directory marketplaces', () => {
    const { items } = okValue(parseMarketplaces(runs['marketplace-list']))
    expect(items).toContainEqual({
      name: 'claude-plugins-official',
      source: 'github',
      location: 'anthropics/claude-plugins-official',
      installLocation: '/tmp/modmgr-fixtures/config/plugins/marketplaces/claude-plugins-official',
    })
    expect(items).toContainEqual({
      name: 'fixtures',
      source: 'directory',
      location: '/tmp/modmgr-fixtures/mkt',
      installLocation: '/tmp/modmgr-fixtures/mkt',
    })
  })
  it('skips malformed rows and rejects a non-array', () => {
    expect(okValue(parseMarketplaces(run('[{"name":"a"},3,{"name":"b","source":"url"}]')))).toEqual(
      {
        items: [{ name: 'b', source: 'url' }],
        skipped: 2,
      },
    )
    expect(errKind(parseMarketplaces(run('{}')))).toBe('parse')
  })
})

describe('parseDetails', () => {
  it('reads counts and tokens', () => {
    expect(okValue(parseDetails(runs['details-plain-skill']))).toEqual({
      skills: 1,
      agents: 0,
      hooks: 0,
      mcp: 0,
      lsp: 0,
      tokens: 7,
    })
  })
  it('reads thousands and a missing token line', () => {
    const text = 'Component inventory\n  Skills (2)\n  MCP servers (1)\nAlways-on:   ~1,234 tok\n'
    expect(okValue(parseDetails(run(text)))).toMatchObject({ skills: 2, mcp: 1, tokens: 1234 })
    expect(okValue(parseDetails(run('Component inventory\n'))).tokens).toBeUndefined()
  })
  it('fails without an inventory or on a failed run', () => {
    expect(errKind(parseDetails(run('hello')))).toBe('parse')
    expect(errKind(parseDetails(run('', 1, '✘ not found')))).toBe('cli-failed')
  })
})
