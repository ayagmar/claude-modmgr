// Health (PLAN §2.5, C15): what needs the person's attention, grouped by mod,
// each with a one-press fix where one exists, then modmgr's own state (the
// installed list's refresh, a reload owed, the detector, the cache, the update
// checks). Built from `$.state` alone, so it is drawn, never fetched.

import type {
  Attention,
  Degraded,
  DetectProgress,
  DevState,
  HealthFacts,
  JobQueue,
  ModRow,
  Sync,
} from '../../types/index.d.ts'
import { notableVerb } from './capabilities.ts'
import { isActive } from './jobs.ts'
import { sanitize } from './sanitize.ts'
import { bytesLabel, whyLocked, whyNoUpdate } from './view.ts'

/** What pressing an item does. */
export type HealthFix =
  | { readonly kind: 'update' | 'open'; readonly id: string }
  | { readonly kind: 'validate'; readonly key: string }
  | { readonly kind: 'copy'; readonly text: string }
  | { readonly kind: 'reload' | 'refresh' | 'clear-cache' | 'check-updates' }

export type HealthTone = 'bad' | 'warn' | 'info'

export type HealthItem = {
  /** Stable: the Button's key. */
  readonly key: string
  /** The mod it concerns, or modmgr's own heading. */
  readonly group: string
  readonly tone: HealthTone
  readonly text: string
  readonly fix?: HealthFix
  /** What the fix does, in a word or two. */
  readonly fixLabel?: string
}

/** modmgr's own heading, and the hook-order notes'. */
export const OWN_GROUP = 'modmgr'
export const ORDER_GROUP = 'Hook order'

/** A Health item's Button key: what `ui.focus` and `ui.press` name. */
export const HEALTH_PREFIX = 'health:'
export const healthKey = (key: string): string => `${HEALTH_PREFIX}${key}`
export const healthOfKey = (key: string | undefined): string | undefined =>
  key?.startsWith(HEALTH_PREFIX) === true ? key.slice(HEALTH_PREFIX.length) : undefined

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** `just now`, `5 min ago`, `3 h ago`, `2 days ago`. */
export const agoLabel = (ms: number): string => {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.floor(hours / 24)} days ago`
}

export type HealthInput = {
  readonly mods: readonly ModRow[]
  readonly dev: DevState
  readonly attention: Attention
  readonly degraded: Degraded
  readonly sync: Sync
  readonly detect: DetectProgress
  readonly queue: JobQueue
  readonly facts: HealthFacts
}

const TONE_ORDER: Readonly<Record<HealthTone, number>> = { bad: 0, warn: 1, info: 2 }

/** Each mod's items: what is wrong first. */
const modItems = (input: HealthInput): HealthItem[] => {
  const items: HealthItem[] = []
  const devKeyOf = new Map(input.dev.rows.map(row => [row.name, row.key]))
  const named = new Set<string>()
  for (const row of input.mods) {
    const group = sanitize(row.name, { max: 40 })
    named.add(row.name)
    if (row.problems > 0) {
      items.push({
        key: `${row.id}:validate`,
        group,
        tone: 'bad',
        text: `validate finds ${plural(row.problems, 'error', 'errors')} in it`,
        fix: { kind: 'open', id: row.id },
        fixLabel: 'see it',
      })
    }
    if (row.capsNew !== undefined) {
      const added = row.capsNew.added.map(notableVerb).join(', ')
      items.push({
        key: `${row.id}:caps`,
        group,
        tone: 'warn',
        text: `since ${sanitize(row.capsNew.since, { max: 20 })} it can ${added}`,
        fix: { kind: 'open', id: row.id },
        fixLabel: 'review it',
      })
    }
    if (row.updateTo !== undefined && whyNoUpdate(row) === undefined) {
      items.push({
        key: `${row.id}:update`,
        group,
        tone: 'info',
        text: `${sanitize(row.updateTo, { max: 20 })} is available`,
        fix: { kind: 'update', id: row.id },
        fixLabel: 'update',
      })
    }
  }
  // Failures the session reported while hot-reloading (Dev's), and the debug log's.
  const names = new Set([...Object.keys(input.dev.failures), ...Object.keys(input.facts.logged)])
  for (const name of [...names].sort()) {
    const group = sanitize(name, { max: 40 })
    const failed = input.dev.failures[name]
    const devKey = devKeyOf.get(name)
    if (failed !== undefined) {
      items.push({
        key: `${name}:failures`,
        group,
        tone: 'bad',
        text: `${plural(failed.count, 'failure', 'failures')} while it reloaded; last: ${failed.lastReason}`,
        ...(devKey === undefined
          ? {}
          : { fix: { kind: 'validate' as const, key: devKey }, fixLabel: 'validate' }),
      })
    }
    const logged = input.facts.logged[name]
    if (logged !== undefined) {
      items.push({
        key: `${name}:logged`,
        group,
        tone: 'bad',
        text: `a hook failed: ${sanitize(logged, { max: 160 })} (debug log)`,
      })
    }
  }
  // By mod, worst first; the mods in Installed's order, then the rest by name.
  const order = [...input.mods.map(row => sanitize(row.name, { max: 40 }))]
  const rank = (group: string) => {
    const at = order.indexOf(group)
    return at < 0 ? order.length : at
  }
  const worst = new Map<string, number>()
  for (const item of items) {
    worst.set(item.group, Math.min(worst.get(item.group) ?? 9, TONE_ORDER[item.tone]))
  }
  return items.sort(
    (a, b) =>
      (worst.get(a.group) ?? 9) - (worst.get(b.group) ?? 9) ||
      rank(a.group) - rank(b.group) ||
      a.group.localeCompare(b.group) ||
      TONE_ORDER[a.tone] - TONE_ORDER[b.tone],
  )
}

/** modmgr's own state, and the load states in one line. */
const ownItems = (input: HealthInput): HealthItem[] => {
  const { attention, degraded, sync, detect, facts, queue } = input
  const items: HealthItem[] = []
  const own = (item: Omit<HealthItem, 'group'>) => items.push({ ...item, group: OWN_GROUP })
  if (degraded.process) {
    own({ key: 'own:process', tone: 'bad', text: sanitize(degraded.reason ?? '', { max: 300 }) })
  }
  if (sync.error !== undefined) {
    own({
      key: 'own:sync',
      tone: 'bad',
      text: `couldn't read the installed list: ${sanitize(sync.error.message, { max: 160 })}`,
      fix: { kind: 'refresh' },
      fixLabel: 'try again',
    })
  }
  const reloadQueued = queue.jobs.some(job => job.kind === 'reload' && isActive(job))
  if (attention.reloadPending && !reloadQueued) {
    own({
      key: 'own:reload',
      tone: 'warn',
      text: 'changes wait for a plugin reload',
      fix: { kind: 'reload' },
      fixLabel: 'reload',
    })
  }
  if (facts.cache.full) {
    own({
      key: 'own:cache',
      tone: 'bad',
      text: "modmgr's cache is full; what it knows is not saved",
      fix: { kind: 'clear-cache' },
      fixLabel: 'clear cache',
    })
  }
  if (degraded.acceptCommand) {
    own({
      key: 'own:accept',
      tone: 'info',
      text: 'Claude Code refuses declared-command acceptances from this session; accept them in a terminal',
    })
  }
  const counts = loadStates(input.mods)
  if (counts !== undefined) own({ key: 'own:load', tone: 'info', text: counts })
  const updates = facts.updates
  own({
    key: 'own:updates',
    tone: 'info',
    text:
      updates.off !== undefined
        ? `update checks are off: ${updates.off}`
        : `updates checked ${updates.at === undefined || facts.at === undefined ? 'never' : agoLabel(facts.at - updates.at)}, every ${plural(updates.every, 'hour', 'hours')}`,
    ...(updates.off === undefined
      ? { fix: { kind: 'check-updates' as const }, fixLabel: 'check now' }
      : {}),
  })
  const left = Math.max(0, facts.detector.budget - facts.detector.spent)
  own({
    key: 'own:detector',
    tone: 'info',
    text: facts.detector.remote
      ? `detector: ${detect.checked.toLocaleString('en-US')} of ${detect.total.toLocaleString('en-US')} checked, ${detect.found} mods found, ${left} requests left this session`
      : `detector: local catalogues only (${facts.detector.why ?? 'remote checks are off'}); ${detect.found} mods found`,
  })
  if (!facts.cache.full) {
    own({
      key: 'own:cache',
      tone: 'info',
      text: `cache: ${bytesLabel(facts.cache.bytes)}`,
      fix: { kind: 'clear-cache' },
      fixLabel: 'clear',
    })
  }
  if (!facts.debugLog) {
    own({
      key: 'own:debug',
      tone: 'info',
      text: 'A hook that fails is logged only in a session started with --debug',
      fix: { kind: 'copy', text: 'claude --debug' },
      fixLabel: 'copy command',
    })
  }
  return items
}

/** `4 enabled · 1 disabled · 1 managed · 2 from the launch command`, or nothing with no mods. */
export const loadStates = (mods: readonly ModRow[]): string | undefined => {
  if (mods.length === 0) return undefined
  const managed = mods.filter(row => row.scope === 'managed').length
  const launched = mods.filter(
    row => row.origin === 'env-dir' || row.origin === 'plugin-dir',
  ).length
  const other = mods.filter(row => whyLocked(row) === undefined)
  const enabled = other.filter(row => row.enabled).length
  const disabled = other.length - enabled
  return [
    `${enabled} enabled`,
    disabled === 0 ? '' : `${disabled} disabled`,
    managed === 0 ? '' : `${managed} managed`,
    launched === 0 ? '' : `${launched} from the launch command`,
  ]
    .filter(part => part !== '')
    .join(' · ')
}

/** Every item Health draws: the mods', the hook-order notes, then modmgr's own. */
export const healthItemsOf = (input: HealthInput): HealthItem[] => [
  ...modItems(input),
  ...input.facts.chain.map(
    (note): HealthItem => ({
      key: `order:${note.event}`,
      group: ORDER_GROUP,
      tone: 'info',
      text: sanitize(note.text, { max: 300 }),
    }),
  ),
  ...ownItems(input),
]

/** How many items say something is wrong (the tab's `▲n`). */
export const problemCount = (items: readonly HealthItem[]): number =>
  items.filter(item => item.tone === 'bad').length

/**
 * The last `hook failed closed: <plugin>: errorKind=… (<event>; …)` line per
 * plugin in a debug log (F35: the engine logs the error's length, not its text).
 */
export const loggedFailures = (log: string): Record<string, string> => {
  const found: Record<string, string> = {}
  const line =
    /hook failed closed: ([a-z0-9][a-z0-9._-]{0,63})(?:@[a-z0-9._-]+)?: errorKind=(\w+)[^(]*\(([\w.]+)/g
  for (const match of log.matchAll(line)) {
    const [, name, kind, event] = match
    if (name !== undefined && kind !== undefined && event !== undefined) {
      found[name] = `${event} (${kind})`
    }
  }
  return found
}
