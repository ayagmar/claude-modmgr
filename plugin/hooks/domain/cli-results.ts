// Parses every `claude plugin … --json` answer modmgr reads (F8, F10, F25–F27,
// F33, F34) into typed values. Shapes come from real captures in
// test/domain/fixtures/cli-runs.ts. Unknown fields are ignored; an entry that
// fails its shape check is skipped and counted, never fatal (PLAN §11).

import {
  type AbsolutePath,
  type PluginId,
  parseAbsolutePath,
  parsePluginId,
  parseSha256,
  SCOPES,
  type Scope,
  type Sha256,
} from './ids.ts'
import { arr, bool, compact, isRecord, type JsonRecord, num, parseJson, rec, str } from './json.ts'
import { fail, ok, type Result } from './result.ts'
import { sanitize } from './sanitize.ts'

/** What a service hands in: one finished `claude plugin …` process. */
export type CliRun = { readonly exitCode: number; readonly stdout: string; readonly stderr: string }

/** `scope: "session"` marks a `CLAUDE_CODE_PLUGIN_DIRS` folder (`<name>@inline`, F34). */
export type InstalledScope = Scope | 'session'

export type InstalledEntry = {
  readonly id: PluginId
  readonly version?: string
  readonly scope: InstalledScope
  readonly enabled: boolean
  readonly installPath?: AbsolutePath
  /** Folder-marketplace plugins are read from this folder (F10). */
  readonly readFromFolder?: AbsolutePath
  readonly folderVersion?: string
  readonly installedAt?: string
  readonly lastUpdated?: string
  readonly projectEnabled?: boolean
  readonly projectPath?: AbsolutePath
  /** From `--data-size`, present only when the data folder exists (F33). */
  readonly dataBytes?: number
}

export type CatalogSource =
  | { readonly kind: 'relative'; readonly path: string }
  | { readonly kind: 'url'; readonly url: string; readonly sha?: string }
  | {
      readonly kind: 'git-subdir'
      readonly url: string
      readonly path: string
      readonly ref?: string
      readonly sha?: string
    }
  | { readonly kind: 'github'; readonly repo: string; readonly sha?: string }
  | { readonly kind: 'command'; readonly command: string }
  | { readonly kind: 'other'; readonly type: string }

export type CatalogEntry = {
  readonly id: PluginId
  readonly name: string
  readonly description: string
  readonly marketplace: string
  readonly source: CatalogSource
  /** Null in the CLI for most entries today; absent here then. */
  readonly installs?: number
  readonly version?: string
}

export type Parsed<T> = { readonly items: T[]; readonly skipped: number }

export type ShownCommand = {
  readonly kind: 'command_source' | 'entry_helper'
  readonly pluginId: string
  /** Shown verbatim to the person, after sanitising for display only. */
  readonly command: string
  readonly mode?: string
  readonly archiveUrl?: string
  readonly catalogRevision: string
  readonly sha256: Sha256
  readonly acceptCommandMatched?: boolean
}

export type OpDone = {
  readonly status: 'done'
  readonly command: string
  readonly pluginId?: PluginId
  readonly scope?: string
  readonly message: string
  /** The CLI found it already so (`already_in_goal_state`): nothing changed. */
  readonly unchanged: boolean
  readonly update?: { readonly outcome: string; readonly from?: string; readonly to?: string }
}

/** A declared command must be accepted first (F25); `changed` when a given sha no longer matched. */
export type OpNeedsAcceptance = {
  readonly status: 'needs-acceptance'
  readonly shown: ShownCommand
  readonly changed: boolean
  readonly message: string
}

export type OpOutcome = OpDone | OpNeedsAcceptance

export type Marketplace = {
  readonly name: string
  readonly source: string
  readonly location?: string
}

export type Details = {
  readonly skills: number
  readonly agents: number
  readonly hooks: number
  readonly mcp: number
  readonly lsp: number
  readonly tokens?: number
}

const MESSAGE_MAX = 500
const IGNORED_IN_SESSION = /--accept-command is ignored inside a Claude Code session/

/** The last stdout line that parses as a JSON object (human lines may precede it, F26). */
export const lastJsonObject = (stdout: string): JsonRecord | undefined => {
  const lines = stdout.split('\n')
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]?.trim()
    if (line?.startsWith('{')) {
      const value = parseJson(line)
      if (isRecord(value)) return value
    }
  }
  return undefined
}

const firstLine = (text: string): string =>
  sanitize(
    text
      .split('\n')
      .map(line => line.replace(/^[✘✔⚠❯]\s*/u, '').trim())
      .find(line => line.length > 0) ?? '',
    { max: MESSAGE_MAX },
  )

const noJson = (run: CliRun): Result<never> =>
  run.exitCode === 0
    ? fail('parse', 'the CLI printed no JSON result')
    : fail('cli-failed', firstLine(run.stderr) || firstLine(run.stdout) || `exit ${run.exitCode}`)

const parseWhole = (run: CliRun): Result<unknown> => {
  const value = parseJson(run.stdout)
  if (value !== undefined) return ok(value)
  return noJson(run)
}

const optionalPath = (record: JsonRecord, key: string): AbsolutePath | undefined => {
  const parsed = parseAbsolutePath(str(record, key))
  return parsed.ok ? parsed.value : undefined
}

const installedScope = (value: string | undefined): InstalledScope | undefined =>
  value === 'session' || (SCOPES as readonly (string | undefined)[]).includes(value)
    ? (value as InstalledScope)
    : undefined

export const parseInstalledEntry = (value: unknown): InstalledEntry | undefined => {
  if (!isRecord(value)) return undefined
  const id = parsePluginId(str(value, 'id'))
  const scope = installedScope(str(value, 'scope'))
  const enabled = bool(value, 'enabled')
  if (!id.ok || scope === undefined || enabled === undefined) return undefined
  return compact({
    id: id.value,
    version: str(value, 'version'),
    scope,
    enabled,
    installPath: optionalPath(value, 'installPath'),
    readFromFolder: optionalPath(value, 'readFromFolder'),
    folderVersion: str(value, 'folderVersion'),
    installedAt: str(value, 'installedAt'),
    lastUpdated: str(value, 'lastUpdated'),
    projectEnabled: bool(value, 'projectEnabled'),
    projectPath: optionalPath(value, 'projectPath'),
    dataBytes: (() => {
      const size = rec(value, 'dataDirSize')
      return size === undefined ? undefined : num(size, 'bytes')
    })(),
  })
}

const parseEach = <T>(
  values: readonly unknown[],
  one: (v: unknown) => T | undefined,
): Parsed<T> => {
  const items: T[] = []
  for (const value of values) {
    const item = one(value)
    if (item !== undefined) items.push(item)
  }
  return { items, skipped: values.length - items.length }
}

/** `claude plugin list --json [--data-size]`. */
export const parseInstalledList = (run: CliRun): Result<Parsed<InstalledEntry>> => {
  const whole = parseWhole(run)
  if (!whole.ok) return whole
  if (!Array.isArray(whole.value)) return fail('parse', 'list --json is not an array')
  return ok(parseEach(whole.value, parseInstalledEntry))
}

export const parseCatalogSource = (value: unknown): CatalogSource => {
  if (typeof value === 'string') return { kind: 'relative', path: value }
  if (!isRecord(value)) return { kind: 'other', type: typeof value }
  const type = str(value, 'source') ?? 'unknown'
  const url = str(value, 'url')
  const sha = str(value, 'sha')
  if (type === 'url' && url !== undefined) return compact({ kind: 'url' as const, url, sha })
  const path = str(value, 'path')
  if (type === 'git-subdir' && url !== undefined && path !== undefined) {
    return compact({ kind: 'git-subdir' as const, url, path, ref: str(value, 'ref'), sha })
  }
  const repo = str(value, 'repo')
  if (type === 'github' && repo !== undefined) {
    return compact({ kind: 'github' as const, repo, sha })
  }
  const command = str(value, 'command')
  if (type === 'command' && command !== undefined) return { kind: 'command', command }
  return { kind: 'other', type: sanitize(type, { max: 40 }) }
}

export const parseCatalogEntry = (value: unknown): CatalogEntry | undefined => {
  if (!isRecord(value)) return undefined
  const id = parsePluginId(str(value, 'pluginId'))
  const name = str(value, 'name')
  const marketplace = str(value, 'marketplaceName')
  if (!id.ok || name === undefined || marketplace === undefined) return undefined
  const installs = num(value, 'installCount')
  return compact({
    id: id.value,
    name,
    description: str(value, 'description') ?? '',
    marketplace,
    source: parseCatalogSource(value.source),
    installs: installs !== undefined && installs >= 0 ? Math.floor(installs) : undefined,
    version: str(value, 'version'),
  })
}

/** `claude plugin list --json --available`: `available` excludes installed plugins (F10). */
export const parseAvailable = (
  run: CliRun,
): Result<{ installed: Parsed<InstalledEntry>; available: Parsed<CatalogEntry> }> => {
  const whole = parseWhole(run)
  if (!whole.ok) return whole
  if (!isRecord(whole.value)) return fail('parse', 'list --available is not an object')
  const installed = arr(whole.value, 'installed')
  const available = arr(whole.value, 'available')
  if (installed === undefined || available === undefined) {
    return fail('parse', 'list --available lacks installed or available')
  }
  return ok({
    installed: parseEach(installed, parseInstalledEntry),
    available: parseEach(available, parseCatalogEntry),
  })
}

/** `claude plugin marketplace list --json`. */
export const parseMarketplaces = (run: CliRun): Result<Parsed<Marketplace>> => {
  const whole = parseWhole(run)
  if (!whole.ok) return whole
  if (!Array.isArray(whole.value)) return fail('parse', 'marketplace list is not an array')
  return ok(
    parseEach(whole.value, value => {
      if (!isRecord(value)) return undefined
      const name = str(value, 'name')
      const source = str(value, 'source')
      if (name === undefined || source === undefined) return undefined
      return compact({
        name,
        source,
        location: str(value, 'repo') ?? str(value, 'url') ?? str(value, 'path'),
      })
    }),
  )
}

export const parseShownCommand = (value: unknown): ShownCommand | undefined => {
  if (!isRecord(value)) return undefined
  const kind = str(value, 'kind')
  const pluginId = str(value, 'pluginId')
  const command = str(value, 'command')
  const catalogRevision = str(value, 'catalogRevision')
  const sha = parseSha256(str(value, 'sha256'))
  if (
    (kind !== 'command_source' && kind !== 'entry_helper') ||
    pluginId === undefined ||
    command === undefined ||
    catalogRevision === undefined ||
    !sha.ok
  ) {
    return undefined
  }
  return compact({
    kind: kind === 'entry_helper' ? ('entry_helper' as const) : ('command_source' as const),
    pluginId,
    command,
    mode: str(value, 'mode'),
    archiveUrl: str(value, 'archiveUrl'),
    catalogRevision,
    sha256: sha.value,
    acceptCommandMatched: bool(value, 'acceptCommandMatched'),
  })
}

/**
 * One result line of `install | update | uninstall | enable | disable |
 * marketplace add | marketplace update … --json` (F8, F25–F27).
 */
export const parseOpResult = (run: CliRun): Result<OpOutcome> => {
  const line = lastJsonObject(run.stdout)
  if (line === undefined) return noJson(run)
  const message = sanitize(str(line, 'message') ?? '', { max: MESSAGE_MAX })
  const command = str(line, 'command') ?? 'unknown'
  const code = str(line, 'failureCode')
  const shown = parseShownCommand(line.shownCommand)

  if (IGNORED_IN_SESSION.test(run.stdout) || IGNORED_IN_SESSION.test(run.stderr)) {
    return fail('rejected', 'Claude Code ignored the acceptance from here', code)
  }
  if (shown !== undefined && str(line, 'outcome') !== 'ok') {
    if (shown.acceptCommandMatched === true) {
      return fail('rejected', message || 'the declared command was not accepted', code)
    }
    return ok({
      status: 'needs-acceptance',
      shown,
      changed: shown.acceptCommandMatched === false,
      message,
    })
  }

  const unchanged = code === 'already_in_goal_state' || bool(line, 'alreadyInGoalState') === true
  if (str(line, 'outcome') !== 'ok' && !unchanged) {
    return fail('cli-failed', message || `${command} failed`, code)
  }
  const pluginId = parsePluginId(str(line, 'pluginId') ?? str(line, 'plugin'))
  const updateOutcome = str(line, 'updateOutcome')
  return ok(
    compact({
      status: 'done' as const,
      command,
      pluginId: pluginId.ok ? pluginId.value : undefined,
      scope: str(line, 'scope'),
      message,
      unchanged,
      update:
        updateOutcome === undefined
          ? undefined
          : compact({
              outcome: updateOutcome,
              from: str(line, 'oldVersion'),
              to: str(line, 'newVersion'),
            }),
    }),
  )
}

const count = (text: string, label: string): number => {
  const match = new RegExp(`^\\s*${label} \\((\\d+)\\)`, 'm').exec(text)
  return match?.[1] === undefined ? 0 : Number(match[1])
}

/**
 * `claude plugin details <id>` (text only). It reports "Hooks (0)" for a mod
 * (F9), so modmgr reads only the other counts and the token cost from it.
 */
export const parseDetails = (run: CliRun): Result<Details> => {
  if (run.exitCode !== 0) return noJson(run)
  if (!/Component inventory/.test(run.stdout)) return fail('parse', 'details has no inventory')
  const tokens = /Always-on:\s*~?([\d,]+)\s*tok/.exec(run.stdout)?.[1]
  return ok(
    compact({
      skills: count(run.stdout, 'Skills'),
      agents: count(run.stdout, 'Agents'),
      hooks: count(run.stdout, 'Hooks'),
      mcp: count(run.stdout, 'MCP servers'),
      lsp: count(run.stdout, 'LSP servers'),
      tokens: tokens === undefined ? undefined : Number(tokens.replace(/,/g, '')),
    }),
  )
}
