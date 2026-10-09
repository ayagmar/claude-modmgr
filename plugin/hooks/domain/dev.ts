// Dev: which mods this session runs from a folder the
// person works in, how each is loaded, what its last validate and test said,
// what the session reported while hot-reloading it, and how to share it.
// services/dev.ts gathers the inputs; every decision lives here.

import type { DevHow, DevRow, Job, JobState, Origin } from '../../types/index.d.ts'
import type { InstalledEntry } from './cli-results.ts'
import { safeSegments } from './detector.ts'
import { isPluginName, splitPluginId } from './ids.ts'
import { isRecord, parseJson, str } from './json.ts'
import { originOf, rootOf, runningVersion } from './mods.ts'

/** A Dev row's Button key: what `ui.focus` and `ui.press` name. */
export const DEV_PREFIX = 'dev:'
export const devKey = (key: string): string => `${DEV_PREFIX}${key}`
export const devOfKey = (key: string | undefined): string | undefined =>
  key?.startsWith(DEV_PREFIX) === true ? key.slice(DEV_PREFIX.length) : undefined

/** The order Dev lists its sections in. */
export const DEV_SECTIONS: readonly DevHow[] = [
  'session-folder',
  'plugin-dir',
  'env-dir',
  'skills-dir',
  'folder-marketplace',
]

/** A row's few words for how it is loaded (from 60 columns). */
export const HOW_SHORT: Readonly<Record<DevHow, string>> = {
  'session-folder': 'session',
  'plugin-dir': '--plugin-dir',
  'env-dir': 'env dirs',
  'skills-dir': 'skills',
  'folder-marketplace': 'folder mkt',
}

/** How it is loaded, in the detail. */
export const SECTION_LABEL: Readonly<Record<DevHow, string>> = {
  'session-folder': "This session's mods folder",
  'plugin-dir': 'Loaded with --plugin-dir',
  'env-dir': 'From CLAUDE_CODE_PLUGIN_DIRS',
  'skills-dir': 'Your skills folder',
  'folder-marketplace': 'Folder marketplaces',
}

/** How an edit to its files reaches this session (every action says when it applies). */
export const appliesOf = (how: DevHow): string =>
  how === 'folder-marketplace'
    ? 'Its folder is read again at the next plugin reload (l).'
    : 'Saving a file there reloads it in this session.'

/** How to stop loading it, where the CLI can't; undefined when Installed toggles it. */
export const stopLoadingOf = (row: DevRow): string | undefined => {
  switch (row.how) {
    case 'session-folder':
      return 'It is loaded for this session only.'
    case 'plugin-dir':
      return 'To stop loading it, leave --plugin-dir out of your launch command.'
    case 'env-dir':
      return 'To stop loading it, take its folder out of CLAUDE_CODE_PLUGIN_DIRS and restart.'
    default:
      return undefined
  }
}

const DEV_ORIGINS: ReadonlyMap<Origin, DevHow> = new Map([
  ['env-dir', 'env-dir'],
  ['skills-dir', 'skills-dir'],
  ['folder-marketplace', 'folder-marketplace'],
])

/** A plugin the CLI lists, and whether validate found a hooks module (undefined: it couldn't read it). */
export type Listed = { readonly entry: InstalledEntry; readonly mod: boolean | undefined }

/** A plugin folder modmgr found, with what its manifest says. */
export type Found = { readonly name: string; readonly path: string; readonly version?: string }

export type DevSources = {
  readonly listed: readonly Listed[]
  /** The plugins that registered a command (`$.command.list()`), by name or id. */
  readonly commandPlugins: readonly string[]
  /** This session's mods folder's plugins. */
  readonly sessionFolder: readonly Found[]
  /** The folders found for plugins the CLI doesn't list (`--plugin-dir`), by name. */
  readonly located: ReadonlyMap<string, Found>
}

/** The name part of a plugin as a command names it (`modmgr`, `spawner@inline`). */
const bareName = (plugin: string): string => {
  const at = plugin.indexOf('@')
  return at < 0 ? plugin : plugin.slice(0, at)
}

/**
 * The plugins this session runs that the CLI doesn't list, whose folder to
 * look for: what `--plugin-dir` loaded (the flag isn't inherited by a
 * child). A plugin that registered a command, or one the session reported
 * failing. Built-in plugins register commands too (`cc-plugin-diff`, found
 * live), so a name becomes a row only once its folder is found.
 */
export const unlistedPlugins = (
  commandPlugins: readonly string[],
  known: ReadonlySet<string>,
): string[] =>
  [...new Set(commandPlugins.map(bareName))]
    .filter(name => isPluginName(name) && !known.has(name))
    .sort()

const byPlace = (a: DevRow, b: DevRow): number =>
  DEV_SECTIONS.indexOf(a.how) - DEV_SECTIONS.indexOf(b.how) ||
  a.name.localeCompare(b.name) ||
  a.key.localeCompare(b.key)

/**
 * Dev's rows, by section then name: listed plugins loaded from a folder the
 * person edits (not a plain plugin; one validate couldn't read stays, since a
 * broken mod is what Dev is for), this session's mods folder, and the
 * `--plugin-dir` plugins whose folder was found (`located`).
 */
export const devRowsOf = (sources: DevSources): DevRow[] => {
  const rows: DevRow[] = []
  const listedNames = new Set(sources.listed.map(({ entry }) => splitPluginId(entry.id).name))
  for (const { entry, mod } of sources.listed) {
    const how = DEV_ORIGINS.get(originOf(entry))
    const path = rootOf(entry)
    if (how === undefined || mod === false || path === undefined) continue
    const version = runningVersion(entry)
    rows.push({
      key: path,
      name: splitPluginId(entry.id).name,
      how,
      id: entry.id,
      path,
      enabled: entry.enabled,
      ...(version === undefined ? {} : { version }),
    })
  }
  // A plugin that registered a command is loaded (a session folder's may not be yet).
  const loaded = new Set(sources.commandPlugins.map(bareName))
  const sessionNames = new Set(sources.sessionFolder.map(found => found.name))
  for (const found of sources.sessionFolder) {
    // A folder the CLI lists under another heading is said once, there.
    if (rows.some(row => row.path === found.path)) continue
    rows.push({
      key: found.path,
      ...rowOfFound(found),
      how: 'session-folder',
      ...(loaded.has(found.name) ? { enabled: true } : {}),
    })
  }
  for (const [name, found] of sources.located) {
    if (listedNames.has(name) || sessionNames.has(name) || found.name !== name) continue
    if (rows.some(row => row.path === found.path)) continue
    rows.push({
      key: found.path,
      ...rowOfFound(found),
      how: 'plugin-dir',
      ...(loaded.has(name) ? { enabled: true } : {}),
    })
  }
  return rows.sort(byPlace)
}

const rowOfFound = (found: Found): Pick<DevRow, 'name' | 'path' | 'version'> => ({
  name: found.name,
  path: found.path,
  ...(found.version === undefined ? {} : { version: found.version }),
})

/** A `plugin.json`'s name and version, when it names a plugin. */
export const manifestOf = (text: string): { name: string; version?: string } | undefined => {
  const value = parseJson(text)
  if (!isRecord(value)) return undefined
  const name = str(value, 'name')
  if (name === undefined || !isPluginName(name)) return undefined
  const version = str(value, 'version')
  return version === undefined ? { name } : { name, version: version.slice(0, 64) }
}

/**
 * The folder a `marketplace.json` gives plugin `name`, relative to the
 * marketplace's root (`''` for the root itself); undefined when it doesn't
 * list it, or lists it at a path that is absolute or climbs.
 */
export const marketplaceFolderOf = (text: string, name: string): string | undefined => {
  const value = parseJson(text)
  if (!isRecord(value) || !Array.isArray(value.plugins)) return undefined
  const entry = value.plugins.find(plugin => isRecord(plugin) && plugin.name === name)
  if (!isRecord(entry) || typeof entry.source !== 'string') return undefined
  const segments = safeSegments(entry.source)
  return segments?.map(decodeURIComponent).join('/')
}

/** `a/b` joined under `root`, or `root` itself for `''`. */
export const joinPath = (root: string, relative: string): string => {
  const head = root.replace(/\/+$/, '')
  return relative === '' ? head : `${head}/${relative}`
}

const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/

/** A session id that is one plain path segment. */
export const isSessionId = (value: string): boolean => SESSION_ID.test(value)

/**
 * This session's mods folder: `<config dir>/dev-mods/<session id>`, the config
 * dir being `CLAUDE_CONFIG_DIR` or `~/.claude`. Undefined when neither is an
 * absolute path or the session id isn't one plain segment.
 */
export const sessionFolderOf = (how: {
  readonly configDir: string | undefined
  readonly home: string | undefined
  readonly sessionId: string
}): string | undefined => {
  if (!SESSION_ID.test(how.sessionId)) return undefined
  const config = configDirOf(how.configDir, how.home)
  return config === undefined ? undefined : joinPath(config, `dev-mods/${how.sessionId}`)
}

/** Claude Code's config dir: `CLAUDE_CONFIG_DIR`, else `~/.claude`; undefined unless absolute. */
export const configDirOf = (
  configDir: string | undefined,
  home: string | undefined,
): string | undefined => {
  const config =
    configDir !== undefined && configDir !== ''
      ? configDir
      : home === undefined
        ? undefined
        : joinPath(home, '.claude')
  return config?.startsWith('/') === true ? config : undefined
}

/** The row Dev shows as selected and acts on: the selection when listed, else the first. */
export const devRowOf = (
  selected: string | undefined,
  rows: readonly DevRow[],
): DevRow | undefined => rows.find(row => row.key === selected) ?? rows[0]

/**
 * The selection once rows change: the row shown selected before, while it is
 * still listed, so a row that joins at the top (a failing folder) never takes
 * the selection from under the focus ring (found live).
 */
export const keptSelection = (
  selected: string | undefined,
  before: readonly DevRow[],
  after: readonly DevRow[],
): string | undefined => {
  const shown = devRowOf(selected, before)?.key
  return after.some(row => row.key === shown) ? shown : after[0]?.key
}

// ---- what ran ----------------------------------------------------------------

export type DevRunKind = 'validate' | 'test'

/** The newest validate or test of `path` in the queue. */
export const lastRun = (jobs: readonly Job[], kind: DevRunKind, path: string): Job | undefined =>
  jobs.findLast(job => job.kind === kind && job.args?.path === path)

export type RunMark = { readonly text: string; readonly tone: 'busy' | 'ok' | 'bad' | 'muted' }

const BUSY: ReadonlySet<JobState> = new Set(['queued', 'running'])

/** A row's short mark for its last validate: `✓`, `✓ 2 warnings`, `✗ 3`, `…`, or nothing yet. */
export const validateMark = (job: Job | undefined): RunMark | undefined => {
  if (job === undefined) return undefined
  if (BUSY.has(job.state)) return { text: 'validating…', tone: 'busy' }
  const report = job.report
  if (job.state === 'ok') {
    const warnings = report?.warnings ?? 0
    return warnings === 0
      ? { text: '✓ valid', tone: 'ok' }
      : { text: `✓ ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`, tone: 'ok' }
  }
  if (job.state === 'failed' && report !== undefined) {
    return { text: `✗ ${report.errors} ${report.errors === 1 ? 'error' : 'errors'}`, tone: 'bad' }
  }
  return job.state === 'failed'
    ? { text: '✗ validate failed', tone: 'bad' }
    : { text: `validate ${job.state}`, tone: 'muted' }
}

/** A row's short mark for its last test run. */
export const testMark = (job: Job | undefined): RunMark | undefined => {
  if (job === undefined) return undefined
  if (BUSY.has(job.state)) return { text: 'testing…', tone: 'busy' }
  if (job.state === 'ok') return { text: '✓ tests', tone: 'ok' }
  if (job.state === 'failed') return { text: '✗ tests', tone: 'bad' }
  return { text: `tests ${job.state}`, tone: 'muted' }
}

// ---- sharing (the engine's reference, §Sharing a mod) --------------------------

/** `owner/repo` of a GitHub remote (https, ssh or scp form), or undefined. */
export const githubRepoOf = (remote: string | null | undefined): string | undefined => {
  if (remote === null || remote === undefined) return undefined
  const match =
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(
      remote.trim(),
    )
  const owner = match?.[1]
  const repo = match?.[2]
  return owner === undefined || repo === undefined ? undefined : `${owner}/${repo}`
}

/** Whether `path` is `root` or inside it. */
export const isInside = (path: string, root: string): boolean => {
  const head = root.replace(/\/+$/, '')
  return path === head || path.startsWith(`${head}/`)
}

export type Share = {
  /** What another person types: `/plugin install <mod> --marketplace <owner>/<repo>`. */
  readonly line: string
  /** Whether `line` names a real repository (else `<owner>/<repo>` stands in it). */
  readonly complete: boolean
  /** The marketplace file to write beside `plugin.json`, when none lists the mod. */
  readonly snippet?: string
  readonly notes: readonly string[]
}

/**
 * How to share a dev mod: the one install line, and what is missing for it to
 * work (a marketplace file listing the mod, a GitHub repository, a folder kept
 * outside this session's mods folder).
 */
export const shareOf = (
  row: Pick<DevRow, 'name' | 'how'>,
  how: {
    readonly repo: string | undefined
    readonly listed: boolean
    /** The mod's folder relative to the repository's root (`./`, `./plugin`). */
    readonly source: string
  },
): Share => {
  const repo = how.repo ?? '<owner>/<repo>'
  const notes: string[] = []
  if (row.how === 'session-folder') {
    notes.push(
      "Copy it out of this session's mods folder to a folder you keep, and make that the repository.",
    )
  }
  if (how.repo === undefined) {
    notes.push('Push its folder to a GitHub repository; <owner>/<repo> is that repository.')
  }
  const snippet = how.listed
    ? undefined
    : JSON.stringify(
        {
          name: row.name,
          owner: { name: '<your name>' },
          plugins: [{ name: row.name, source: how.source }],
        },
        null,
        2,
      )
  if (snippet !== undefined) {
    notes.push(
      how.source === './'
        ? 'Write this as .claude-plugin/marketplace.json beside its plugin.json:'
        : "Write this as .claude-plugin/marketplace.json at the repository's root:",
    )
  }
  return {
    line: `/plugin install ${row.name} --marketplace ${repo}`,
    complete: how.repo !== undefined,
    ...(snippet === undefined ? {} : { snippet }),
    notes,
  }
}
