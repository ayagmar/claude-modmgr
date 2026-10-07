// Small shape checks for JSON from outside (the CLI, GitHub, the store).
// Each reader answers `undefined` for a missing or mistyped field.

export type JsonRecord = Readonly<Record<string, unknown>>

export const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const str = (record: JsonRecord, key: string): string | undefined => {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

export const num = (record: JsonRecord, key: string): number | undefined => {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export const bool = (record: JsonRecord, key: string): boolean | undefined => {
  const value = record[key]
  return typeof value === 'boolean' ? value : undefined
}

export const rec = (record: JsonRecord, key: string): JsonRecord | undefined => {
  const value = record[key]
  return isRecord(value) ? value : undefined
}

export const arr = (record: JsonRecord, key: string): readonly unknown[] | undefined => {
  const value = record[key]
  return Array.isArray(value) ? value : undefined
}

export const strings = (values: readonly unknown[] | undefined): string[] =>
  (values ?? []).filter((value): value is string => typeof value === 'string')

export const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/**
 * Copies `fields` into a new object, leaving out the ones that are undefined,
 * so the result fits `exactOptionalPropertyTypes`.
 */
export const compact = <T extends Record<string, unknown>>(fields: T): Compact<T> => {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) out[key] = value
  }
  return out as Compact<T>
}

type UndefinedKeys<T> = { [K in keyof T]-?: undefined extends T[K] ? K : never }[keyof T]
export type Compact<T> = { [K in Exclude<keyof T, UndefinedKeys<T>>]: T[K] } & {
  [K in UndefinedKeys<T>]?: Exclude<T[K], undefined>
}
