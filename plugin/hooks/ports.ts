// The ports services and views take in place of `$` (C2). Types only: every
// builder lives in register.tsx, the one file that spells `$` (F36). Each noun
// is its own interface, so a service asks for `Pick<Ports, 'process' | 'state'>`
// and a test fakes only those nouns.

import type {
  CommandInfo,
  ProcessRunResult,
  ProcessSpawnChunk,
  ProcessSpawnResult,
  RenderSurface,
  SessionVersion,
  Timer,
  UiPane,
} from 'claude-code'
import type { ModmgrState, StateKey } from './domain/state.ts'

export type { ModmgrState, StateKey }

/**
 * How a child runs. There is deliberately no `env`: children inherit the
 * session's environment untouched (C4: never strip `CLAUDECODE`).
 */
export type RunInit = { readonly cwd?: string; readonly timeoutMs?: number }

export interface ProcessPort {
  run(argv: readonly string[], init?: RunInit): Promise<ProcessRunResult>
  /** Streams a child; leaving the loop (or `return()`) kills it. */
  spawn(
    argv: readonly string[],
    init?: Pick<RunInit, 'cwd'>,
  ): AsyncGenerator<ProcessSpawnChunk, ProcessSpawnResult>
}

/** modmgr's own `$.state` keys, read and written through shaped atoms. */
export interface StatePort {
  read<K extends StateKey>(key: K): Promise<ModmgrState[K]>
  /** Compare-and-set with retry (`update` from claude-code): concurrent writers both land. */
  update<K extends StateKey>(
    key: K,
    change: (value: ModmgrState[K]) => ModmgrState[K],
  ): Promise<ModmgrState[K]>
}

export interface StorePort {
  get(key: string): Promise<unknown>
  /** Rejects past 4 MiB of JSON in all (F16). */
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  keys(): Promise<string[]>
}

export interface ClockPort {
  now(): Promise<number>
  after(ms: number, fn: () => void): Timer
  every(ms: number, fn: () => void): Timer
}

/** The variables modmgr reads, one method each (`$.env.get` takes literals only). */
export interface EnvPort {
  pluginDirs(): Promise<string | undefined>
  /** `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`: any non-empty value turns modmgr's network use off. */
  nonessentialTraffic(): Promise<string | undefined>
}

export interface SessionPort {
  root(): Promise<string>
  surfaces(): Promise<readonly RenderSurface[]>
  version(): Promise<SessionVersion>
}

export interface CommandPort {
  /**
   * Registers `/mods`. Spelled in register.tsx with a literal name, which keeps
   * the `/mods` hook "answering its own command" rather than a gate (C1).
   */
  registerMods(): Promise<void>
  /** `/reload-plugins`; rejects inside a hook the turn waits on (F29). Resolves the CLI's line. */
  reloadPlugins(): Promise<string | undefined>
  list(): Promise<readonly CommandInfo[]>
}

export interface UiPort {
  /** One line to the debug log (`--debug`), never the transcript. */
  debug(text: string): void
  panes(): Promise<readonly UiPane[]>
}

export type Ports = {
  process: ProcessPort
  state: StatePort
  store: StorePort
  clock: ClockPort
  env: EnvPort
  session: SessionPort
  command: CommandPort
  ui: UiPort
}
