// modmgr's state contract (PLAN §4). Session-scoped values in `$.state`
// that drive rendering and survive `/reload-plugins`. Every key is `Shaped`:
// its atom names a tag (`'queue/1'`), so a modmgr update that changes a
// value's type reads the old value as absent instead of misreading it (C3).

export type PluginId = string
export type Scope = 'user' | 'project' | 'local' | 'managed'
export type Origin =
  | 'marketplace'
  | 'skills-dir'
  | 'folder-marketplace'
  | 'plugin-dir'
  | 'env-dir'
  | 'dev-session'
export type Reach = 'machine' | 'network' | 'session' | 'model' | 'tools' | 'plugins' | 'display'
export type Capabilities = {
  events: string[]
  calls: string[]
  envReads: string[]
  reach: Reach[]
  notable: string[]
}

export type ModRow = {
  id: PluginId
  name: string
  version?: string
  origin: Origin
  scope?: Scope
  enabled: boolean
  projectEnabled?: boolean
  toggleable: boolean
  notableCount: number
  updateTo?: string
  problems: number
  mixed: boolean
}

export type ModDetail = ModRow & {
  description?: string
  root?: string
  caps?: Capabilities
  mixedCounts?: { skills: number; agents: number; mcp: number }
  tokens?: number
  dataBytes?: number
  validate?: { errors: number; warnings: number; at: number }
  capsAdded?: string[]
  dev?: { failures: number; lastReason?: string; lastAt?: number; test?: 'pass' | 'fail' }
}

export type CatalogKind = 'mod' | 'hooks' | 'plain' | 'unknown'

export type CatalogRow = {
  id: PluginId
  name: string
  marketplace: string
  installs?: number
  kind: CatalogKind
  blurb: string
}

export type JobKind =
  | 'install'
  | 'update'
  | 'remove'
  | 'enable'
  | 'disable'
  | 'validate'
  | 'test'
  | 'reload'
  | 'marketplace-add'
  | 'marketplace-update'

export type JobState = 'queued' | 'running' | 'ok' | 'failed' | 'cancelled' | 'interrupted'

export type Job = {
  id: string
  batch?: string
  kind: JobKind
  target?: PluginId
  args?: { scope?: Scope; acceptSha?: string; path?: string; source?: string; keepData?: boolean }
  state: JobState
  startedAt?: number
  endedAt?: number
  tail: string[]
  error?: { kind: string; message: string }
}

export type Tab = 'installed' | 'discover' | 'dev' | 'health'
export type Overlay = 'detail' | 'review' | 'help' | 'jobs'

export type View = {
  tab: Tab
  selected?: PluginId
  layout: 'stacked' | 'split'
  stack: Overlay[]
  query: string
  kind: 'mods' | 'hooks' | 'all'
  sort: 'installs' | 'name' | 'marketplace'
  page: number
  staged: Record<PluginId, boolean>
}

/** One confirm at a time (a plain value, R19). */
export type ReviewRequest = {
  action: 'install' | 'remove' | 'toggle' | 'update'
  targets: Array<{ id: PluginId; scope?: Scope; enable?: boolean }>
  notable: string[]
  declaredCommand?: { text: string; sha256: string }
  headersHelper?: { text: string; sha256: string }
  changesRepoFile: boolean
  alsoDisables?: { skills: number; agents: number; mcp: number }
}

export type Attention = {
  updates: number
  problems: number
  reloadPending: boolean
  capsChanged: number
  dismissedAt?: number
}

export type Degraded = {
  process: boolean
  network: boolean
  /** Set after Claude Code refused a declared-command acceptance from this session (C4, C8). */
  acceptCommand: boolean
  reason?: string
}

/**
 * The job queue and the module that drives it. A module takes the queue over
 * at `session.start` (setting `owner`); a runner whose owner was replaced stops
 * claiming jobs, so an old module's in-flight work never races the new one (F39).
 */
export type JobQueue = { owner: string; jobs: Job[] }

/** The installed list's refresh, for the title's stale marker (C8). */
export type Sync = {
  refreshing: boolean
  at?: number
  error?: { kind: string; message: string }
  /** `list --json` entries modmgr could not read. */
  skipped: number
}

export type CatalogPage = { rows: CatalogRow[]; total: number; matched: number; loading: boolean }
export type DetectProgress = { checked: number; total: number; found: number; running: boolean }

declare module 'claude-code' {
  interface PluginState {
    modmgr: {
      mods: Shaped<ModRow[]>
      detail: Shaped<ModDetail | null>
      catalogPage: Shaped<CatalogPage>
      detect: Shaped<DetectProgress>
      queue: Shaped<JobQueue>
      sync: Shaped<Sync>
      view: Shaped<View>
      review: Shaped<ReviewRequest | null>
      attention: Shaped<Attention>
      degraded: Shaped<Degraded>
    }
  }
}
