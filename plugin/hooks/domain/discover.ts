// Discover's logic: what a catalogue row says, the install
// review, the review that accepts a marketplace-declared command, and
// adding a marketplace. The catalogue itself lives in services/catalog.ts.

import type {
  CatalogPage,
  CatalogRow,
  CommunityFacts,
  Job,
  ReviewRequest,
  Scope,
  View,
} from '../../types/index.d.ts'
import { capabilitiesOf, notableText } from './capabilities.ts'
import { installIdOf, SORTS } from './catalog.ts'
import type { CommunityMod } from './community.ts'
import { parseMarketplaceSource } from './ids.ts'
import { sanitize } from './sanitize.ts'

export const INSTALL_SCOPES = ['user', 'project', 'local'] as const
export type InstallScope = (typeof INSTALL_SCOPES)[number]

export const isInstallScope = (value: unknown): value is InstallScope =>
  typeof value === 'string' && (INSTALL_SCOPES as readonly string[]).includes(value)

/** What a scope means, for the review's Select. */
export const SCOPE_LABEL: Readonly<Record<InstallScope, string>> = {
  user: 'user: every project',
  project: 'project: this repository, shared',
  local: 'local: this repository, only you',
}

/** What modmgr could read about an entry before installing it (a local source's `validate`). */
export type Inspection = {
  readonly notable: readonly string[]
  readonly hasModule: boolean
}

/** A local entry modmgr tried to read and couldn't, and why. */
export type Unread = { readonly failed: string }

export const isUnread = (value: Inspection | Unread | undefined): value is Unread =>
  value !== undefined && 'failed' in value

/**
 * The review of installing `entry` (`i`): the scope (user by default), what it
 * can do when modmgr could read it, else that it couldn't (a remote source is
 * read only once installed).
 */
export const installReview = (
  entry: { readonly id: string; readonly name: string; readonly version?: string | undefined },
  scope: InstallScope,
  read: Inspection | Unread | undefined,
): ReviewRequest => {
  const inspection = isUnread(read) ? undefined : read
  const review: ReviewRequest = {
    action: 'install',
    targets: [
      {
        id: entry.id,
        op: 'install',
        scope,
        ...(entry.version === undefined ? {} : { version: entry.version }),
      },
    ],
    notable: (inspection?.notable ?? []).map(id => `${entry.name}: ${notableText(id)}`),
    changesRepoFile: scope !== 'user',
  }
  if (inspection !== undefined) return review
  return isUnread(read)
    ? { ...review, uninspected: true, unreadable: read.failed }
    : { ...review, uninspected: true }
}

/**
 * The review of installing a community mod (`i`): from the marketplace at its
 * repository's root, which the install adds first. What it can do is known
 * already, from the community index; modmgr reads it again once installed.
 * Undefined for a mod no marketplace lists (it can't be installed by id).
 */
export const communityInstallReview = (
  mod: CommunityMod,
  scope: InstallScope,
): ReviewRequest | undefined => {
  const id = installIdOf(mod)
  if (id === undefined) return undefined
  const name = sanitize(mod.name, { max: 64 })
  return {
    action: 'install',
    targets: [{ id, op: 'install', scope }],
    notable: capabilitiesOf(mod).notable.map(notable => `${name}: ${notableText(notable)}`),
    changesRepoFile: scope !== 'user',
    source: mod.repo,
    indexedAt: mod.commit,
  }
}

/** A community mod's page on GitHub (its folder at the commit the index read). */
export const communityLink = (facts: Pick<CommunityFacts, 'repo' | 'path' | 'commit'>): string =>
  facts.path === ''
    ? `https://github.com/${facts.repo}`
    : `https://github.com/${facts.repo}/tree/${facts.commit}/${facts.path}`

/** The same review at another scope (the review's Select). */
export const withScope = (review: ReviewRequest, scope: Scope): ReviewRequest =>
  review.action !== 'install' || !isInstallScope(scope)
    ? review
    : {
        ...review,
        targets: review.targets.map(target => ({ ...target, scope })),
        changesRepoFile: scope !== 'user',
      }

/**
 * The review that accepts what a failed install or update was stopped by:
 * the command a marketplace declares (or the headers helper that fetches its
 * archive), verbatim, with its sha256. Confirming passes the sha with
 * `--accept-command`; the CLI runs it only if the command it would run still
 * has that sha, and otherwise shows the new one, which this review
 * shows again. Undefined for a job that wasn't stopped that way.
 */
export const acceptReview = (job: Job): ReviewRequest | undefined => {
  const { shown, target } = job
  if (shown === undefined || target === undefined) return undefined
  if (job.kind !== 'install' && job.kind !== 'update') return undefined
  const scope = job.args?.scope
  const declared = {
    text: shown.command,
    sha256: shown.sha256,
    ...(shown.truncated === true ? { truncated: true } : {}),
  }
  const source = job.args?.source
  return {
    action: job.kind,
    targets: [{ id: target, op: job.kind, ...(scope === undefined ? {} : { scope }) }],
    notable: [],
    changesRepoFile: scope === 'project' || scope === 'local',
    ...(source === undefined ? {} : { source }),
    ...(shown.kind === 'entry_helper'
      ? { headersHelper: declared }
      : { declaredCommand: declared }),
  }
}

/**
 * The newest failed job that waits for its declared command to be reviewed:
 * none once a later install or update of the same mod was queued or ran.
 */
export const awaitingAcceptance = (jobs: readonly Job[]): Job | undefined => {
  const at = jobs.findLastIndex(job => job.state === 'failed' && job.shown !== undefined)
  const stopped = jobs[at]
  if (stopped === undefined) return undefined
  const settled = jobs
    .slice(at + 1)
    .some(job => job.target === stopped.target && (job.kind === 'install' || job.kind === 'update'))
  return settled ? undefined : stopped
}

/**
 * The review of adding a marketplace (`m`), or why the source can't be one.
 * Adding fetches the catalogue (a clone for a repository) and writes your
 * settings; it runs no plugin code.
 */
export const marketplaceReview = (
  text: string,
): { readonly review: ReviewRequest } | { readonly error: string } => {
  const source = parseMarketplaceSource(text.trim())
  if (!source.ok) return { error: source.error.message }
  return {
    review: {
      action: 'marketplace',
      targets: [],
      notable: [],
      changesRepoFile: false,
      source: source.value,
    },
  }
}

/** The notable lines of an inspection, for the detail. */
export const inspectionLines = (inspection: Inspection): string[] =>
  inspection.notable.map(notableText)

/** The marketplace field's key. */
export const MARKETPLACE_KEY = 'marketplace-source'

/** A Discover row's Button key: what `ui.focus` and `ui.press` name. */
export const FOUND_PREFIX = 'found:'
export const foundKey = (id: string): string => `${FOUND_PREFIX}${id}`
export const foundOfKey = (key: string | undefined): string | undefined =>
  key?.startsWith(FOUND_PREFIX) === true ? key.slice(FOUND_PREFIX.length) : undefined

/** The catalogue row Discover shows as selected and acts on: the selection when drawn, else the first. */
export const foundRow = (view: View, page: CatalogPage): CatalogRow | undefined =>
  page.rows.find(row => row.id === view.found) ?? page.rows[0]

/** What the sort key says: installs, then stars for community mods. */
export const SORT_LABEL: Readonly<Record<View['sort'], string>> = {
  installs: 'popularity',
  stars: 'stars',
  name: 'name',
  marketplace: 'source',
}

/** The next sort (`o`): popularity → stars → name → source. */
export const nextSort = (sort: View['sort']): View['sort'] =>
  SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length] ?? 'installs'

/**
 * `74 mods`, `74 mods among 1,804 of 3,544 checked`, or while it runs
 * `12 mods so far · checking 1,804 of 3,544`; undefined before it ran.
 */
export const detectLine = (detect: {
  readonly checked: number
  readonly total: number
  readonly found: number
  readonly running: boolean
}): string | undefined => {
  if (detect.total === 0) return undefined
  const n = (value: number) => value.toLocaleString('en-US')
  const mods = `${n(detect.found)} ${detect.found === 1 ? 'mod' : 'mods'}`
  if (detect.running)
    return detect.checked === 0
      ? `checking ${n(detect.total)} entries…`
      : `${mods} so far · checking ${n(detect.checked)} of ${n(detect.total)}`
  if (detect.checked >= detect.total) return mods
  return `${mods} among ${n(detect.checked)} of ${n(detect.total)} checked`
}
