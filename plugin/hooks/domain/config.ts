// modmgr's `userConfig` (plugin.json) read from `register(on, options)`. The
// engine validates the values against the manifest; this reads them again so a
// missing or mistyped one falls back to the default instead of reaching a timer.

export type Config = {
  /** Hours between update checks; 0 turns them off. */
  readonly updateCheckHours: number
  readonly detectRemote: boolean
  readonly debugTimings: boolean
}

export const DEFAULT_CONFIG: Config = {
  updateCheckHours: 6,
  detectRemote: true,
  debugTimings: false,
}

const MAX_HOURS = 168

export const parseConfig = (options: Readonly<Record<string, unknown>>): Config => {
  const hours = options.updateCheckHours
  const detect = options.detectRemote
  const timings = options.debugTimings
  return {
    updateCheckHours:
      typeof hours === 'number' && Number.isFinite(hours)
        ? Math.min(MAX_HOURS, Math.max(0, hours))
        : DEFAULT_CONFIG.updateCheckHours,
    detectRemote: typeof detect === 'boolean' ? detect : DEFAULT_CONFIG.detectRemote,
    debugTimings: typeof timings === 'boolean' ? timings : DEFAULT_CONFIG.debugTimings,
  }
}

/**
 * `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is on when set to anything but
 * empty, `0` or `false`: when unsure, modmgr stays off the network.
 */
export const trafficOff = (value: string | undefined): boolean => {
  const text = value?.trim().toLowerCase() ?? ''
  return text !== '' && text !== '0' && text !== 'false'
}
