import { describe, expect, it } from 'vitest'
import { chainNotes } from '../../plugin/hooks/domain/chain.ts'
import {
  BINDINGS,
  type Binding,
  collisions,
  helpFor,
  hotkeyFor,
  invalidHotkeys,
  MOUNT_SETS,
  SURFACES,
} from '../../plugin/hooks/domain/keymap.ts'

describe('keymap', () => {
  it('has no collisions in any set of surfaces mounted together', () => {
    expect(collisions()).toEqual([])
  })

  it('has hotkeys of one digit or lowercase letter, letters only on the band', () => {
    expect(invalidHotkeys()).toEqual([])
  })

  it('detects collisions and bad hotkeys', () => {
    const bad: Binding[] = [
      { action: 'a', hotkey: 'x', label: 'a', on: ['installed'] },
      { action: 'b', hotkey: 'x', label: 'b', on: ['detail'] },
      { action: 'c', hotkey: '1', label: 'c', on: ['band'] },
      { action: 'd', hotkey: 'X', label: 'd', on: ['pane'] },
    ]
    expect(collisions(bad, [['pane', 'installed', 'detail']])).toEqual([
      { hotkey: 'x', actions: ['a', 'b'], set: 'pane+installed+detail' },
    ])
    expect(invalidHotkeys(bad).map(binding => binding.action)).toEqual(['c', 'd'])
  })

  it('covers every surface in some mount set and binds something on each', () => {
    for (const surface of SURFACES) {
      expect(MOUNT_SETS.some(set => set.includes(surface))).toBe(true)
      // Help draws the keymap and has no hotkeys of its own.
      if (surface !== 'help')
        expect(BINDINGS.some(binding => binding.on.includes(surface))).toBe(true)
    }
  })

  it('finds hotkeys by action and surface', () => {
    expect(hotkeyFor('toggle', 'installed')).toBe('e')
    expect(hotkeyFor('reload', 'band')).toBe('l')
    expect(hotkeyFor('install', 'installed')).toBeUndefined()
    expect(hotkeyFor('move', 'pane')).toBeUndefined()
  })

  it('generates help: engine keys first, one row per action', () => {
    const rows = helpFor(['pane', 'installed', 'detail'])
    expect(rows[0]).toEqual({ key: '↑↓ tab', label: 'move' })
    expect(rows.filter(row => row.label === 'enable/disable')).toHaveLength(1)
    expect(rows.map(row => row.key)).toContain('s')
    expect(rows.map(row => row.key)).not.toContain('i')
  })
})

describe('chainNotes', () => {
  const mod = (name: string, events: string[], enabled = true) => ({
    id: `${name}@m`,
    name,
    enabled,
    events,
  })

  it('notes events two or more enabled mods hook, in load order', () => {
    const notes = chainNotes([
      mod('redactor', ['session.append', 'prompt.compose']),
      mod('turn-band', ['prompt.submit']),
      mod('summariser', ['session.append']),
      mod('off', ['session.append'], false),
      mod('third', ['session.append']),
    ])
    expect(notes).toEqual([
      {
        event: 'session.append',
        order: ['redactor', 'summariser', 'third'],
        text: 'redactor, summariser then third rewrite each row the conversation keeps (session.append).',
      },
    ])
  })

  it('joins two names with "then" and is empty when alone', () => {
    const notes = chainNotes([mod('a', ['prompt.compose']), mod('b', ['prompt.compose'])])
    expect(notes[0]?.text).toBe('a then b rewrite the system prompt (prompt.compose).')
    expect(chainNotes([mod('a', ['prompt.compose'])])).toEqual([])
  })
})
