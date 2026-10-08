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
  /** Notable capabilities its last update added, until its detail is opened (PLAN §2.2). */
  capsNew?: CapsNew
}

/** What a version change added to a mod's notable list, and the version it came from. */
export type CapsNew = { since: string; added: string[] }

export type ModDetail = ModRow & {
  description?: string
  root?: string
  caps?: Capabilities
  mixedCounts?: { skills: number; agents: number; mcp: number }
  tokens?: number
  dataBytes?: number
  validate?: { errors: number; warnings: number; at: number }
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
  version?: string
  /** Where it comes from, in a few words. */
  source: string
  /** What it can do, when modmgr read it before installing (a local source); notable ids. */
  notable?: string[]
  /** Its files are on disk (a folder in its marketplace): modmgr can read it before installing. */
  local?: boolean
  /** A local entry modmgr couldn't read: why (`r` tries again). */
  unread?: string
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
  /** It succeeded without changing anything (already so, already up to date): no reload owed. */
  unchanged?: boolean
  /** A remove: whether the CLI said it kept the mod's data folder (`keptData`), when it said. */
  keptData?: boolean
  /**
   * An install or update stopped on a marketplace-declared command (F25): what
   * the CLI showed, for the review that accepts it. Untrusted text.
   */
  shown?: {
    kind: 'command_source' | 'entry_helper'
    command: string
    sha256: string
    /** The command was longer than modmgr keeps: it can't be shown whole, so not accepted here. */
    truncated?: boolean
  }
}

export type Tab = 'installed' | 'discover' | 'dev' | 'health'
export type Overlay = 'detail' | 'review' | 'help' | 'jobs' | 'marketplace'

export type View = {
  tab: Tab
  selected?: PluginId
  stack: Overlay[]
  /** Installed's filter. */
  query: string
  /** Discover's search, its kind filter and sort. */
  search: string
  kind: 'mods' | 'hooks' | 'all'
  sort: 'installs' | 'name' | 'marketplace'
  /** The catalogue entry Discover has selected. */
  found?: PluginId
  /** Staged toggles: what each mod will be after apply. */
  staged: Record<PluginId, boolean>
  /** One short line the pane shows until the next action (a copy, a refused focus). */
  notice?: string
}

/** What a review would do to one mod. */
export type ReviewOp = 'enable' | 'disable' | 'install' | 'remove' | 'update'

export type ReviewTarget = {
  id: PluginId
  op: ReviewOp
  scope?: Scope
  /** The version it is at now (an update's "from"). */
  version?: string
  /** A reinstall (undo of a remove): whether that remove kept the mod's data. */
  keptData?: boolean
}

/**
 * One confirm at a time (a plain value, R19). Every action that runs new code
 * or removes something passes through one (PLAN §5.1).
 */
export type ReviewRequest = {
  action: 'toggle' | 'update' | 'remove' | 'undo' | 'install' | 'marketplace'
  targets: ReviewTarget[]
  /** Notable capabilities of what turns on or comes back, as lines. */
  notable: string[]
  declaredCommand?: { text: string; sha256: string; truncated?: boolean }
  headersHelper?: { text: string; sha256: string; truncated?: boolean }
  changesRepoFile: boolean
  /** The other parts of what turns off or is removed: skills, agents, MCP servers. */
  parts?: { skills: number; agents: number; mcp: number }
  /** An update refreshes these marketplaces first. */
  marketplaces?: string[]
  /** A remove keeps the mod's data folder (the default), so undo restores it as it was. */
  keepData?: boolean
  /** A remove: the size of the mod's data folder, when it has one. */
  dataBytes?: number
  /** An undo: the batch it undoes; confirm queues it only while that is still the batch to undo. */
  undoes?: string
  /** An install: modmgr couldn't see what it can do before it's installed (a remote source). */
  uninspected?: boolean
  /** An install of a local entry modmgr tried to read and couldn't: why. */
  unreadable?: string
  /** A marketplace to add (`claude plugin marketplace add <source>`). */
  source?: string
}

export type Attention = {
  updates: number
  problems: number
  reloadPending: boolean
  capsChanged: number
  /** The band line the person dismissed; the band returns once its line changes. */
  dismissed?: string
  /** The CLI's answer to the last reload ("Reloaded: …"), echoed in the band for a while (C8). */
  lastReload?: string
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

/**
 * The part of the catalogue Discover draws (R11): at most a window of rows
 * around the selection, `offset` the first one's place among the `matched`.
 */
export type CatalogPage = {
  rows: CatalogRow[]
  total: number
  matched: number
  offset: number
  loading: boolean
  error?: string
}
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
