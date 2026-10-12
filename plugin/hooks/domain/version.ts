// Claude Code versions: the minimum modmgr is built for and a
// comparison for `x.y.z` strings.

export const MIN_CLAUDE_VERSION = '2.1.292'
/** The oldest session that loads modmgr: the desktop app's pinned one included. */
export const MIN_SESSION_VERSION = '2.1.284'

type Parsed = { readonly core: readonly number[]; readonly pre: readonly string[] }

/** `x.y.z`, with an optional leading `v` and `-prerelease`; text after it (` (Claude Code)`, `+build`) is ignored. */
const parse = (version: string): Parsed | undefined => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(version.trim())
  if (match === null) return undefined
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] === undefined ? [] : match[4].split('.'),
  }
}

/** Semver's prerelease order: none ranks highest, numbers below words, a shorter run first. */
const comparePre = (a: readonly string[], b: readonly string[]): number => {
  if (a.length === 0 || b.length === 0) return b.length - a.length
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const left = a[i] ?? ''
    const right = b[i] ?? ''
    if (left === right) continue
    const leftNumber = /^\d+$/.test(left)
    const rightNumber = /^\d+$/.test(right)
    if (leftNumber && rightNumber) return Number(left) - Number(right)
    if (leftNumber !== rightNumber) return leftNumber ? -1 : 1
    return left < right ? -1 : 1
  }
  return a.length - b.length
}

/** Negative, zero or positive as `a` is older, equal or newer; undefined when either is unreadable. */
export const compareVersions = (a: string, b: string): number | undefined => {
  const left = parse(a)
  const right = parse(b)
  if (left === undefined || right === undefined) return undefined
  for (let i = 0; i < 3; i += 1) {
    const diff = (left.core[i] ?? 0) - (right.core[i] ?? 0)
    if (diff !== 0) return diff
  }
  return comparePre(left.pre, right.pre)
}
