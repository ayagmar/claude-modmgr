// Update detection (PLAN §2.6, C15). The CLI has no "outdated" query and no
// dry run (`update` installs), and `list --available` leaves installed plugins
// out (F10), so after a marketplace refresh modmgr reads each marketplace's own
// file and finds what it can say for sure (F58): a newer declared version, or
// a pinned commit that moved past an installed commit-named version. Anything
// else stays unknown; `a` (update all) still asks the CLI.

import type { CatalogSource, InstalledEntry } from './cli-results.ts'
import { parseCatalogSource } from './cli-results.ts'
import { isPluginName, splitPluginId } from './ids.ts'
import { isRecord, parseJson, str } from './json.ts'
import { originOf } from './mods.ts'
import type { FoundUpdate, Updates } from './store-schema.ts'
import { compareVersions } from './version.ts'

/**
 * A plugin as its marketplace's own file lists it, with the version its own
 * `plugin.json` says when that file is on disk (a relative source): the CLI
 * compares the plugin's own version when it has one, the file's declaration
 * otherwise (F58, review R-M5-2).
 */
export type ListedEntry = {
  readonly version?: string
  readonly source: CatalogSource
  readonly manifestVersion?: string
}

/** A version string kept from a file modmgr doesn't control: at most this long. */
const VERSION_MAX = 64

/** A `marketplace.json`'s plugins by name (unreadable entries left out). */
export const marketplaceEntriesOf = (text: string): Map<string, ListedEntry> => {
  const entries = new Map<string, ListedEntry>()
  const value = parseJson(text)
  if (!isRecord(value) || !Array.isArray(value.plugins)) return entries
  for (const plugin of value.plugins) {
    if (!isRecord(plugin)) continue
    const name = str(plugin, 'name')
    if (!isPluginName(name)) continue
    const version = str(plugin, 'version')?.slice(0, VERSION_MAX)
    const source = parseCatalogSource(plugin.source)
    entries.set(name, version === undefined ? { source } : { version, source })
  }
  return entries
}

/** A whole version string (`1.2.0`, `1.2.0-beta.1`), not one that merely starts like one. */
const VERSION = /^\d+\.\d+\.\d+(?:[-+][\w.-]{0,40})?$/

/** A commit-named version: the 12-hex prefix the CLI gives a plugin with no version of its own. */
const COMMIT_VERSION = /^[0-9a-f]{12}$/

const pinnedSha = (source: CatalogSource): string | undefined =>
  source.kind === 'url' || source.kind === 'git-subdir' || source.kind === 'github'
    ? source.sha
    : undefined

/**
 * The version an installed plugin can update to, when its marketplace's file
 * says so for sure; undefined otherwise. Only marketplace installs update
 * through the CLI (a folder marketplace runs from its folder, F51; managed and
 * launch-command plugins aren't the CLI's to update).
 */
export const updateOf = (
  installed: InstalledEntry,
  listed: ListedEntry | undefined,
): string | undefined => {
  const version = installed.version
  if (listed === undefined || version === undefined) return undefined
  if (originOf(installed) !== 'marketplace' || installed.scope === 'managed') return undefined
  if (listed.source.kind === 'relative') {
    // Its folder is in the clone: the plugin's own version first, as the CLI reads it.
    const target = listed.manifestVersion ?? listed.version
    if (target === undefined || !VERSION.test(target) || !VERSION.test(version)) return undefined
    const newer = compareVersions(target, version)
    return newer !== undefined && newer > 0 ? target : undefined
  }
  // A remote source's own manifest isn't on disk: a declared version may not be what the
  // CLI compares, so only a moved commit is sure.
  const sha = pinnedSha(listed.source)
  if (!COMMIT_VERSION.test(version) || sha === undefined || !/^[0-9a-f]{40}$/.test(sha)) {
    return undefined
  }
  return sha.startsWith(version) ? undefined : sha.slice(0, 12)
}

/**
 * What a check found for the installed plugins, from each marketplace's
 * entries (by marketplace name, then plugin name).
 */
export const foundUpdates = (
  installed: readonly InstalledEntry[],
  marketplaces: ReadonlyMap<string, ReadonlyMap<string, ListedEntry>>,
): Record<string, FoundUpdate> => {
  const found: Record<string, FoundUpdate> = {}
  for (const entry of installed) {
    const { name, marketplace } = splitPluginId(entry.id)
    const to = updateOf(entry, marketplaces.get(marketplace)?.get(name))
    if (to !== undefined && entry.version !== undefined) {
      found[entry.id] = { from: entry.version, to }
    }
  }
  return found
}

/**
 * The update a row shows: what the last check found, while the plugin is still
 * at the version it was found for (an update since, here or elsewhere, ends it).
 */
export const updateTo = (updates: Updates, entry: InstalledEntry): string | undefined => {
  const found = updates.found[entry.id]
  return found !== undefined && found.from === entry.version ? found.to : undefined
}

const HOUR = 60 * 60 * 1000

/**
 * How long until the next check: due `hours` after the last one (now when
 * there was none or it is past due); undefined when checks are off (0 hours).
 */
export const nextCheckIn = (
  lastAt: number | undefined,
  hours: number,
  now: number,
): number | undefined => {
  if (hours <= 0) return undefined
  if (lastAt === undefined) return 0
  return Math.max(0, lastAt + hours * HOUR - now)
}
