// Discover's logic (PLAN §2.3): what a catalogue row says, the install
// review, the review that accepts a marketplace-declared command (F25), and
// adding a marketplace. The catalogue itself lives in services/catalog.ts.

import type {
  CatalogPage,
  CatalogRow,
  Job,
  ReviewRequest,
  Scope,
  View,
} from '../../types/index.d.ts'
import { notableText } from './capabilities.ts'
import { KIND_FILTERS, SORTS } from './catalog.ts'
import { parseMarketplaceSource } from './ids.ts'

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

/** A catalogue row's kind in words: what the detector knows. */
export const KIND_LABEL: Readonly<Record<CatalogRow['kind'], string>> = {
  mod: 'mod',
  hooks: 'hooks',
  plain: 'plugin',
  unknown: '?',
}

/** What modmgr could read about an entry before installing it (a local source's `validate`). */
export type Inspection = {
  readonly notable: readonly string[]
  readonly hasModule: boolean
}

/**
 * The review of installing `entry` (`i`): the scope (user by default), what it
 * can do when modmgr could read it, else that it couldn't (a remote source is
 * read only once installed; a pre-install diff is v1.1, PLAN §12).
 */
export const installReview = (
  entry: { readonly id: string; readonly name: string; readonly version?: string | undefined },
  scope: InstallScope,
  inspection: Inspection | undefined,
): ReviewRequest => {
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
  return inspection === undefined ? { ...review, uninspected: true } : review
}

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
 * has that sha, and otherwise shows the new one (F25), which this review
 * shows again. Undefined for a job that wasn't stopped that way.
 */
export const acceptReview = (job: Job): ReviewRequest | undefined => {
  const { shown, target } = job
  if (shown === undefined || target === undefined) return undefined
  if (job.kind !== 'install' && job.kind !== 'update') return undefined
  const scope = job.args?.scope
  const declared = { text: shown.command, sha256: shown.sha256 }
  return {
    action: job.kind,
    targets: [{ id: target, op: job.kind, ...(scope === undefined ? {} : { scope }) }],
    notable: [],
    changesRepoFile: scope === 'project' || scope === 'local',
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

/** The next kind filter (`k`): mods → hooks → all. */
export const nextKind = (kind: View['kind']): View['kind'] =>
  KIND_FILTERS[(KIND_FILTERS.indexOf(kind) + 1) % KIND_FILTERS.length] ?? 'mods'

/** The next sort (`o`): installs → name → marketplace. */
export const nextSort = (sort: View['sort']): View['sort'] =>
  SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length] ?? 'installs'

/** `mods found 12 · checked 1,804/3,544`, or undefined before the detector ran. */
export const detectLine = (detect: {
  readonly checked: number
  readonly total: number
  readonly found: number
  readonly running: boolean
}): string | undefined => {
  if (detect.total === 0) return undefined
  const n = (value: number) => value.toLocaleString('en-US')
  const line = `mods found ${n(detect.found)} · checked ${n(detect.checked)}/${n(detect.total)}`
  return detect.running ? `${line} …` : line
}
