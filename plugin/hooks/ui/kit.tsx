// What every view draws with: the surface's element table, state reads
// and the actions, never `$`. Theme keys and glyphs are fixed (the theme has
// no `accent` or `muted` keys: `claude` and `subtle` stand in); hotkeys come
// only from domain/keymap.ts.

import type { Color, Elements, RenderElement, RenderSurface, UiPressArgument } from 'claude-code'
import { hotkeyFor, type KeySurface } from '../domain/keymap.ts'
import type { StatePort } from '../ports.ts'
import type { Actions } from '../services/actions.ts'

/** The elements every surface has, plus `Input` where the surface takes typing (not mobile). */
export type El = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'> & {
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
  const { Text } = v.el
  return on ? <Text color={TONE.accent}>❯</Text> : <Text> </Text>
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
  return <Text dimColor>{'─'.repeat(Math.max(0, columns))}</Text>
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

/** A part of a detail: what it draws, and the rows that takes. */
export type Section = { readonly rows: number; readonly el: RenderElement }

/** The rows `sections` take, a blank row apart when `spaced`. */
export const sectionRows = (sections: readonly Section[], spaced: boolean): number =>
  sections.reduce((sum, section) => sum + section.rows, 0) +
  (spaced ? Math.max(0, sections.length - 1) : 0)

/** `sections` as one column, a blank row apart when `spaced`. */
export const Sections = (
  v: ViewPorts,
  sections: readonly Section[],
  spaced: boolean,
): RenderElement => {
  const { Box, Text } = v.el
  return (
    <Box flexDirection="column">
      {sections.flatMap((section, index) =>
        spaced && index > 0 ? [<Text key={`gap:${index}`}> </Text>, section.el] : [section.el],
      )}
    </Box>
  )
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
    <Box flexDirection="row" gap={1}>
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
