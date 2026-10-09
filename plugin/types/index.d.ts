// modmgr's state contract. Session-scoped values in `$.state`
// that drive rendering and survive `/reload-plugins`. Every key is `Shaped`:
// its atom names a tag (`'queue/1'`), so a modmgr update that changes a
// value's type reads the old value as absent instead of misreading it.

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
  /** Notable capabilities its last update added, until its detail is opened. */
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
  /** The selected row's whole description, when its list line (`blurb`) cut it short. */
  about?: string
  /** A community mod's GitHub stars. */
  stars?: number
  /** A community mod: from a repository none of the person's marketplaces lists. */
  community?: CommunityFacts
}

/** Where a community mod lives, what validate said of it, and how it installs. */
export type CommunityFacts = {
  /** `owner/repo`. */
  repo: string
  /** Its folder in the repository; empty at the root. */
  path: string
  /** The commit the community index validated. */
  commit: string
  check: 'passed' | 'warnings' | 'failed'
  /** `<plugin>@<marketplace>` when the marketplace at its repository's root lists it. */
  installId?: string
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
  /** A validate: what it found (the tail lists them). */
  report?: { errors: number; warnings: number }
  /** A remove: whether the CLI said it kept the mod's data folder (`keptData`), when it said. */
  keptData?: boolean
  /**
   * An install or update stopped on a marketplace-declared command: what
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
export type Overlay = 'detail' | 'review' | 'help' | 'jobs' | 'marketplace' | 'share' | 'welcome'

export type View = {
  tab: Tab
  selected?: PluginId
  stack: Overlay[]
  /** Installed's filter. */
  query: string
  /** Discover's search and sort. */
  search: string
  sort: 'installs' | 'stars' | 'name' | 'marketplace'
  /** Discover lists only the entries of the person's own marketplaces. */
  mine?: boolean
  /** The catalogue entry Discover has selected. */
  found?: PluginId
  /** The dev mod Dev has selected (its `DevRow.key`). */
  dev?: string
  /** The item Health has selected (its key). */
  health?: string
  /** Staged toggles: what each mod will be after apply. */
  staged: Record<PluginId, boolean>
  /** One short line the pane shows until the next action (a copy, a refused focus). */
  notice?: string
  /** The dock's columns `/mods` asked for, which every later open asks again. */
  dock?: number
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
 * One confirm at a time (a plain value). Every action that runs new code
 * or removes something passes through one.
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
  /**
   * A marketplace to add (`claude plugin marketplace add <source>`), or, for an
   * install, the one it installs from and adds first (`--marketplace <source>`).
   */
  source?: string
  /** An install of a community mod: what it can do is what the community index read at this commit. */
  indexedAt?: string
}

export type Attention = {
  updates: number
  problems: number
  reloadPending: boolean
  /** The session refused modmgr's reload (the desktop app's): the person runs /reload-plugins. */
  reloadByHand?: boolean
  capsChanged: number
  /** The band line the person dismissed; the band returns once its line changes. */
  dismissed?: string
  /** The CLI's answer to the last reload ("Reloaded: …"), echoed in the band for a while. */
  lastReload?: string
}

export type Degraded = {
  process: boolean
  network: boolean
  /** Set after Claude Code refused a declared-command acceptance from this session. */
  acceptCommand: boolean
  reason?: string
}

/**
 * The job queue and the module that drives it. A module takes the queue over
 * at `session.start` (setting `owner`); a runner whose owner was replaced stops
 * claiming jobs, so an old module's in-flight work never races the new one.
 */
export type JobQueue = { owner: string; jobs: Job[] }

/** The installed list's refresh, for the title's stale marker. */
export type Sync = {
  refreshing: boolean
  at?: number
  error?: { kind: string; message: string }
  /** `list --json` entries modmgr could not read. */
  skipped: number
}

/**
 * The part of the catalogue Discover draws (never all of it): at most a window of rows
 * around the selection, `offset` the first one's place among the `matched`.
 */
export type CatalogPage = {
  rows: CatalogRow[]
  total: number
  /** Of `total`, the community index's mods (all of them mods). */
  community: number
  matched: number
  offset: number
  loading: boolean
  error?: string
}
export type DetectProgress = {
  checked: number
  total: number
  found: number
  running: boolean
  /** When the hosted index whose kinds were taken was built (ms); absent when none was read. */
  indexAt?: number
}

/**
 * How a mod under development is loaded: from this
 * session's mods folder, a `--plugin-dir` (found through its commands), a
 * `CLAUDE_CODE_PLUGIN_DIRS` folder, the skills folder, or a folder marketplace.
 */
export type DevHow =
  | 'session-folder'
  | 'plugin-dir'
  | 'env-dir'
  | 'skills-dir'
  | 'folder-marketplace'

export type DevRow = {
  /** Stable: its folder. */
  key: string
  name: string
  how: DevHow
  /** Its plugin id when the CLI lists it (`name@inline`, `name@skills-dir`, `name@<marketplace>`). */
  id?: PluginId
  /** Its folder, absolute. */
  path: string
  version?: string
  enabled?: boolean
}

/** How to share a dev mod (`p`), for the share overlay. */
export type DevShare = {
  /** The row it is for. */
  key: string
  name: string
  /** `/plugin install <mod> --marketplace <owner>/<repo>`. */
  line: string
  /** `line` names a real repository. */
  complete: boolean
  /** The marketplace file to write, when none lists the mod. */
  snippet?: string
  notes: string[]
}

export type DevState = {
  rows: DevRow[]
  loading: boolean
  at?: number
  share?: DevShare
}

/** A note that two or more enabled mods hook an event whose order decides the result. */
export type ChainNoteRow = { event: string; text: string }

/**
 * What Health shows beyond the other keys, gathered when it is
 * opened or refreshed: notes on hook order, the last hook failures the debug
 * log names, the detector's budget, the store's size, the update checks.
 */
export type HealthFacts = {
  at?: number
  chain: ChainNoteRow[]
  /** By plugin name: the last `hook failed closed` line's event and error kind. */
  logged: Record<string, string>
  /**
   * This session's debug log (`--debug`, `<config>/debug/<session id>.txt`):
   * none, read, or too large to read here (over 4 MiB), with its path.
   */
  debugLog: { state: 'none' | 'read' | 'too-big'; path?: string }
  detector: { spent: number; budget: number; remote: boolean; why?: string }
  cache: { bytes: number; full: boolean }
  updates: { at?: number; every: number; off?: string }
}

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
      dev: Shaped<DevState>
      health: Shaped<HealthFacts>
    }
  }
}
