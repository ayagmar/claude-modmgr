// Health: one row per item, grouped by mod (its name on a row
// of its own above its items), worst first, then hook order and modmgr's own
// state, at the body's width. Each item is a Button whose press opens it, its
// fix named after it; every row takes the ring so the arrows walk the list. Words a plugin or the
// debug log supplied are sanitised by domain/health.ts and drawn as Text.

import type { RenderElement } from 'claude-code'
import { type HealthItem, type HealthLine, type HealthTone, healthKey } from '../domain/health.ts'
import { sanitize } from '../domain/sanitize.ts'
import { wrappedRows } from '../domain/view.ts'
import { GLYPH, HiddenRows, Pointer, TONE, type ViewPorts } from './kit.tsx'

const MARK: Readonly<Record<HealthTone, { readonly glyph: string; readonly tone: string }>> = {
  bad: { glyph: GLYPH.problem, tone: TONE.bad },
  warn: { glyph: GLYPH.notable, tone: TONE.warn },
  info: { glyph: ' ', tone: TONE.muted },
}

/** An item's Button: Enter opens it whole. */
const healthButton = (v: ViewPorts, item: HealthItem, focus: boolean): RenderElement => {
  const { Button } = v.el
  return (
    <Button
      key={healthKey(item.key)}
      plain
      label={sanitize(item.text, { max: 300 })}
      {...(focus ? { autoFocus: true as const } : {})}
      onPress={() => v.act.openHealth(item.key)}
    />
  )
}

export const HealthRow = (
  v: ViewPorts,
  item: HealthItem,
  how: {
    readonly columns: number
    readonly focus: boolean
  },
): RenderElement => {
  const { Box, Text } = v.el
  const fix = item.fixLabel === undefined ? undefined : `→ ${item.fixLabel}`
  const text = Math.max(10, how.columns - 4 - (fix === undefined ? 0 : fix.length + 1))
  return (
    <Box key={`line:${item.key}`} flexDirection="row" gap={1}>
      {Pointer(v, how.focus)}
      <Text color={MARK[item.tone].tone}>{MARK[item.tone].glyph}</Text>
      {/* One row per item (the window counts them): the detail has the whole text. */}
      <Box width={text} height={1} flexShrink={1} overflow="hidden">
        {healthButton(v, item, how.focus)}
      </Box>
      {fix === undefined ? null : (
        <Text color={TONE.accent} wrap="truncate-end">
          {fix}
        </Text>
      )}
    </Box>
  )
}

/** The rows `healthLines` chose: each group's name above its items; the items it left out, hidden. */
export const HealthList = (
  v: ViewPorts,
  lines: readonly HealthLine[],
  how: {
    readonly columns: number
    readonly focusKey: string | undefined
    readonly before: readonly HealthItem[]
    readonly after: readonly HealthItem[]
  },
): RenderElement => {
  const { Box, Text } = v.el
  const hidden = (shown: readonly HealthItem[]) =>
    HiddenRows(
      v,
      shown.map(item => healthButton(v, item, false)),
    )
  return (
    <Box flexDirection="column">
      {hidden(how.before)}
      {lines.map((line, index) =>
        line.kind === 'group' ? (
          <Box key={`group:${index}`} paddingLeft={2}>
            <Text bold wrap="truncate-end">
              {line.group}
            </Text>
          </Box>
        ) : (
          HealthRow(v, line.item, {
            columns: how.columns,
            focus: line.item.key === how.focusKey,
          })
        ),
      )}
      {hidden(how.after)}
    </Box>
  )
}

/** The rows the item's detail takes at `columns`. */
export const healthDetailRows = (item: HealthItem | undefined, columns: number): number =>
  item === undefined
    ? 1
    : 2 +
      wrappedRows([sanitize(item.text, { max: 300 })], columns - 2) +
      (item.fixLabel === undefined ? 0 : 2)

/** The item Enter opened, in full: its words wrapped, its fix a button. */
export const HealthItemDetail = (v: ViewPorts, item: HealthItem | undefined): RenderElement => {
  const { Box, Button, Text } = v.el
  if (item === undefined) return <Text dimColor>{GLYPH.ok} Nothing needs you.</Text>
  const label = item.fixLabel
  return (
    <Box flexDirection="column">
      <Text bold>{item.group}</Text>
      <Text> </Text>
      <Box flexDirection="row" gap={1}>
        <Text color={MARK[item.tone].tone}>{MARK[item.tone].glyph}</Text>
        <Text>{sanitize(item.text, { max: 300 })}</Text>
      </Box>
      {label === undefined ? null : <Text> </Text>}
      {label === undefined ? null : (
        <Button key="act:fix" plain label={`→ ${label}`} onPress={() => v.act.fix(item.key)} />
      )}
    </Box>
  )
}
