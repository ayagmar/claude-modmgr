// A least-recently-used map kept as a plain object for `$.store` (PLAN §4):
// JSON objects keep insertion order for string keys, so the first key is the
// oldest. Every operation returns a new object; nothing is mutated.

export type Lru<V> = Readonly<Record<string, V>>

/** Sets `key` as the most recent entry and drops the oldest past `cap`. */
export const lruSet = <V>(map: Lru<V>, key: string, value: V, cap: number): Lru<V> => {
  const { [key]: _old, ...rest } = map
  const next: Record<string, V> = { ...rest, [key]: value }
  const keys = Object.keys(next)
  const excess = keys.length - Math.max(0, cap)
  if (excess <= 0) return next
  for (const old of keys.slice(0, excess)) delete next[old]
  return next
}

/** Sets many entries in one pass (the detector's batched writes). */
export const lruSetMany = <V>(
  map: Lru<V>,
  entries: Iterable<readonly [string, V]>,
  cap: number,
): Lru<V> => {
  let next = map
  for (const [key, value] of entries) next = lruSet(next, key, value, Number.POSITIVE_INFINITY)
  return lruTrim(next, cap)
}

export const lruTrim = <V>(map: Lru<V>, cap: number): Lru<V> => {
  const keys = Object.keys(map)
  const excess = keys.length - Math.max(0, cap)
  if (excess <= 0) return map
  const keep = new Set(keys.slice(excess))
  return Object.fromEntries(Object.entries(map).filter(([key]) => keep.has(key)))
}

/** Reads `key` and marks it most recent. */
export const lruTouch = <V>(map: Lru<V>, key: string): Lru<V> => {
  if (!Object.hasOwn(map, key)) return map
  const value = map[key] as V
  return lruSet(map, key, value, Number.POSITIVE_INFINITY)
}
