// Timings for PLAN §6's budgets (M6, `docs/PERF.md`): with `userConfig.debugTimings`
// on, each measured step writes one debug-log line (`--debug`); off, nothing.
// `performance.now()` is a hooks-module global (d.ts globals), so measuring
// costs no host round trip.

/** Says how long a step took since `started` (a `performance.now()` reading). */
export type Timing = (label: string, started: number) => void

export const NO_TIMING: Timing = () => {}

export const timingOf = (on: boolean, debug: (text: string) => void): Timing =>
  on
    ? (label, started) =>
        debug(`modmgr: timing ${label} ${(performance.now() - started).toFixed(1)} ms`)
    : NO_TIMING

/** Runs `step`, then says how long it took. */
export const timed = async <T>(
  timing: Timing,
  label: string,
  step: () => Promise<T>,
): Promise<T> => {
  const started = performance.now()
  try {
    return await step()
  } finally {
    timing(label, started)
  }
}
