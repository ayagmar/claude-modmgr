// Fake ports for service tests (C2): each noun in memory, with the knobs a
// test needs (a clock that moves only when told, a store with the engine's
// 4 MiB limit, a scripted CLI). Shapes follow plugin/hooks/ports.ts.

import type {
  CommandInfo,
  ProcessRunResult,
  ProcessSpawnChunk,
  ProcessSpawnResult,
  RenderSurface,
  SessionVersion,
  Timer,
  UiCopyResult,
  UiFocusResult,
  UiOpenResult,
  UiPane,
} from 'claude-code'
import { INITIAL, type ModmgrState, type StateKey } from '../../plugin/hooks/domain/state.ts'
import type { PaneOpen } from '../../plugin/hooks/domain/view.ts'
import type {
  ClockPort,
  CommandPort,
  EnvPort,
  Ports,
  ProcessPort,
  RunInit,
  SessionPort,
  StatePort,
  StorePort,
  UiPort,
} from '../../plugin/hooks/ports.ts'

/** Lets every pending promise chain run (several macrotask turns). */
export const settle = async (turns = 5): Promise<void> => {
  for (let i = 0; i < turns; i += 1) await new Promise(resolve => setTimeout(resolve, 0))
}

// ---- clock -----------------------------------------------------------------

type Pending = { id: number; due: number; fn: () => void; every?: number }

export class FakeClock implements ClockPort {
  time: number
  private timers: Pending[] = []
  private seq = 0

  constructor(start = 1_000_000) {
    this.time = start
  }

  now = async (): Promise<number> => this.time

  after = (ms: number, fn: () => void): Timer => this.add(ms, fn)

  every = (ms: number, fn: () => void): Timer => this.add(ms, fn, Math.max(1, ms))

  private add(ms: number, fn: () => void, every?: number): Timer {
    this.seq += 1
    const timer: Pending = { id: this.seq, due: this.time + Math.max(0, ms), fn }
    if (every !== undefined) timer.every = every
    this.timers.push(timer)
    return { cancel: () => this.cancel(timer.id) }
  }

  private cancel(id: number): void {
    this.timers = this.timers.filter(timer => timer.id !== id)
  }

  /** Resolves when the clock reaches `time` (a fake child's run time). */
  sleepUntil(time: number): Promise<void> {
    return new Promise(resolve => {
      this.after(time - this.time, resolve)
    })
  }

  get pending(): number {
    return this.timers.length
  }

  /** Moves time on, firing each due timer in order and letting its work settle. */
  async advance(ms: number): Promise<void> {
    const end = this.time + ms
    for (;;) {
      await settle()
      const due = this.timers
        .filter(timer => timer.due <= end)
        .sort((a, b) => a.due - b.due || a.id - b.id)[0]
      if (due === undefined) break
      this.time = Math.max(this.time, due.due)
      if (due.every === undefined) this.cancel(due.id)
      else due.due += due.every
      due.fn()
    }
    this.time = end
    await settle()
  }
}

// ---- state -----------------------------------------------------------------

export class FakeState implements StatePort {
  values: ModmgrState = structuredClone(INITIAL) as ModmgrState
  writes: StateKey[] = []
  /** Set to make every write reject (a host refusing `state.set`). */
  failWrites = false

  read = async <K extends StateKey>(key: K): Promise<ModmgrState[K]> =>
    structuredClone(this.values[key])

  update = async <K extends StateKey>(
    key: K,
    change: (value: ModmgrState[K]) => ModmgrState[K],
  ): Promise<ModmgrState[K]> => {
    if (this.failWrites) throw new Error('state.set refused')
    const next = change(structuredClone(this.values[key]))
    this.values = { ...this.values, [key]: structuredClone(next) }
    this.writes.push(key)
    return structuredClone(next)
  }
}

// ---- store -----------------------------------------------------------------

export class FakeStore implements StorePort {
  data = new Map<string, unknown>()
  sets: string[] = []
  /** The engine's limit (F16). */
  limit = 4 * 1024 * 1024
  failGets = false

  constructor(entries: Record<string, unknown> = {}) {
    for (const [key, value] of Object.entries(entries)) this.data.set(key, value)
  }

  bytes(): number {
    let total = 0
    for (const value of this.data.values()) total += JSON.stringify(value).length
    return total
  }

  get = async (key: string): Promise<unknown> => {
    if (this.failGets) throw new Error('store unreadable')
    const value = this.data.get(key)
    return value === undefined ? undefined : structuredClone(value)
  }

  set = async (key: string, value: unknown): Promise<void> => {
    const before = this.data.get(key)
    this.data.set(key, JSON.parse(JSON.stringify(value)))
    if (this.bytes() > this.limit) {
      if (before === undefined) this.data.delete(key)
      else this.data.set(key, before)
      throw new Error('store over 4 MiB')
    }
    this.sets.push(key)
  }

  delete = async (key: string): Promise<void> => {
    this.data.delete(key)
  }

  keys = async (): Promise<string[]> => [...this.data.keys()]
}

// ---- process: a scripted CLI -------------------------------------------------

export type Call = { argv: readonly string[]; init?: RunInit }

/** What one call answers: a result, a thrown error, or a wait first. */
export type Answer =
  | Partial<ProcessRunResult>
  | { throws: string; afterMs?: number }
  | { hang: true }

export type Handler = (argv: readonly string[], call: Call) => Answer | undefined

export const out = (stdout: string, exitCode = 0, stderr = ''): Partial<ProcessRunResult> => ({
  stdout,
  exitCode,
  stderr,
})

export type SpawnScript = {
  chunks: Array<ProcessSpawnChunk | { waitMs: number }>
  result?: ProcessSpawnResult
  throws?: string
}

export class FakeProcess implements ProcessPort {
  calls: Call[] = []
  spawns: Call[] = []
  handlers: Handler[] = []
  spawnScript: SpawnScript = { chunks: [], result: { code: 0, signal: null } }
  killed = 0

  constructor(private clock: FakeClock) {}

  /** Adds a handler; later handlers win. */
  on(handler: Handler): this {
    this.handlers.unshift(handler)
    return this
  }

  /** Answers argv that starts with `prefix` (after `claude plugin`, or `claude` for --version). */
  when(prefix: readonly string[], answer: Answer | ((argv: readonly string[]) => Answer)): this {
    return this.on(argv => {
      const rest = argv[1] === 'plugin' ? argv.slice(2) : argv.slice(1)
      return prefix.every((part, index) => rest[index] === part)
        ? typeof answer === 'function'
          ? answer(argv)
          : answer
        : undefined
    })
  }

  run = async (argv: readonly string[], init?: RunInit): Promise<ProcessRunResult> => {
    const call: Call = init === undefined ? { argv } : { argv, init }
    this.calls.push(call)
    const answer = this.handlers.map(handler => handler(argv, call)).find(a => a !== undefined)
    if (answer === undefined) throw new Error(`fake CLI: no answer for ${argv.join(' ')}`)
    if ('hang' in answer) {
      await this.clock.sleepUntil(this.clock.time + (init?.timeoutMs ?? 30_000))
      throw new Error('process.run: the command was still running at its timeout and was killed')
    }
    if ('throws' in answer) {
      if (answer.afterMs !== undefined)
        await this.clock.sleepUntil(this.clock.time + answer.afterMs)
      throw new Error(answer.throws)
    }
    return {
      exitCode: 0,
      stdout: '',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
      ...answer,
    }
  }

  spawn = (
    argv: readonly string[],
    init?: Pick<RunInit, 'cwd'>,
  ): AsyncGenerator<ProcessSpawnChunk, ProcessSpawnResult> => {
    this.spawns.push(init === undefined ? { argv } : { argv, init })
    const script = this.spawnScript
    const clock = this.clock
    const onKill = () => {
      this.killed += 1
    }
    const gen = async function* (): AsyncGenerator<ProcessSpawnChunk, ProcessSpawnResult> {
      if (script.throws !== undefined) throw new Error(script.throws)
      try {
        for (const chunk of script.chunks) {
          if ('waitMs' in chunk) await clock.sleepUntil(clock.time + chunk.waitMs)
          else yield chunk
        }
        return script.result ?? { code: 0, signal: null }
      } finally {
        onKill()
      }
    }
    return gen()
  }
}

// ---- the rest ----------------------------------------------------------------

export class FakeCommand implements CommandPort {
  registered = 0
  reloads = 0
  reloadAnswer: () => Promise<string | undefined> = async () => 'Reloaded: 1 plugin'
  commands: CommandInfo[] = []

  registerMods = async (): Promise<void> => {
    this.registered += 1
  }

  reloadPlugins = (): Promise<string | undefined> => {
    this.reloads += 1
    return this.reloadAnswer()
  }

  list = async (): Promise<readonly CommandInfo[]> => this.commands
}

export const fakeEnv = (vars: Record<string, string> = {}): EnvPort => ({
  pluginDirs: async () => vars.CLAUDE_CODE_PLUGIN_DIRS,
  nonessentialTraffic: async () => vars.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC,
})

export const fakeSession = (
  root: string | (() => Promise<string>) = '/repo',
  surfaces: RenderSurface[] = ['terminal'],
): SessionPort => ({
  root: typeof root === 'string' ? async () => root : root,
  surfaces: async () => surfaces,
  version: async (): Promise<SessionVersion> => ({ version: '2.1.292', base: '2.1.292' }),
})

export class FakeUi implements UiPort {
  lines: string[] = []
  shown: UiPane[] = []
  opens: PaneOpen[] = []
  closes: string[] = []
  focuses: string[] = []
  copies: string[] = []
  /** Whether an open is placed (false: a session that places no panes). */
  placed = true
  /** Whether the person holds the pane's keys (the Esc cascade reads it). */
  focused = true
  copyFails?: 'no-clipboard' | 'no-surface' | 'refused'

  debug = (text: string): void => {
    this.lines.push(text)
  }

  panes = async (): Promise<readonly UiPane[]> => this.shown

  open = async (args: PaneOpen): Promise<UiOpenResult> => {
    this.opens.push(args)
    if (!this.placed) return { isPlaced: false, reason: 'no surface places panes' }
    const pane: UiPane = {
      id: args.id,
      title: args.title,
      isShown: true,
      isFocused: this.focused,
      isPlaced: true,
    }
    this.shown = [...this.shown.filter(item => item.id !== args.id), pane]
    return { isPlaced: true }
  }

  close = async (id: string): Promise<void> => {
    this.closes.push(id)
    this.shown = this.shown.filter(pane => pane.id !== id)
  }

  /** Element keys `focus` denies (not drawn); the rest move. */
  undrawn = new Set<string>()

  focus = async (requestId: string, key: string): Promise<UiFocusResult> => {
    this.focuses.push(`${requestId}:${key}`)
    return this.undrawn.has(key) ? { deny: 'not drawn' } : {}
  }

  /** Esc hands the keys back to the prompt before `ui.close` reaches the plugin (F45). */
  keysToPrompt(): void {
    this.shown = this.shown.map(pane => ({ ...pane, isFocused: false }))
  }

  copy = async (text: string): Promise<UiCopyResult> => {
    this.copies.push(text)
    return this.copyFails === undefined
      ? { isCopied: true }
      : { isCopied: false, reason: this.copyFails }
  }
}

export type World = {
  ports: Ports
  clock: FakeClock
  state: FakeState
  store: FakeStore
  process: FakeProcess
  command: FakeCommand
  ui: FakeUi
}

export const world = (
  options: { env?: Record<string, string>; store?: Record<string, unknown>; root?: string } = {},
): World => {
  const clock = new FakeClock()
  const state = new FakeState()
  const store = new FakeStore(options.store)
  const process = new FakeProcess(clock)
  const command = new FakeCommand()
  const ui = new FakeUi()
  return {
    clock,
    state,
    store,
    process,
    command,
    ui,
    ports: {
      process,
      state,
      store,
      clock,
      env: fakeEnv(options.env),
      session: fakeSession(options.root),
      command,
      ui,
    },
  }
}
