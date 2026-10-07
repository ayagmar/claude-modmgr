// `/mods`: the bare command opens the dialog (PLAN §5.2); `/mods list`, and
// a session that places no panes, answer as text. The full set of subcommands
// (PLAN §2.7) comes in M6. A command never runs a job or a reload (F29): it
// opens the pane or reads `$.state`, and answers.

import type { ModRow } from '../../types/index.d.ts'
import { sanitize } from '../domain/sanitize.ts'
import { paneOpen } from '../domain/view.ts'
import type { Ports } from '../ports.ts'

export type CommandAnswer = { text?: string; exitCode?: number }

const GLYPH = { on: '●', off: '○', problem: '▲', notable: '◆' } as const

const rowLine = (row: ModRow): string => {
  const parts = [
    row.enabled ? GLYPH.on : GLYPH.off,
    sanitize(row.name, { max: 40 }),
    row.version === undefined ? '' : sanitize(row.version, { max: 20 }),
    row.scope ?? row.origin,
    row.enabled ? '' : 'off',
    row.problems > 0 ? `${GLYPH.problem}${row.problems}` : '',
    row.notableCount > 0 ? `${GLYPH.notable}${row.notableCount}` : '',
  ]
  return parts.filter(part => part !== '').join('  ')
}

export const USAGE = 'Usage: /mods [list]'

export const modsCommand = async (
  ports: Pick<Ports, 'state' | 'ui'>,
  args: string,
): Promise<CommandAnswer> => {
  const sub = args.trim().split(/\s+/)[0] ?? ''
  if (sub !== '' && sub !== 'list')
    return { text: `${USAGE}\nUnknown subcommand: ${sanitize(sub, { max: 40 })}`, exitCode: 2 }
  if (sub === '') {
    const opened = await openDialog(ports)
    if (opened) return {}
  }
  return listText(ports)
}

/** Opens the dialog; false when this session places no panes (a `-p` run, an older host). */
const openDialog = async (ports: Pick<Ports, 'state' | 'ui'>): Promise<boolean> => {
  try {
    const [mods, queue] = await Promise.all([ports.state.read('mods'), ports.state.read('queue')])
    const busy = queue.jobs.some(job => job.state === 'running' || job.state === 'queued')
    const opened = await ports.ui.open(paneOpen({ focus: true, hold: !busy, mods: mods.length }))
    return opened.isPlaced
  } catch {
    return false
  }
}

const listText = async (ports: Pick<Ports, 'state'>): Promise<CommandAnswer> => {
  const [mods, sync, degraded] = await Promise.all([
    ports.state.read('mods'),
    ports.state.read('sync'),
    ports.state.read('degraded'),
  ])
  const lines: string[] = []
  if (degraded.reason !== undefined) lines.push(degraded.reason)
  if (mods.length === 0) {
    lines.push(
      sync.refreshing || sync.at === undefined
        ? 'modmgr is reading your plugins; try again in a moment.'
        : 'No mods installed.',
    )
    return { text: lines.join('\n') }
  }
  const on = mods.filter(row => row.enabled).length
  lines.push(`${mods.length} mods (${on} on)${sync.refreshing ? ' ↻' : ''}`)
  lines.push(...mods.map(rowLine))
  if (sync.skipped > 0) lines.push(`${sync.skipped} plugins could not be read.`)
  return { text: lines.join('\n') }
}
