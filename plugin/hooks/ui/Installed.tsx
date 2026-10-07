// Installed: one row per mod (PLAN §5.3). Rows are plain Buttons (Enter opens
// the detail) windowed around the selection so the arrows always have a drawn
// row to move onto; untrusted names are sanitised and drawn as Text.

import type { RenderElement } from 'claude-code'
import type { ModRow, View } from '../../types/index.d.ts'
import { sanitize } from '../domain/sanitize.ts'
import { rowKey, type Window, whyLocked } from '../domain/view.ts'
import { GLYPH, TONE, type ViewPorts } from './kit.tsx'

/** Cells a row spends outside its name: glyph, version, scope, flags and the gaps. */
const FIXED = 2 + 11 + 9 + 12

export const nameWidth = (columns: number): number => Math.max(12, Math.min(40, columns - FIXED))

const flagsOf = (row: ModRow): { text: string; color?: string }[] => {
  const flags: { text: string; color?: string }[] = []
  if (!row.enabled) flags.push({ text: 'off' })
  if (whyLocked(row) !== undefined) flags.push({ text: GLYPH.locked })
  if (row.updateTo !== undefined)
    flags.push({
      text: `${GLYPH.update}${sanitize(row.updateTo, { max: 12 })}`,
      color: TONE.accent,
    })
  if (row.problems > 0) flags.push({ text: `${GLYPH.problem}${row.problems}`, color: TONE.bad })
  if (row.notableCount > 0)
    flags.push({ text: `${GLYPH.notable}${row.notableCount}`, color: TONE.accent })
  return flags
}

export const Row = (
  v: ViewPorts,
  row: ModRow,
  how: { readonly view: View; readonly columns: number },
): RenderElement => {
  const { Box, Button, Text } = v.el
  const staged = how.view.staged[row.id]
  const width = nameWidth(how.columns)
  const name = sanitize(row.name, { max: width })
  return (
    <Box key={`line:${row.id}`} flexDirection="row" gap={1}>
      <Text color={row.enabled ? TONE.ok : TONE.muted}>{row.enabled ? GLYPH.on : GLYPH.off}</Text>
      <Box width={width}>
        <Button key={rowKey(row.id)} plain label={name} onPress={() => v.act.open(row.id)} />
      </Box>
      <Box width={10}>
        <Text dimColor wrap="truncate-end">
          {row.version === undefined ? '' : sanitize(row.version, { max: 10 })}
        </Text>
      </Box>
      <Box width={8}>
        <Text dimColor wrap="truncate-end">
          {row.scope ?? row.origin}
        </Text>
      </Box>
      {staged === undefined ? null : <Text color={TONE.warn}>→ {staged ? 'on' : 'off'}</Text>}
      {flagsOf(row).map(flag =>
        flag.color === undefined ? (
          <Text dimColor>{flag.text}</Text>
        ) : (
          <Text color={flag.color}>{flag.text}</Text>
        ),
      )}
    </Box>
  )
}

/** The list's rows in the window, or the empty state's line. */
export const List = (
  v: ViewPorts,
  rows: readonly ModRow[],
  how: {
    readonly view: View
    readonly columns: number
    readonly window: Window
    readonly loading: boolean
    readonly total: number
  },
): RenderElement => {
  const { Box, Text } = v.el
  if (rows.length === 0) {
    const line = how.loading
      ? 'Reading your plugins…'
      : how.total === 0
        ? 'No mods installed. Mods are plugins with a hooks module; Discover (coming soon) finds them.'
        : `No mod matches "${sanitize(how.view.query, { max: 40 })}". Esc clears the filter.`
    return (
      <Box flexDirection="column">
        <Text dimColor>{line}</Text>
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      {rows
        .slice(how.window.start, how.window.end)
        .map(row => Row(v, row, { view: how.view, columns: how.columns }))}
    </Box>
  )
}
