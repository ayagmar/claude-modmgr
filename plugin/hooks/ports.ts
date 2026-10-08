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
  SessionRepo,
  SessionVersion,
  Timer,
  UiCopyResult,
  UiFocusResult,
  UiOpenResult,
  UiPane,
} from 'claude-code'
import type { ModmgrState, StateKey } from './domain/state.ts'
import type { PaneOpen } from './domain/view.ts'

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
  /** `CLAUDE_CONFIG_DIR` and `HOME`: where this session's mods folder is (Dev). */
  configDir(): Promise<string | undefined>
  home(): Promise<string | undefined>
}

export interface SessionPort {
  root(): Promise<string>
  cwd(): Promise<string>
  id(): Promise<string>
  /** The git repository the session runs in (its `origin` remote), or null. */
  repo(): Promise<SessionRepo | null>
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
  /** Opens modmgr's pane, or retitles it and sets its manners anew when open (F22). */
  open(args: PaneOpen): Promise<UiOpenResult>
  close(id: string): Promise<void>
  /** Moves the pane's focus ring onto an element it drew (rejects or denies when it can't). */
  focus(requestId: string, key: string): Promise<UiFocusResult>
  copy(text: string, surface?: RenderSurface): Promise<UiCopyResult>
  /** modmgr's one status line under the prompt; undefined clears it. */
  status(text: string | undefined): void
}

/** The network, through the host. Used only for the detector's raw.githubusercontent.com probes (PLAN §7). */
export interface HttpPort {
  /** A GET of `url`: its status and body (the whole body is read, F16's cousin: checked after). */
  get(url: string): Promise<{ readonly status: number; readonly text: string }>
}

/** The plugin's names of a directory's entries (`$.fs.list`). */
export type DirEntry = { readonly name: string; readonly kind: 'file' | 'dir' | 'other' }

/**
 * Reads plugin manifests and lists plugin folders: local catalogue sources
 * (Discover) and folders of mods under development (Dev). Never writes.
 */
export interface FsPort {
  /** A file's text; rejects when missing or over 4 MiB. */
  read(path: string): Promise<string>
  /** A directory's entries; rejects when it is missing. */
  list(path: string): Promise<readonly DirEntry[]>
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
  http: HttpPort
  fs: FsPort
}
