// Health: one row per item, grouped by mod (the name once,
// on its first item), worst first, then hook order and modmgr's own state. An
// item with a fix is a Button whose press runs it, the fix named after it;
// every row takes the ring so the arrows walk the list. Words a plugin or the
// debug log supplied are sanitised by domain/health.ts and drawn as Text.

import type { RenderElement } from 'claude-code'
import { type HealthItem, type HealthTone, healthKey } from '../domain/health.ts'
import { sanitize } from '../domain/sanitize.ts'
import { type Window, wrappedRows } from '../domain/view.ts'
import { GLYPH, Pointer, TONE, type ViewPorts } from './kit.tsx'

const MARK: Readonly<Record<HealthTone, { readonly glyph: string; readonly tone: string }>> = {
  bad: { glyph: GLYPH.problem, tone: TONE.bad },
  warn: { glyph: GLYPH.notable, tone: TONE.warn },
  info: { glyph: ' ', tone: TONE.muted },
}

export const HealthLine = (
  v: ViewPorts,
  item: HealthItem,
  how: {
    readonly columns: number
    readonly focus: boolean
    readonly first: boolean
    /** Stacked: Enter opens the item whole (its row is clipped); split: runs its fix. */
    readonly stacked: boolean
  },
): RenderElement => {
  const { Box, Button, Text } = v.el
  const group = Math.max(8, Math.min(18, Math.floor(how.columns * 0.28)))
  // Beside the list the detail names the fix: the row keeps its room for the words.
  const fix = item.fixLabel === undefined || !how.stacked ? undefined : `→ ${item.fixLabel}`
  const text = Math.max(10, how.columns - 4 - group - 1 - (fix === undefined ? 0 : fix.length + 1))
  return (
    <Box key={`line:${item.key}`} flexDirection="row" gap={1}>
      {Pointer(v, how.focus)}
      <Text color={MARK[item.tone].tone}>{MARK[item.tone].glyph}</Text>
      <Box width={group} flexShrink={0}>
        <Text bold={how.first} dimColor={!how.first} wrap="truncate-end">
          {how.first ? item.group : ''}
        </Text>
      </Box>
      {/* One row per item (the window counts them): the detail has the whole text. */}
      <Box width={text} height={1} flexShrink={1} overflow="hidden">
        <Button
          key={healthKey(item.key)}
          plain
          label={sanitize(item.text, { max: 300 })}
          {...(how.focus ? { autoFocus: true as const } : {})}
          onPress={() => (how.stacked ? v.act.openHealth(item.key) : v.act.fix(item.key))}
        />
      </Box>
      {fix === undefined ? null : (
        <Text color={TONE.accent} wrap="truncate-end">
          {fix}
        </Text>
      )}
    </Box>
  )
}

/** The items in the window (a group's name drawn on its first one shown). */
export const HealthList = (
  v: ViewPorts,
  items: readonly HealthItem[],
  how: {
    readonly columns: number
    readonly window: Window
    readonly focusKey: string | undefined
    readonly stacked: boolean
  },
): RenderElement => {
  const { Box } = v.el
  const shown = items.slice(how.window.start, how.window.end)
  return (
    <Box flexDirection="column">
      {shown.map((item, index) =>
        HealthLine(v, item, {
          columns: how.columns,
          focus: item.key === how.focusKey,
          first: index === 0 || shown[index - 1]?.group !== item.group,
          stacked: how.stacked,
        }),
      )}
    </Box>
  )
}

/** The rows the item's detail takes at `columns`. */
export const healthDetailRows = (item: HealthItem | undefined, columns: number): number =>
  item === undefined
    ? 1
    : wrappedRows([item.group, sanitize(item.text, { max: 300 }), item.fixLabel ?? ''], columns)

/**
 * The selected item in full, its words wrapped: beside the list in the split
 * (where Enter on the row runs the fix), or pushed by Enter when stacked, with
 * its fix as a button (`actions`).
 */
export const HealthItemDetail = (
  v: ViewPorts,
  item: HealthItem | undefined,
  how: { readonly actions: boolean },
): RenderElement => {
  const { Box, Button, Text } = v.el
  if (item === undefined) return <Text dimColor>{GLYPH.ok} Nothing needs you.</Text>
  const label = item.fixLabel
  return (
    <Box flexDirection="column">
      <Text bold>{item.group}</Text>
      <Text>{sanitize(item.text, { max: 300 })}</Text>
      {label === undefined ? null : how.actions ? (
        <Button key="act:fix" plain label={`→ ${label}`} onPress={() => v.act.fix(item.key)} />
      ) : (
        <Text color={TONE.accent}>enter: {label}</Text>
      )}
    </Box>
  )
}
