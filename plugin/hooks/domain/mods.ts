// Installed plugins → the rows Installed draws. A plugin is a
// mod when `validate --json` finds a hooks module in it; what it can do comes
// from the same report, cached per `root@version` (the Analysis below).

import type { ModDetail, ModRow, Origin } from '../../types/index.d.ts'
import { capabilitiesOf } from './capabilities.ts'
import type { Details, InstalledEntry } from './cli-results.ts'
import { type AbsolutePath, splitPluginId } from './ids.ts'
import type { ValidateReport } from './validate-report.ts'

/** What modmgr keeps per `root@version` (the `validate` store key). */
export type Analysis = {
  readonly mod: boolean
  readonly events: readonly string[]
  readonly calls: readonly string[]
  readonly envReads: readonly string[]
  readonly errors: number
  readonly warnings: number
  /** From `claude plugin details`, for mods only; absent when it failed. */
  readonly parts?: { readonly skills: number; readonly agents: number; readonly mcp: number }
  readonly tokens?: number
  readonly at: number
}

export const analysisOf = (
  report: ValidateReport,
  details: Details | undefined,
  at: number,
): Analysis => {
  const base = {
    mod: report.hasModule,
    events: report.events,
    calls: report.calls,
    envReads: report.envReads,
    errors: report.errors.length,
    warnings: report.warnings.length,
    at,
  }
  if (details === undefined) return base
  const parts = { skills: details.skills, agents: details.agents, mcp: details.mcp }
  return details.tokens === undefined
    ? { ...base, parts }
    : { ...base, parts, tokens: details.tokens }
}

/** The folder a plugin runs from: a folder marketplace's own folder, else the install copy. */
export const rootOf = (entry: InstalledEntry): AbsolutePath | undefined =>
  entry.readFromFolder ?? entry.installPath

/**
 * The version a session runs: a folder marketplace's plugin runs from its
 * folder (`readFromFolder`), so its folder's version, not the install copy's.
 */
export const runningVersion = (entry: InstalledEntry): string | undefined =>
  entry.folderVersion ?? entry.version

/**
 * The cache key for an entry's analysis. A folder-marketplace plugin edited
 * without a version bump keeps its key; Dev's validate (`v`) refreshes it.
 */
export const analysisKey = (entry: InstalledEntry): string | undefined => {
  const root = rootOf(entry)
  if (root === undefined) return undefined
  return `${root}@${runningVersion(entry) ?? '?'}`
}

export const originOf = (entry: InstalledEntry): Origin => {
  const { marketplace } = splitPluginId(entry.id)
  if (marketplace === 'inline' || entry.scope === 'session') return 'env-dir'
  if (marketplace === 'skills-dir') return 'skills-dir'
  if (entry.readFromFolder !== undefined) return 'folder-marketplace'
  return 'marketplace'
}

/** The CLI can toggle it: not managed, not loaded by the launch command (`--plugin-dir`, `CLAUDE_CODE_PLUGIN_DIRS`). */
export const isToggleable = (entry: InstalledEntry): boolean =>
  originOf(entry) !== 'env-dir' && entry.scope !== 'managed'

const hasParts = (analysis: Analysis): boolean =>
  analysis.parts !== undefined &&
  analysis.parts.skills + analysis.parts.agents + analysis.parts.mcp > 0

export const modRow = (entry: InstalledEntry, analysis: Analysis): ModRow => {
  const caps = capabilitiesOf(analysis)
  const version = runningVersion(entry)
  const row: ModRow = {
    id: entry.id,
    name: splitPluginId(entry.id).name,
    origin: originOf(entry),
    enabled: entry.enabled,
    toggleable: isToggleable(entry),
    notableCount: caps.notable.length,
    problems: analysis.errors,
    mixed: hasParts(analysis),
  }
  return {
    ...row,
    ...(version === undefined ? {} : { version }),
    ...(entry.scope === 'session' ? {} : { scope: entry.scope }),
    ...(entry.projectEnabled === undefined ? {} : { projectEnabled: entry.projectEnabled }),
  }
}

export const modDetail = (entry: InstalledEntry, analysis: Analysis): ModDetail => {
  const root = rootOf(entry)
  return {
    ...modRow(entry, analysis),
    caps: capabilitiesOf(analysis),
    validate: { errors: analysis.errors, warnings: analysis.warnings, at: analysis.at },
    ...(root === undefined ? {} : { root }),
    ...(analysis.parts === undefined ? {} : { mixedCounts: { ...analysis.parts } }),
    ...(analysis.tokens === undefined ? {} : { tokens: analysis.tokens }),
    ...(entry.dataBytes === undefined ? {} : { dataBytes: entry.dataBytes }),
  }
}

/**
 * Installed's order: by name, then id. Not by state, so a row stays put when
 * it is toggled and the list refreshes.
 */
export const sortRows = (rows: readonly ModRow[]): ModRow[] =>
  [...rows].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
