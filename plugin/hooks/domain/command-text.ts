// What `/mods` says as text: the list, one mod's detail,
// the doctor's report (Health's items, so the two never disagree), the export
// and the plan an `apply` file asks for, and how the jobs a write queued ended.

import type { Job, ModDetail, ModRow } from '../../types/index.d.ts'
import { groupByReach, notableOf } from './capabilities.ts'
import type { HealthItem } from './health.ts'
import { type PluginId, parsePluginId, parseToggleScope, type ToggleScope } from './ids.ts'
import { NEEDS_RELOAD } from './jobs.ts'
import { isRecord, parseJson } from './json.ts'
import { sanitize } from './sanitize.ts'
import { bytesLabel, partsLabel, whyLocked, whyNoRemove, whyNoUpdate } from './view.ts'

const GLYPH = { on: '●', off: '○', problem: '▲', notable: '◆', ok: '✓', failed: '✗', update: '↑' }

export const APPLY_NOTE = 'Run /reload-plugins (or restart Claude Code) to apply.'

const rowLine = (row: ModRow): string =>
  [
    row.enabled ? GLYPH.on : GLYPH.off,
    sanitize(row.name, { max: 40 }),
    row.version === undefined ? '' : sanitize(row.version, { max: 20 }),
    row.scope ?? row.origin,
    row.enabled ? '' : 'off',
    row.updateTo === undefined ? '' : `${GLYPH.update}${sanitize(row.updateTo, { max: 20 })}`,
    row.problems > 0 ? `${GLYPH.problem}${row.problems}` : '',
    row.notableCount > 0 ? `${GLYPH.notable}${row.notableCount}` : '',
  ]
    .filter(part => part !== '')
    .join('  ')

/** `/mods list`. */
export const listText = (mods: readonly ModRow[], how: { readonly skipped: number }): string => {
  if (mods.length === 0) return 'No mods installed.'
  const on = mods.filter(row => row.enabled).length
  return [
    `${mods.length} ${mods.length === 1 ? 'mod' : 'mods'} (${on} on)`,
    ...mods.map(rowLine),
    ...(how.skipped > 0 ? [`${how.skipped} plugins could not be read.`] : []),
  ].join('\n')
}

/** `/mods info <id>`: what it is, where from, what it can do, by reach. */
export const infoText = (detail: ModDetail): string => {
  const lines: string[] = []
  const name = sanitize(detail.name, { max: 64 })
  lines.push(
    `${name} ${sanitize(detail.version ?? '', { max: 20 })}`.trim(),
    `${sanitize(detail.id, { max: 130 })} · ${detail.scope ?? detail.origin} · ${detail.enabled ? 'on' : 'off'}`,
  )
  if (detail.description !== undefined) lines.push(sanitize(detail.description, { max: 300 }))
  const locked = whyLocked(detail)
  if (locked !== undefined) lines.push(locked)
  if (detail.updateTo !== undefined) {
    lines.push(`${GLYPH.update} ${sanitize(detail.updateTo, { max: 20 })} is available`)
  }
  if (detail.caps !== undefined) {
    const notable = notableOf(detail.caps)
    if (notable.length > 0) {
      lines.push('Notable')
      for (const item of notable)
        lines.push(`  ${GLYPH.notable} ${item.text} (${item.because.join(', ')})`)
    }
    for (const group of groupByReach(detail.caps)) {
      lines.push(group.label)
      for (const item of group.items) lines.push(`  ${item.name}  ${item.line}`)
    }
  }
  if (detail.validate !== undefined) {
    const { errors, warnings } = detail.validate
    lines.push(
      errors === 0 && warnings === 0
        ? `${GLYPH.ok} validate finds nothing wrong`
        : `validate: ${errors} errors, ${warnings} warnings`,
    )
  }
  const parts = detail.mixedCounts === undefined ? '' : partsLabel(detail.mixedCounts)
  if (parts !== '') lines.push(`Also contains: ${parts}`)
  if (detail.dataBytes !== undefined) lines.push(`Data: ${bytesLabel(detail.dataBytes)}`)
  if (detail.root !== undefined) lines.push(`Folder: ${sanitize(detail.root, { max: 300 })}`)
  return lines.join('\n')
}

const TONE_GLYPH = { bad: GLYPH.problem, warn: GLYPH.notable, info: ' ' } as const

/** `/mods doctor`: Health's items as lines, or as JSON for a script. */
export const doctorText = (items: readonly HealthItem[], json: boolean): string => {
  const problems = items.filter(item => item.tone === 'bad').length
  if (json) {
    return JSON.stringify(
      {
        problems,
        items: items.map(item => ({
          group: item.group,
          tone: item.tone,
          text: item.text,
          ...(item.fixLabel === undefined ? {} : { fix: item.fixLabel }),
        })),
      },
      null,
      2,
    )
  }
  const lines = [
    problems === 0
      ? `${GLYPH.ok} Nothing needs you.`
      : `${problems} ${problems === 1 ? 'problem' : 'problems'}`,
  ]
  let group: string | undefined
  for (const item of items) {
    if (item.group !== group) {
      group = item.group
      lines.push(group)
    }
    const fix = item.fixLabel === undefined ? '' : `  (in /mods → Health: ${item.fixLabel})`
    lines.push(`  ${TONE_GLYPH[item.tone]} ${item.text}${fix}`)
  }
  return lines.join('\n')
}

/** One mod an export lists: what `apply` installs again. */
export type Exported = {
  readonly id: string
  readonly scope: ToggleScope
  readonly version?: string
}

/**
 * `/mods export`: the mods the CLI installed (user, project or local scope),
 * `{ mods: [{ id, scope, version }] }`. Managed and launch-command mods aren't
 * the CLI's to install.
 */
export const exportOf = (mods: readonly ModRow[]): { mods: Exported[] } => ({
  mods: mods.flatMap(row => {
    const scope = parseToggleScope(row.scope)
    if (!scope.ok || (row.origin !== 'marketplace' && row.origin !== 'folder-marketplace'))
      return []
    return [
      {
        id: row.id,
        scope: scope.value,
        ...(row.version === undefined ? {} : { version: row.version }),
      },
    ]
  }),
})

/** The most an apply file may ask for at once. */
export const APPLY_MAX = 100

export type ApplyStep =
  | { readonly kind: 'install'; readonly id: PluginId; readonly scope: ToggleScope }
  | { readonly kind: 'enable'; readonly id: PluginId; readonly scope?: ToggleScope }

/**
 * What an apply file asks for against what is installed: an install for each
 * mod missing, an enable for each one off; the rest is already so. Errors name
 * the entries that aren't readable.
 */
export const applyPlan = (
  text: string,
  mods: readonly ModRow[],
): { steps: ApplyStep[]; already: number; errors: string[] } => {
  const value = parseJson(text)
  if (!isRecord(value) || !Array.isArray(value.mods)) {
    return { steps: [], already: 0, errors: ['the file is not { "mods": [{ "id", "scope" }] }'] }
  }
  if (value.mods.length > APPLY_MAX) {
    return { steps: [], already: 0, errors: [`the file lists more than ${APPLY_MAX} mods`] }
  }
  const steps: ApplyStep[] = []
  const errors: string[] = []
  let already = 0
  value.mods.forEach((entry, index) => {
    const id = isRecord(entry) ? parsePluginId(entry.id) : undefined
    const scope = isRecord(entry) ? parseToggleScope(entry.scope ?? 'user') : undefined
    if (id === undefined || !id.ok || scope === undefined || !scope.ok) {
      errors.push(`entry ${index + 1}: an id (name@marketplace) and a scope (user, project, local)`)
      return
    }
    const row = mods.find(item => item.id === id.value)
    if (row === undefined) steps.push({ kind: 'install', id: id.value, scope: scope.value })
    else if (!row.enabled && row.toggleable) {
      const own = parseToggleScope(row.scope)
      steps.push({ kind: 'enable', id: id.value, ...(own.ok ? { scope: own.value } : {}) })
    } else already += 1
  })
  return { steps, already, errors }
}

/** Why a write can't touch this mod, by what it asks; undefined when it can. */
export const whyNot = (
  kind: 'remove' | 'update' | 'enable' | 'disable',
  row: ModRow,
): string | undefined =>
  kind === 'remove' ? whyNoRemove(row) : kind === 'update' ? whyNoUpdate(row) : whyLocked(row)

/**
 * How to accept a declared command a write stopped on: a command that works as
 * given, whichever subcommand stopped (an `apply` too).
 */
const acceptHint = (job: Job, shown: NonNullable<Job['shown']>): string => {
  const id = sanitize(job.target ?? '', { max: 130 })
  if (shown.truncated === true) {
    return `It is longer than modmgr shows: run claude plugin ${job.kind} ${id} in a terminal.`
  }
  if (job.kind !== 'install') {
    return `Review it in /mods (v), or run claude plugin ${job.kind} ${id} in a terminal.`
  }
  const scope =
    job.args?.scope === undefined || job.args.scope === 'user' ? '' : ` --scope ${job.args.scope}`
  return `To run it: /mods install ${id}${scope} --accept-command ${shown.sha256} --yes`
}

const verbOf = (job: Job): string =>
  job.kind === 'marketplace-update' ? 'refresh marketplace' : job.kind

/**
 * How the jobs a write queued ended, one line each, then what applies them.
 * A job stopped on a declared command shows it whole with its sha, and how to
 * accept it.
 */
export const jobsText = (jobs: readonly Job[]): { text: string; failed: boolean } => {
  const lines: string[] = []
  let failed = false
  let owed = false
  for (const job of jobs) {
    const what = `${verbOf(job)} ${sanitize(job.target ?? '', { max: 130 })}`.trim()
    if (job.state === 'ok') {
      const said = job.tail.at(-1)
      lines.push(
        `${GLYPH.ok} ${what}${job.unchanged === true ? ' (already so)' : ''}${said === undefined ? '' : `: ${sanitize(said, { max: 200 })}`}`,
      )
      if (NEEDS_RELOAD.has(job.kind) && job.unchanged !== true) owed = true
      continue
    }
    failed = true
    lines.push(
      `${GLYPH.failed} ${what}: ${sanitize(job.error?.message ?? job.state, { max: 300 })}`,
    )
    if (job.shown !== undefined) {
      lines.push('  It runs this command, shown as the marketplace declares it:')
      for (const line of sanitize(job.shown.command, { max: 4000, multiline: true }).split('\n')) {
        lines.push(`    ${line}`)
      }
      lines.push(`  ${acceptHint(job, job.shown)}`)
    }
  }
  if (owed) lines.push(APPLY_NOTE)
  return { text: lines.join('\n'), failed }
}
