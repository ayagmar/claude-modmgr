export type TurnBandAt = number

declare module 'claude-code' {
  interface PluginState {
    'turn-band': { at: TurnBandAt }
  }
}
