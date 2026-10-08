// Bounded concurrency for background work (validate runs).

/** Runs `work` over `items`, at most `limit` at once; results keep the items' order. */
export const mapLimit = async <T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array(items.length)
  let next = 0
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await work(items[index] as T, index)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane))
  return results
}
