// Dev's decisions: which folders are dev mods, what their
// last validate and test said, the failures the session reported, sharing.
import { describe, expect, it } from 'vitest'
import type { InstalledEntry } from '../../plugin/hooks/domain/cli-results.ts'
import {
  appliesOf,
  devKey,
  devOfKey,
  devRowOf,
  devRowsOf,
  githubRepoOf,
  isInside,
  joinPath,
  keptSelection,
  lastRun,
  manifestOf,
  marketplaceFolderOf,
  sessionFolderOf,
  shareOf,
  stopLoadingOf,
  testMark,
  unlistedPlugins,
  validateMark,
} from '../../plugin/hooks/domain/dev.ts'
import type { AbsolutePath, PluginId } from '../../plugin/hooks/domain/ids.ts'
import { collisions, helpFor, MOUNT_SETS } from '../../plugin/hooks/domain/keymap.ts'
import { INITIAL_VIEW } from '../../plugin/hooks/domain/state.ts'
import { escapeStep, wrappedRows } from '../../plugin/hooks/domain/view.ts'
import type { DevRow, Job, View } from '../../plugin/types/index.d.ts'

const entry = (id: string, more: Partial<InstalledEntry> = {}): InstalledEntry => ({
  id: id as PluginId,
  scope: 'user',
  enabled: true,
  installPath: `/cache/${id}` as AbsolutePath,
  version: '1.0.0',
  ...more,
})

const folder = (path: string) => path as AbsolutePath

describe('dev rows', () => {
  const listed = [
    { entry: entry('qb@inline', { scope: 'session', installPath: folder('/dev/qb') }), mod: true },
    { entry: entry('skill@skills-dir', { installPath: folder('/skills/skill') }), mod: true },
    {
      entry: entry('tb@fixtures', {
        readFromFolder: folder('/mkt/tb'),
        folderVersion: '0.4.0',
        enabled: false,
      }),
      mod: true,
    },
    // validate couldn't read it: a broken mod is what Dev is for.
    { entry: entry('broken@fixtures', { readFromFolder: folder('/mkt/broken') }), mod: undefined },
    // a plain plugin from a folder is not a mod.
    { entry: entry('plain@fixtures', { readFromFolder: folder('/mkt/plain') }), mod: false },
    // a marketplace install runs a copy nobody edits.
    { entry: entry('copy@official'), mod: true },
  ]

  it('lists the folders a person edits, by section then name', () => {
    const rows = devRowsOf({
      listed,
      commandPlugins: ['mods', 'cc-plugin-diff', 'mine', 'qb@inline'].map(name =>
        name === 'mods' ? 'modmgr' : name,
      ),
      sessionFolder: [{ name: 'fresh', path: '/cfg/dev-mods/s1/fresh', version: '0.1.0' }],
      located: new Map([
        ['modmgr', { name: 'modmgr', path: '/repo/plugin', version: '0.0.0' }],
        // a failure named its folder; it never loaded, so it registered nothing
        ['broke2', { name: 'broke2', path: '/dev/broke2' }],
        // a folder whose manifest names another plugin is not this one
        ['liar', { name: 'other', path: '/dev/liar' }],
      ]),
    })
    expect(rows.map(row => [row.how, row.name, row.enabled])).toEqual([
      ['session-folder', 'fresh', undefined],
      ['plugin-dir', 'broke2', undefined],
      ['plugin-dir', 'modmgr', true],
      ['env-dir', 'qb', true],
      ['skills-dir', 'skill', true],
      ['folder-marketplace', 'broken', true],
      ['folder-marketplace', 'tb', false],
    ])
    expect(rows.find(row => row.name === 'tb')).toMatchObject({
      key: '/mkt/tb',
      path: '/mkt/tb',
      id: 'tb@fixtures',
      version: '0.4.0',
    })
    expect(rows.find(row => row.name === 'fresh')?.version).toBe('0.1.0')
  })

  it('says a folder once, and drops what the CLI lists under its own name', () => {
    const rows = devRowsOf({
      listed: [listed[0] as (typeof listed)[number]],
      commandPlugins: ['qb', 'qb@inline'],
      sessionFolder: [{ name: 'dup', path: '/dev/qb' }],
      located: new Map([['qb', { name: 'qb', path: '/elsewhere/qb' }]]),
    })
    expect(rows.map(row => row.key)).toEqual(['/dev/qb'])
  })

  it('looks for an unlisted plugin by its commands', () => {
    expect(
      unlistedPlugins(['modmgr', 'qb@inline', 'BAD NAME', 'modmgr', 'zz'], new Set(['qb'])),
    ).toEqual(['modmgr', 'zz'])
  })

  it('selects the row asked, else the first', () => {
    const rows = [{ key: '/a' }, { key: '/b' }] as DevRow[]
    expect(devRowOf('/b', rows)?.key).toBe('/b')
    expect(devRowOf('/gone', rows)?.key).toBe('/a')
    expect(devRowOf(undefined, [])).toBeUndefined()
    expect(devOfKey(devKey('/a/b'))).toBe('/a/b')
    expect(devOfKey('row:x')).toBeUndefined()
    expect(devOfKey(undefined)).toBeUndefined()
  })

  it('keeps the selection when a row joins above it', () => {
    const rows = (...keys: string[]) => keys.map(key => ({ key }) as DevRow)
    expect(keptSelection(undefined, rows('/b', '/c'), rows('/a', '/b', '/c'))).toBe('/b')
    expect(keptSelection('/c', rows('/b', '/c'), rows('/a', '/b', '/c'))).toBe('/c')
    expect(keptSelection('/c', rows('/b', '/c'), rows('/a', '/b'))).toBe('/a')
    expect(keptSelection(undefined, [], rows('/a'))).toBe('/a')
    expect(keptSelection('/x', rows('/x'), [])).toBeUndefined()
  })

  it('says how an edit applies and how to stop loading it', () => {
    expect(appliesOf('folder-marketplace')).toMatch(/next plugin reload/)
    expect(appliesOf('plugin-dir')).toMatch(/reloads it in this session/)
    const row = (how: DevRow['how']) => ({ key: '/x', name: 'x', path: '/x', how })
    expect(stopLoadingOf(row('plugin-dir'))).toMatch(/--plugin-dir/)
    expect(stopLoadingOf(row('env-dir'))).toMatch(/CLAUDE_CODE_PLUGIN_DIRS/)
    expect(stopLoadingOf(row('session-folder'))).toMatch(/this session only/)
    expect(stopLoadingOf(row('skills-dir'))).toBeUndefined()
  })
})

describe('folders and manifests', () => {
  it('reads a manifest’s name and version', () => {
    expect(manifestOf('{"name":"tb","version":"0.3.1"}')).toEqual({ name: 'tb', version: '0.3.1' })
    expect(manifestOf('{"name":"tb"}')).toEqual({ name: 'tb' })
    expect(manifestOf('{"name":"Not A Name"}')).toBeUndefined()
    expect(manifestOf('[]')).toBeUndefined()
    expect(manifestOf('not json')).toBeUndefined()
  })

  it('finds where a marketplace file lists a plugin, never above it', () => {
    const text = JSON.stringify({
      plugins: [
        { name: 'modmgr', source: './plugin' },
        { name: 'root', source: './' },
        { name: 'up', source: '../elsewhere' },
        { name: 'remote', source: { source: 'github', repo: 'o/r' } },
      ],
    })
    expect(marketplaceFolderOf(text, 'modmgr')).toBe('plugin')
    expect(marketplaceFolderOf(text, 'root')).toBe('')
    expect(marketplaceFolderOf(text, 'up')).toBeUndefined()
    expect(marketplaceFolderOf(text, 'remote')).toBeUndefined()
    expect(marketplaceFolderOf(text, 'absent')).toBeUndefined()
    expect(marketplaceFolderOf('{}', 'modmgr')).toBeUndefined()
    expect(joinPath('/repo/', 'plugin')).toBe('/repo/plugin')
    expect(joinPath('/repo', '')).toBe('/repo')
  })

  it('finds this session’s mods folder', () => {
    expect(sessionFolderOf({ configDir: '/cfg', home: '/home/me', sessionId: 's-1' })).toBe(
      '/cfg/dev-mods/s-1',
    )
    expect(sessionFolderOf({ configDir: undefined, home: '/home/me', sessionId: 's-1' })).toBe(
      '/home/me/.claude/dev-mods/s-1',
    )
    expect(sessionFolderOf({ configDir: '', home: '/home/me', sessionId: 's' })).toBe(
      '/home/me/.claude/dev-mods/s',
    )
    expect(sessionFolderOf({ configDir: 'rel', home: undefined, sessionId: 's' })).toBeUndefined()
    expect(
      sessionFolderOf({ configDir: undefined, home: undefined, sessionId: 's' }),
    ).toBeUndefined()
    expect(
      sessionFolderOf({ configDir: '/cfg', home: undefined, sessionId: '../x' }),
    ).toBeUndefined()
  })
})

describe('what ran', () => {
  const job = (more: Partial<Job>): Job => ({
    id: 'j',
    kind: 'validate',
    state: 'ok',
    tail: [],
    args: { path: '/dev/a' },
    ...more,
  })

  it('finds the newest run of a folder', () => {
    const jobs = [
      job({ id: '1', state: 'failed' }),
      job({ id: '2', kind: 'test' }),
      job({ id: '3' }),
      job({ id: '4', args: { path: '/dev/b' } }),
    ]
    expect(lastRun(jobs, 'validate', '/dev/a')?.id).toBe('3')
    expect(lastRun(jobs, 'test', '/dev/a')?.id).toBe('2')
    expect(lastRun(jobs, 'test', '/dev/b')).toBeUndefined()
  })

  it('marks a validate and a test', () => {
    expect(validateMark(undefined)).toBeUndefined()
    expect(validateMark(job({ state: 'running' }))?.tone).toBe('busy')
    expect(validateMark(job({ report: { errors: 0, warnings: 0 } }))?.text).toBe('✓ valid')
    expect(validateMark(job({ report: { errors: 0, warnings: 1 } }))?.text).toBe('✓ 1 warning')
    expect(validateMark(job({ report: { errors: 0, warnings: 2 } }))?.text).toBe('✓ 2 warnings')
    expect(validateMark(job({ state: 'failed', report: { errors: 1, warnings: 0 } }))).toEqual({
      text: '✗ 1 error',
      tone: 'bad',
    })
    expect(validateMark(job({ state: 'failed', report: { errors: 3, warnings: 0 } }))?.text).toBe(
      '✗ 3 errors',
    )
    expect(validateMark(job({ state: 'failed' }))?.text).toBe('✗ validate failed')
    expect(validateMark(job({ state: 'interrupted' }))).toEqual({
      text: 'validate interrupted',
      tone: 'muted',
    })
    const test = (state: Job['state']) => testMark(job({ kind: 'test', state }))
    expect(testMark(undefined)).toBeUndefined()
    expect(test('queued')?.text).toBe('testing…')
    expect(test('ok')?.text).toBe('✓ tests')
    expect(test('failed')?.text).toBe('✗ tests')
    expect(test('cancelled')?.text).toBe('tests cancelled')
  })
})

describe('sharing', () => {
  it('reads owner/repo from a GitHub remote', () => {
    expect(githubRepoOf('https://github.com/ayagmar/modmgr.git')).toBe('ayagmar/modmgr')
    expect(githubRepoOf('git@github.com:ayagmar/modmgr.git')).toBe('ayagmar/modmgr')
    expect(githubRepoOf('ssh://git@github.com/ayagmar/modmgr')).toBe('ayagmar/modmgr')
    expect(githubRepoOf('https://gitlab.com/a/b.git')).toBeUndefined()
    expect(githubRepoOf(null)).toBeUndefined()
    expect(githubRepoOf(undefined)).toBeUndefined()
    expect(isInside('/repo/plugin', '/repo')).toBe(true)
    expect(isInside('/repo', '/repo/')).toBe(true)
    expect(isInside('/repository', '/repo')).toBe(false)
  })

  it('gives the install line, and what is missing for it', () => {
    const listed = shareOf(
      { name: 'modmgr', how: 'plugin-dir' },
      { repo: 'ayagmar/modmgr', listed: true, source: './plugin' },
    )
    expect(listed).toEqual({
      line: '/plugin install modmgr --marketplace ayagmar/modmgr',
      complete: true,
      notes: [],
    })
    const bare = shareOf(
      { name: 'tb', how: 'session-folder' },
      { repo: undefined, listed: false, source: './' },
    )
    expect(bare.line).toBe('/plugin install tb --marketplace <owner>/<repo>')
    expect(bare.complete).toBe(false)
    expect(bare.notes).toHaveLength(3)
    expect(bare.notes.at(-1)).toMatch(/beside its plugin.json/)
    expect(JSON.parse(bare.snippet ?? '')).toEqual({
      name: 'tb',
      owner: { name: '<your name>' },
      plugins: [{ name: 'tb', source: './' }],
    })
    const sub = shareOf(
      { name: 'm', how: 'plugin-dir' },
      { repo: 'o/r', listed: false, source: './m' },
    )
    expect(sub.notes.at(-1)).toMatch(/repository's root/)
    expect(JSON.parse(sub.snippet ?? '').plugins[0].source).toBe('./m')
  })
})

describe('the pane around Dev', () => {
  it('binds no hotkey twice where Dev’s overlays mount', () => {
    expect(collisions()).toEqual([])
    expect(MOUNT_SETS).toContainEqual(['pane', 'dev', 'share'])
    expect(MOUNT_SETS).not.toContainEqual(['pane', 'discover', 'dev-detail'])
    const keys = helpFor(['pane', 'dev']).map(row => row.key)
    expect(keys).toEqual(expect.arrayContaining(['v', 't', 'c', 'p', 'l', 'r']))
    expect(keys).not.toContain('f')
  })

  it('leaves Installed’s filter alone on Dev’s Esc', () => {
    const view: View = { ...INITIAL_VIEW, tab: 'dev', query: 'x' }
    expect(escapeStep(view, true)).toEqual({ kind: 'close' })
  })

  it('counts wrapped rows', () => {
    expect(wrappedRows(['', 'abcd', 'abcde'], 4)).toBe(4)
    expect(wrappedRows([], 10)).toBe(0)
    // Words move whole: a cut through a word costs the row the terminal adds.
    expect(wrappedRows(['ab cd ef'], 5)).toBe(2)
    expect(wrappedRows(['abc defgh'], 4)).toBe(3)
    expect(wrappedRows(['abcdefghij k'], 4)).toBe(3)
  })
})
