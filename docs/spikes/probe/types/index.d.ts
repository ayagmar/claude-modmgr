export type ProbeLine = string
declare module 'claude-code' {
  interface PluginState {
    probe: { starts: number; lines: ProbeLine[] }
  }
}
