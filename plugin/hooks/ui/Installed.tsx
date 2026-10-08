// Installed: one row per mod. Rows are plain Buttons (Enter opens
// the detail) windowed around the selection so the arrows always have a drawn
// row to move onto; untrusted names are sanitised and drawn as Text.

import type { RenderElement } from 'claude-code'
import type { ModRow, View } from '../../types/index.d.ts'
import { sanitize } from '../domain/sanitize.ts'
import { rowKey, type Window, whyLocked } from '../domain/view.ts'
import { GLYPH, Pointer, TONE, type ViewPorts } from './kit.tsx'

/** Cells kept for the flags at a row's end (`→ off ▲2 ◆3`). */
const FLAGS = 16

export type RowColumns = { readonly name: number; readonly meta: boolean }

/**
 * How a row spends its width: name, version and scope from 60 columns; below
 * (a split's list, a narrow dock) the name and its flags alone. Fixed widths,
 * so nothing reflows as rows change.
 */
export const rowColumns = (columns: number): RowColumns =>
  columns >= 60
    ? { name: Math.max(12, Math.min(40, columns - 4 - 11 - 9 - FLAGS)), meta: true }
    : { name: Math.max(8, columns - 4 - FLAGS), meta: false }

const flagsOf = (row: ModRow): { text: string; color?: string }[] => {
  const flags: { text: string; color?: string }[] = []
  if (!row.enabled) flags.push({ text: 'off' })
  if (whyLocked(row) !== undefined) flags.push({ text: GLYPH.locked })
  if (row.updateTo !== undefined)
    flags.push({
      text: `${GLYPH.update}${sanitize(row.updateTo, { max: 8 })}`,
      color: TONE.accent,
    })
  if (row.problems > 0) flags.push({ text: `${GLYPH.problem}${row.problems}`, color: TONE.bad })
  if (row.notableCount > 0)
    flags.push({ text: `${GLYPH.notable}${row.notableCount}`, color: TONE.accent })
  // An update added notable capabilities the person hasn't seen.
  if (row.capsNew !== undefined) flags.push({ text: 'new', color: TONE.warn })
  return flags
}

export const Row = (
  v: ViewPorts,
  row: ModRow,
  how: {
    readonly view: View
    readonly staged: ReadonlySet<string>
    readonly columns: number
    readonly focus: boolean
  },
): RenderElement => {
  const { Box, Button, Text } = v.el
  // Only an entry that still changes the row is drawn.
  const staged = how.staged.has(row.id) ? how.view.staged[row.id] : undefined
  const cols = rowColumns(how.columns)
  const name = sanitize(row.name, { max: cols.name })
  return (
    <Box key={`line:${row.id}`} flexDirection="row" gap={1}>
      {Pointer(v, how.focus)}
      <Text color={row.enabled ? TONE.ok : TONE.muted}>{row.enabled ? GLYPH.on : GLYPH.off}</Text>
      <Box width={cols.name} flexShrink={0}>
        <Button
          key={rowKey(row.id)}
          plain
          label={name}
          {...(how.focus ? { autoFocus: true as const } : {})}
          onPress={() => v.act.open(row.id)}
        />
      </Box>
      {cols.meta ? (
        <Box width={10} flexShrink={0}>
          <Text dimColor wrap="truncate-end">
            {row.version === undefined ? '' : sanitize(row.version, { max: 10 })}
          </Text>
        </Box>
      ) : null}
      {cols.meta ? (
        <Box width={8} flexShrink={0}>
          <Text dimColor wrap="truncate-end">
            {row.scope ?? row.origin}
          </Text>
        </Box>
      ) : null}
      {/* One line, cut at the frame in the worst case. */}
      <Box flexDirection="row" gap={1} flexShrink={1} height={1} overflow="hidden">
        {staged === undefined ? null : <Text color={TONE.warn}>→ {staged ? 'on' : 'off'}</Text>}
        {flagsOf(row).map(flag =>
          flag.color === undefined ? (
            <Text dimColor>{flag.text}</Text>
          ) : (
            <Text color={flag.color}>{flag.text}</Text>
          ),
        )}
      </Box>
    </Box>
  )
}

/** The list's rows in the window, or the empty state's line. */
export const List = (
  v: ViewPorts,
  rows: readonly ModRow[],
  how: {
    readonly view: View
    readonly staged: ReadonlySet<string>
    readonly columns: number
    readonly window: Window
    /** The row the ring starts on when the pane takes the keys. */
    readonly focusId: string | undefined
    readonly loading: boolean
    readonly total: number
  },
): RenderElement => {
  const { Box, Text } = v.el
  if (rows.length === 0) {
    const line = how.loading
      ? 'Reading your plugins…'
      : how.total === 0
        ? 'No mods installed yet. Mods are plugins that hook into Claude Code; Discover (2) finds them.'
        : `No mod matches "${sanitize(how.view.query, { max: 40 })}". Esc clears the filter.`
    return (
      <Box flexDirection="column">
        <Text dimColor>{line}</Text>
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      {rows.slice(how.window.start, how.window.end).map(row =>
        Row(v, row, {
          view: how.view,
          staged: how.staged,
          columns: how.columns,
          focus: row.id === how.focusId,
        }),
      )}
    </Box>
  )
}
