// Chain-order notes (PLAN §2.5, R5). Only two events are worth a note: both
// rewrite what the model reads, and the order they run in decides the result.

export const CHAIN_EVENTS = {
  'prompt.compose': 'rewrite the system prompt',
  'session.append': 'rewrite each row the conversation keeps',
} as const
export type ChainEvent = keyof typeof CHAIN_EVENTS

export type ChainMod = {
  readonly id: string
  readonly name: string
  readonly enabled: boolean
  readonly events: readonly string[]
}

export type ChainNote = {
  readonly event: ChainEvent
  /** Mod names in the order their hooks run. */
  readonly order: string[]
  readonly text: string
}

const joinOrder = (names: readonly string[]): string =>
  names.length <= 2
    ? names.join(' then ')
    : `${names.slice(0, -1).join(', ')} then ${names[names.length - 1]}`

/**
 * One note per chain event that two or more enabled mods hook, given the mods
 * in load order (F3: `enabledPlugins` key order).
 */
export const chainNotes = (modsInLoadOrder: readonly ChainMod[]): ChainNote[] =>
  (Object.keys(CHAIN_EVENTS) as ChainEvent[]).flatMap(event => {
    const order = modsInLoadOrder
      .filter(mod => mod.enabled && mod.events.includes(event))
      .map(mod => mod.name)
    if (order.length < 2) return []
    return [{ event, order, text: `${joinOrder(order)} ${CHAIN_EVENTS[event]} (${event}).` }]
  })
