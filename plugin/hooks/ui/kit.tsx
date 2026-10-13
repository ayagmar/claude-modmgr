// What every view draws with: the surface's element table, state reads
// and the actions, never `$`. Theme keys and glyphs are fixed (the theme has
// no `accent` or `muted` keys: `claude` and `subtle` stand in); hotkeys come
// only from domain/keymap.ts.

import type { Color, Elements, RenderElement, RenderSurface, UiPressArgument } from 'claude-code'
import { hotkeyFor, type KeySurface } from '../domain/keymap.ts'
import { sanitize } from '../domain/sanitize.ts'
import { footerRowsFor, lineWindow, wrappedRows } from '../domain/view.ts'
import type { StatePort } from '../ports.ts'
import type { Actions } from '../services/actions.ts'

/** The elements every surface has, plus `Input` where the surface takes typing (not mobile). */
export type El = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Link'> & {
  readonly Input?: Elements['terminal']['Input']
  /** A one-of-several picker, where the surface takes typing (not mobile). */
  readonly Select?: Elements['terminal']['Select']
}

export type ViewPorts = {
  readonly el: El
  readonly surface: RenderSurface
  readonly read: StatePort['read']
  readonly act: Actions
  /** modmgr's own folder (`$.plugin.root`): its own detail says why it needs what it can do. */
  readonly ownRoot: string
}

export const GLYPH = {
  on: '●',
  off: '○',
  update: '↑',
  problem: '▲',
  notable: '◆',
  ok: '✓',
  failed: '✗',
  locked: '⊘',
  stale: '↻',
} as const

/** The theme keys modmgr uses: one accent, quiet metadata, three tones. */
export const TONE = {
  accent: 'claude',
  muted: 'subtle',
  ok: 'success',
  warn: 'warning',
  bad: 'error',
} as const satisfies Record<string, Color>

/**
 * A plain Button for a keymap action: drawn `e: toggle` on the terminal, its
 * hotkey from the keymap (a binding missing from the surface draws no hotkey).
 */
export const KeyButton = (
  v: ViewPorts,
  props: {
    readonly action: string
    readonly on: KeySurface
    readonly label: string
    /** Gets the press: `press.surface` is where it came from (a copy targets that surface). */
    readonly onPress: (press: UiPressArgument) => void
    readonly dim?: boolean
  },
): RenderElement => {
  const { Button } = v.el
  const hotkey = hotkeyFor(props.action, props.on)
  return (
    <Button
      key={`act:${props.action}`}
      plain
      label={props.label}
      {...(hotkey === undefined ? {} : { hotkey })}
      {...(props.dim === true ? { dimColor: true } : {})}
      onPress={props.onPress}
    />
  )
}

/** The selection's mark at a row's start: drawn whether or not the pane holds the keys. */
export const Pointer = (v: ViewPorts, on: boolean): RenderElement => {
  const { Box, Text } = v.el
  // One cell wide whatever it holds: a desktop's proportional font draws ❯
  // wider than a space, which pushed the selected row out of line.
  return (
    <Box width={1} flexShrink={0}>
      {on ? <Text color={TONE.accent}>❯</Text> : <Text> </Text>}
    </Box>
  )
}

/** What a list row's Button names and does: open its detail, or select it. */
export type ListItem = {
  readonly key: string
  readonly label: string
  readonly open: () => Promise<void>
  readonly select: () => Promise<void>
}

/**
 * A list row's Button: its name. Pressed, the selected row opens its detail,
 * and beside the detail another row is selected first: the terminal's ring
 * selects a row as it lands on it, so Enter opens, and a click selects, then opens.
 */
export const ListButton = (
  v: ViewPorts,
  item: ListItem,
  how: { readonly max: number; readonly focus: boolean; readonly beside: boolean },
): RenderElement => {
  const { Button } = v.el
  return (
    <Button
      key={item.key}
      plain
      label={sanitize(item.label, { max: how.max })}
      {...(how.focus ? { autoFocus: true as const } : {})}
      onPress={() => (how.beside && !how.focus ? item.select() : item.open())}
    />
  )
}

/**
 * A list's rows above or below its window, as hidden Buttons. The terminal's
 * ring keeps its place by position among a site's stops: were these rows left
 * out, a window scrolled by the selection would slide another row under the
 * ring. Kept, every row stays a stop in the same order, and an arrow onto a
 * hidden one selects it, which scrolls it into view.
 */
export const HiddenRows = (
  v: ViewPorts,
  buttons: readonly RenderElement[],
): RenderElement | null => {
  const { Box } = v.el
  return buttons.length === 0 ? null : (
    <Box display="none" flexDirection="column">
      {buttons}
    </Box>
  )
}

/** A dim rule across `columns`. */
export const Rule = (v: ViewPorts, columns: number): RenderElement => {
  const { Text } = v.el
  // Cut, not wrapped: a desktop's glyph is wider than its cell.
  return (
    <Text dimColor wrap="truncate-end">
      {'─'.repeat(Math.max(0, columns))}
    </Text>
  )
}

/** A section heading: bold, in the accent the tab title has. */
export const Heading = (v: ViewPorts, text: string): RenderElement => {
  const { Text } = v.el
  return (
    <Text bold color={TONE.accent}>
      {text}
    </Text>
  )
}

/**
 * A line of an overlay or a detail and its text, from which the rows it wraps
 * to are counted; `rows` where those are known (a truncated row, a block
 * whose rows were counted where it was built).
 */
export type Line = { readonly el: RenderElement; readonly text: string; readonly rows?: number }

/** A line of `rows` rows, counted where it was built. */
export const line = (el: RenderElement, rows = 1): Line => ({ el, text: '', rows })

/**
 * Facts a ` · ` apart, wrapping between them so none is cut at the edge: dim,
 * or in `color` where the line says how things stand.
 */
export const factsLine = (
  v: Pick<ViewPorts, 'el'>,
  facts: readonly string[],
  columns: number,
  color?: Color,
): Line => {
  const { Box, Text } = v.el
  const shown = facts.map((fact, at) => (at < facts.length - 1 ? `${fact} ·` : fact))
  return line(
    <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      {shown.map((text, at) => (
        <Text key={`${at}`} {...(color === undefined ? { dimColor: true } : { color })}>
          {text}
        </Text>
      ))}
    </Box>,
    footerRowsFor(
      shown.map(text => [...text].length),
      columns,
      1,
    ),
  )
}

/** A part of a detail: its lines, which a detail too tall for its window scrolls by. */
export type Section = { readonly lines: readonly Line[] }

/** A detail as lines, and how many of the first its head takes: kept in view when it scrolls. */
export type DetailLines = { readonly lines: readonly Line[]; readonly head: number }

/** `sections` as lines, a blank line apart when `spaced`. */
export const sectionLines = (
  v: ViewPorts,
  sections: readonly Section[],
  spaced: boolean,
): Line[] => {
  const { Text } = v.el
  return sections.flatMap((section, index) =>
    spaced && index > 0
      ? [line(<Text key={`gap:${index}`}> </Text>), ...section.lines]
      : section.lines,
  )
}

/** The rows `sections` take, a blank row apart when `spaced`. */
export const sectionRows = (sections: readonly Section[], spaced: boolean): number =>
  sections.reduce(
    (sum, section) => sum + section.lines.reduce((rows, item) => rows + (item.rows ?? 1), 0),
    0,
  ) + (spaced ? Math.max(0, sections.length - 1) : 0)

/** `lines` as one column. */
export const Lines = (v: ViewPorts, lines: readonly Line[]): RenderElement => {
  const { Box } = v.el
  return <Box flexDirection="column">{lines.map(item => item.el)}</Box>
}

/** The rows an overlay is given, and the first line below what it keeps it shows. */
export type OverlayWindow = { readonly rows: number; readonly columns: number; readonly at: number }

/** An overlay drawn, its rows, the lines a page key moves, and the furthest line it scrolls to. */
export type DrawnOverlay = {
  readonly el: RenderElement
  readonly rows: number
  readonly page: number
  readonly last: number
}

/**
 * Lines in their window: whole when they fit, else the first `head` and last
 * `foot` lines kept, the lines from `at` between them that fit, and a row
 * saying where it stands. Every line is reachable, never clipped out of sight.
 */
export const scrolled = (
  v: ViewPorts,
  lines: readonly Line[],
  keep: { readonly head: number; readonly foot: number },
  window: OverlayWindow,
): DrawnOverlay => {
  const { Box, Text } = v.el
  const rowsOf = (line: Line) => line.rows ?? wrappedRows([line.text], window.columns)
  const sum = (some: readonly Line[]) => some.reduce((total, line) => total + rowsOf(line), 0)
  const head = lines.slice(0, keep.head)
  const rest = lines.slice(keep.head, lines.length - keep.foot)
  const foot = lines.slice(lines.length - keep.foot)
  const total = sum(lines)
  if (total <= window.rows) {
    return {
      el: <Box flexDirection="column">{lines.map(line => line.el)}</Box>,
      rows: total,
      page: rest.length,
      last: 0,
    }
  }
  const kept = sum(head) + sum(foot) + 1
  const heights = rest.map(rowsOf)
  const shown = lineWindow(heights, Math.max(1, window.rows - kept), window.at)
  const where = `lines ${shown.start + 1}–${shown.end} of ${rest.length} · scroll or Page Up/Down`
  return {
    el: (
      <Box flexDirection="column">
        {head.map(line => line.el)}
        {rest.slice(shown.start, shown.end).map(line => line.el)}
        <Text dimColor wrap="truncate-end">
          {where}
        </Text>
        {foot.map(line => line.el)}
      </Box>
    ),
    rows: kept + heights.slice(shown.start, shown.end).reduce((total, rows) => total + rows, 0),
    page: Math.max(1, shown.end - shown.start),
    last: shown.last,
  }
}

/** A label column `width` cells wide, then `children`: one aligned row of a table. */
export const LabelRow = (
  v: ViewPorts,
  label: string,
  width: number,
  children: RenderElement | readonly RenderElement[],
): RenderElement => {
  const { Box, Text } = v.el
  return (
    <Box flexDirection="row" gap={1} alignItems="flex-start">
      <Box width={width} flexShrink={0}>
        <Text dimColor wrap="truncate-end">
          {label}
        </Text>
      </Box>
      {children}
    </Box>
  )
}

/** Fire-and-forget for a press handler: the action catches its own failures. */
export const run =
  (fn: () => Promise<void>): (() => void) =>
  () => {
    void fn()
  }
