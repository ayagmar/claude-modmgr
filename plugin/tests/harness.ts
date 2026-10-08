// The host beneath modmgr in `claude plugin test` (F24): every `$` call the
// plugin makes reaches a hook here. `mock` answers clock, store and env; this
// answers state (with versions and `ifVersion`), the session, commands, logs
// and a fake `claude` CLI that replies from captured output (fixtures.ts).

import type { CommandInfo, On, PaneOpenArgs, SessionRepo, UiPane } from 'claude-code'
import { mock } from 'claude-code/testing'
import { SHAPES } from '../hooks/domain/state.ts'
import { RUNS } from './fixtures.ts'

export type CliAnswer = { exitCode?: number; stdout?: string; stderr?: string } | { throws: string }

/** Answers one argv (after `claude`), or undefined to fall back to the fixtures. */
export type Cli = (args: readonly string[]) => CliAnswer | undefined

export type HostOptions = {
  store?: Readonly<Record<string, unknown>>
  env?: Readonly<Record<string, string>>
  cli?: Cli
  /** What `/reload-plugins` answers; throw to refuse it. */
  reload?: () => string
  /** `$.state` values to start from, by modmgr key (written under their shape tags). */
  state?: Readonly<Record<string, unknown>>
  /** Make `$.command.register` reject. */
  refuseRegister?: boolean
  /** Whether a pane open is placed (false: a session that places none). */
  placePanes?: boolean
  /** Whether the person holds an open pane's keys (the Esc cascade reads it). */
  paneFocused?: boolean
  /** `$.http.fetch` answers by URL (200 with the text); others are 404. */
  web?: Readonly<Record<string, string>>
  /** `$.fs.read` answers by path; others are missing. */
  files?: Readonly<Record<string, string>>
  /** `$.fs.list` answers by directory (entries are folders, or files when named `*.md`). */
  dirs?: Readonly<Record<string, readonly string[]>>
  /** What `$.command.list()` answers. */
  commands?: readonly CommandInfo[]
  /** What `$.session.repo()` answers. */
  repo?: SessionRepo
}

const fromFixtures = (args: readonly string[]): CliAnswer => {
  const [first, second] = args
  if (first === '--version') return { stdout: '2.1.292 (Claude Code)\n' }
  if (first !== 'plugin') return { throws: `unexpected command ${args.join(' ')}` }
  if (second === 'list') return args.includes('--available') ? RUNS['list-available'] : RUNS.list
  if (second === 'validate') {
    const folder = args.at(-1)?.split('/').at(-1) ?? ''
    const run = (RUNS as Record<string, CliAnswer>)[`validate-${folder}`]
    return run ?? { exitCode: 1, stderr: 'no such folder' }
  }
  if (second === 'details') {
    return args.includes('plain-skill@fixtures')
      ? RUNS['details-plain-skill']
      : RUNS['details-turn-band']
  }
  if (second === 'disable') return RUNS['disable-ok']
  if (second === 'enable') return RUNS['enable-ok']
  if (second === 'uninstall') {
    // The CLI says whether it kept the data folder, as it was asked.
    const run = RUNS['uninstall-ok']
    return args.includes('--keep-data')
      ? { ...run, stdout: run.stdout.replace('"keptData":false', '"keptData":true') }
      : run
  }
  if (second === 'install') return RUNS['install-quiet-bash']
  if (second === 'update') return RUNS['update-bumped']
  if (second === 'marketplace') {
    if (args[2] === 'list') return RUNS['marketplace-list']
    if (args[2] === 'add') return RUNS['marketplace-add-ok']
    return RUNS['marketplace-update-ok']
  }
  return { throws: `unexpected command ${args.join(' ')}` }
}

export const host = (on: On, options: HostOptions = {}) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  // The test's `$` has no store noun: watch the plugin's writes above the mock.
  const stored = new Map<string, unknown>()
  // (A matcher, because mock.store hooks the event without one, F37.)
  on('store.set', { key: /^/ }, (_$, e, next) => {
    stored.set(e.key, e.value)
    return next(e)
  })
  // A returning person by default: the first run's welcome is its own test.
  mock.store(on, { prefs: RETURNING, ...options.store })
  mock.env(on, options.env ?? {})

  const state = new Map<string, { value: unknown; version: number }>()
  for (const [key, value] of Object.entries(options.state ?? {})) {
    const shape = (SHAPES as Record<string, string>)[key] ?? `${key}/1`
    state.set(`modmgr.${key}`, { value: { shape, value }, version: 1 })
  }
  const logs: string[] = []
  const argvs: string[] = []
  let registered = 0
  let reloads = 0
  const opens: PaneOpenArgs[] = []
  const closes: string[] = []
  const focuses: string[] = []
  const copies: string[] = []
  const statuses: (string | undefined)[] = []
  let panes: UiPane[] = []

  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('state.get', (_$, e) => ({
    value: state.get(`${e.plugin}.${e.key}`) ?? { value: undefined, version: 0 },
  }))
  on('state.set', (_$, e) => {
    const name = `${e.plugin}.${e.key}`
    const held = state.get(name) ?? { value: undefined, version: 0 }
    if (e.ifVersion !== undefined && e.ifVersion !== held.version) {
      return { value: { isSet: false, version: held.version } }
    }
    const version = held.version + 1
    state.set(name, { value: e.value, version })
    return { value: { isSet: true, version } }
  })
  on('command.register', (_$, e) => {
    if (options.refuseRegister === true) return { deny: 'refused by the test' }
    registered += 1
    return { value: { command: e.name } }
  })
  on('command.run', { command: 'reload-plugins' }, () => {
    reloads += 1
    return { text: options.reload === undefined ? 'Reloaded: 1 plugin' : options.reload() }
  })
  on('ui.log', (_$, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('session.root', () => ({ value: '/repo' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('session.repo', () => ({ value: options.repo ?? null }))
  on('command.list', () => ({ value: [...(options.commands ?? [])] }))
  on('ui.open', (_$, e) => {
    opens.push(e)
    if (options.placePanes === false) {
      return { value: { isPlaced: false as const, reason: 'no surface places panes' } }
    }
    const pane: UiPane = {
      id: e.id,
      title: e.title ?? e.id,
      isShown: true,
      isFocused: options.paneFocused ?? true,
      isPlaced: true,
    }
    panes = [...panes.filter(item => item.id !== e.id), pane]
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', (_$, e) => {
    closes.push(`${e.id}:${e.origin.kind}`)
    panes = panes.filter(pane => pane.id !== e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: panes }))
  // What the engine draws in the band when no plugin does: nothing.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  on('ui.focus', (_$, e) => {
    focuses.push(e.element ?? '')
    return {}
  })
  on('ui.status', (_$, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  // The detector's probes: nothing is found unless a test says so.
  const fetched: string[] = []
  on('http.fetch', (_$, e) => {
    fetched.push(e.url)
    const text = options.web?.[e.url]
    return {
      value: {
        status: text === undefined ? 404 : 200,
        ok: text !== undefined,
        headers: {},
        text: text ?? '',
      },
    }
  })
  on('fs.read', (_$, e) => {
    const text = options.files?.[e.path]
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('fs.list', (_$, e) => {
    const names = e.path === undefined ? undefined : options.dirs?.[e.path]
    if (names === undefined) return { deny: `ENOENT: ${e.path ?? ''}` }
    return {
      value: names.map(name => ({
        name,
        kind: name.endsWith('.md') ? ('file' as const) : ('dir' as const),
        size: 0,
        mtimeMs: 0,
        isLink: false,
      })),
    }
  })
  on('ui.copy', (_$, e) => {
    copies.push(e.text)
    return { value: { isCopied: true as const } }
  })
  on('process.run', (_$, e) => {
    const args = e.argv.slice(1)
    argvs.push(args.join(' '))
    const answer = options.cli?.(args) ?? fromFixtures(args)
    // A deny is how a call rejects beneath the plugin (a throwing hook is skipped).
    if ('throws' in answer) return { deny: answer.throws }
    return {
      value: {
        exitCode: answer.exitCode ?? 0,
        stdout: answer.stdout ?? '',
        stderr: answer.stderr ?? '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })

  /** A modmgr state value, its shape tag unwrapped. */
  const read = (key: string): unknown => {
    const held = state.get(`modmgr.${key}`)?.value
    return typeof held === 'object' && held !== null && 'shape' in held && 'value' in held
      ? held.value
      : held
  }

  return {
    clock,
    logs,
    argvs,
    read,
    /** What the plugin last wrote to `$.store` under `key`. */
    stored: (key: string): unknown => stored.get(key),
    registered: () => registered,
    reloads: () => reloads,
    opens,
    closes,
    focuses,
    copies,
    /** Each status line modmgr set (undefined clears it). */
    statuses,
    /** Each URL the detector fetched. */
    fetched,
    /** Opens the pane as the engine records it (what `$.ui.panes()` lists). */
    showPane: (focused = true) => {
      panes = [{ id: 'modmgr', title: 'mods', isShown: true, isFocused: focused, isPlaced: true }]
    },
  }
}

export const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const

/** The store's prefs of someone who has opened modmgr before. */
export const RETURNING = {
  v: 1,
  data: { tab: 'installed', sort: 'name', kind: 'mods', firstRunDone: true },
} as const

export const MODS = {
  command: 'mods',
  args: 'list',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
} as const
