// What `/mods` says as text for each subcommand.
import { describe, expect, it } from 'vitest'
import {
  APPLY_MAX,
  applyPlan,
  doctorText,
  exportOf,
  infoText,
  jobsText,
  listText,
  whyNot,
} from '../../plugin/hooks/domain/command-text.ts'
import type { HealthItem } from '../../plugin/hooks/domain/health.ts'
import type { Job, ModDetail, ModRow } from '../../plugin/types/index.d.ts'

const row = (name: string, more: Partial<ModRow> = {}): ModRow => ({
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
})

const job = (more: Partial<Job>): Job => ({
  id: 'j',
  kind: 'disable',
  state: 'ok',
  tail: [],
  ...more,
})

describe('list and info', () => {
  it('lists each mod on a line, with what it says', () => {
    expect(listText([], { skipped: 0 })).toBe('No mods installed.')
    expect(
      listText(
        [
          row('a', { problems: 2, notableCount: 1, updateTo: '1.1.0' }),
          row('b', { enabled: false, scope: undefined as never, origin: 'env-dir' }),
        ],
        { skipped: 1 },
      ).split('\n'),
    ).toEqual([
      '2 mods (1 on)',
      '●  a  1.0.0  user  ↑1.1.0  ▲2  ◆1',
      '○  b  1.0.0  env-dir  off',
      '1 plugins could not be read.',
    ])
    expect(listText([row('a')], { skipped: 0 })).toBe('1 mod (1 on)\n●  a  1.0.0  user')
  })

  it('details one mod: facts, notable items, reach, validate, parts, data, folder', () => {
    const detail: ModDetail = {
      ...row('tb', { updateTo: '2.0.0' }),
      description: 'Shows a band',
      caps: {
        events: ['prompt.submit'],
        calls: ['process.run', 'ui.render'],
        envReads: [],
        reach: [],
        notable: [],
      },
      validate: { errors: 1, warnings: 0, at: 1 },
      mixedCounts: { skills: 2, agents: 0, mcp: 0 },
      dataBytes: 2048,
      root: '/mkt/tb',
    }
    const text = infoText(detail)
    expect(text.split('\n').slice(0, 3)).toEqual(['tb 1.0.0', 'tb@m · user · on', 'Shows a band'])
    expect(text).toContain('↑ 2.0.0 is available')
    expect(text).toContain('◆ Can run programs or change files on your machine (process.run)')
    expect(text).toContain('validate: 1 errors, 0 warnings')
    expect(text).toContain('Also contains: 2 skills')
    expect(text).toContain('Data: 2 KB')
    expect(text).toContain('Folder: /mkt/tb')
    const quiet = infoText({
      ...row('q', { enabled: false, origin: 'env-dir', toggleable: false }),
      validate: { errors: 0, warnings: 0, at: 1 },
    })
    expect(quiet).toContain('loaded from CLAUDE_CODE_PLUGIN_DIRS')
    expect(quiet).toContain('✓ validate finds nothing wrong')
    const { version: _v, ...bare } = row('bare')
    expect(infoText(bare).split('\n')[0]).toBe('bare')
  })
})

describe('doctor', () => {
  const items: HealthItem[] = [
    {
      key: 'a',
      group: 'tb',
      tone: 'bad',
      text: 'validate finds 1 error in it',
      fixLabel: 'see it',
    },
    { key: 'b', group: 'tb', tone: 'warn', text: 'since 0.3 it can run programs' },
    { key: 'c', group: 'modmgr', tone: 'info', text: 'cache: 1 KB' },
  ]

  it('says problems by group, with where to fix them', () => {
    expect(doctorText(items, false).split('\n')).toEqual([
      '1 problem',
      'tb',
      '  ▲ validate finds 1 error in it  (in /mods → Health: see it)',
      '  ◆ since 0.3 it can run programs',
      'modmgr',
      '    cache: 1 KB',
    ])
    expect(doctorText([], false)).toBe('✓ Nothing needs you.')
    expect(doctorText([items[0] as HealthItem, items[0] as HealthItem], false).split('\n')[0]).toBe(
      '2 problems',
    )
  })

  it('is JSON for a script', () => {
    expect(JSON.parse(doctorText(items, true))).toEqual({
      problems: 1,
      items: [
        { group: 'tb', tone: 'bad', text: 'validate finds 1 error in it', fix: 'see it' },
        { group: 'tb', tone: 'warn', text: 'since 0.3 it can run programs' },
        { group: 'modmgr', tone: 'info', text: 'cache: 1 KB' },
      ],
    })
  })
})

describe('export and apply', () => {
  it('exports what the CLI installed', () => {
    const { version: _v, ...noVersion } = row('nv')
    expect(
      exportOf([
        row('a'),
        row('f', { origin: 'folder-marketplace', scope: 'project' }),
        noVersion,
        row('m', { scope: 'managed', toggleable: false }),
        row('e', { origin: 'env-dir', toggleable: false }),
      ]),
    ).toEqual({
      mods: [
        { id: 'a@m', scope: 'user', version: '1.0.0' },
        { id: 'f@m', scope: 'project', version: '1.0.0' },
        { id: 'nv@m', scope: 'user' },
      ],
    })
  })

  it('plans installs and enables, and says what it can’t read', () => {
    const mods = [
      row('on'),
      row('off', { enabled: false }),
      row('locked', { enabled: false, toggleable: false, scope: 'managed' }),
    ]
    const file = JSON.stringify({
      mods: [
        { id: 'on@m', scope: 'user' },
        { id: 'off@m' },
        { id: 'locked@m' },
        { id: 'new@m', scope: 'project' },
      ],
    })
    expect(applyPlan(file, mods)).toEqual({
      steps: [
        { kind: 'enable', id: 'off@m', scope: 'user' },
        { kind: 'install', id: 'new@m', scope: 'project' },
      ],
      already: 2,
      errors: [],
    })
    const noScope = [row('x', { enabled: false, scope: undefined as never })]
    expect(applyPlan(JSON.stringify({ mods: [{ id: 'x@m' }] }), noScope).steps).toEqual([
      { kind: 'enable', id: 'x@m' },
    ])
    expect(applyPlan('nope', []).errors).toEqual([
      'the file is not { "mods": [{ "id", "scope" }] }',
    ])
    const many = JSON.stringify({
      mods: Array.from({ length: APPLY_MAX + 1 }, () => ({ id: 'a@m' })),
    })
    expect(applyPlan(many, []).errors[0]).toMatch(/more than 100/)
    expect(
      applyPlan(JSON.stringify({ mods: ['x', { id: 'a@m', scope: 'managed' }] }), []).errors,
    ).toEqual([
      'entry 1: an id (name@marketplace) and a scope (user, project, local)',
      'entry 2: an id (name@marketplace) and a scope (user, project, local)',
    ])
  })

  it('says why a write can’t touch a mod', () => {
    const locked = row('l', { origin: 'env-dir', toggleable: false })
    expect(whyNot('enable', locked)).toMatch(/CLAUDE_CODE_PLUGIN_DIRS/)
    expect(whyNot('update', row('f', { origin: 'folder-marketplace' }))).toMatch(
      /marketplace folder/,
    )
    expect(whyNot('remove', row('s', { origin: 'skills-dir' }))).toMatch(/skills folder/)
    expect(whyNot('disable', row('ok'))).toBeUndefined()
  })
})

describe('how the jobs ended', () => {
  it('says each, and what applies them', () => {
    expect(
      jobsText([
        job({ kind: 'marketplace-update', target: 'official', tail: ['Updated'] }),
        job({ kind: 'update', target: 'tb@m', unchanged: true, tail: ['already so: current'] }),
        job({ kind: 'disable', target: 'qb@m', tail: [] }),
      ]),
    ).toEqual({
      text: [
        '✓ refresh marketplace official: Updated',
        '✓ update tb@m (already so): already so: current',
        '✓ disable qb@m',
        'Run /reload-plugins (or restart Claude Code) to apply.',
      ].join('\n'),
      failed: false,
    })
  })

  it('shows a declared command whole, or sends a long one to a terminal', () => {
    const shown = {
      kind: 'command_source' as const,
      command: 'echo one\necho two',
      sha256: 'f'.repeat(64),
    }
    const stopped = jobsText([
      job({
        kind: 'install',
        target: 'cmd@m',
        state: 'failed',
        error: { kind: 'conflict', message: 'needs review' },
        shown,
      }),
    ])
    expect(stopped.failed).toBe(true)
    expect(stopped.text.split('\n')).toEqual([
      '✗ install cmd@m: needs review',
      '  It runs this command, shown as the marketplace declares it:',
      '    echo one',
      '    echo two',
      `  To run it: /mods install cmd@m --accept-command ${'f'.repeat(64)} --yes`,
    ])
    expect(
      jobsText([job({ kind: 'install', state: 'failed', shown: { ...shown, truncated: true } })])
        .text,
    ).toContain('It is longer than modmgr shows')
    // At a scope, the hint keeps it; an update's stop is reviewed in the dialog.
    const atScope = job({
      kind: 'install',
      target: 'c@m',
      state: 'failed',
      args: { scope: 'project' },
      shown,
    })
    expect(jobsText([atScope]).text).toContain(
      `/mods install c@m --scope project --accept-command ${'f'.repeat(64)} --yes`,
    )
    expect(
      jobsText([job({ kind: 'update', target: 'c@m', state: 'failed', shown })]).text,
    ).toContain('Review it in /mods (v), or run claude plugin update c@m in a terminal.')
    expect(jobsText([job({ state: 'interrupted' })]).text).toBe('✗ disable: interrupted')
  })
})
