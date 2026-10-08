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
}

export const GLYPH = {
  on: '●',
  off: '○',
  update: '↑',
  problem: '▲',
  notable: '◆',
  hooks: '◇',
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

/** A dim rule across `columns`. */
export const Rule = (v: ViewPorts, columns: number): RenderElement => {
  const { Text } = v.el
  return <Text dimColor>{'─'.repeat(Math.max(0, columns))}</Text>
}

/** A bold section heading. */
export const Heading = (v: ViewPorts, text: string): RenderElement => {
  const { Text } = v.el
  return <Text bold>{text}</Text>
}

/** Fire-and-forget for a press handler: the action catches its own failures. */
export const run =
  (fn: () => Promise<void>): (() => void) =>
  () => {
    void fn()
  }
