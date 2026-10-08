// Claude Code versions: the minimum modmgr is built for and a
// comparison for `x.y.z` strings.

export const MIN_CLAUDE_VERSION = '2.1.292'

const parts = (version: string): number[] | undefined => {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim())
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** Negative, zero or positive as `a` is older, equal or newer; undefined when either is unreadable. */
export const compareVersions = (a: string, b: string): number | undefined => {
  const left = parts(a)
  const right = parts(b)
  if (left === undefined || right === undefined) return undefined
  for (let i = 0; i < 3; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}
