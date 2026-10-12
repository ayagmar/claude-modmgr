// Result values and modmgr's error kinds. Nothing in modmgr throws
// across a layer boundary: a failure is an `Err` with one of these kinds.

export type Ok<T> = { readonly ok: true; readonly value: T }
export type Err<E> = { readonly ok: false; readonly error: E }
export type Result<T, E = ModmgrError> = Ok<T> | Err<E>

export type ErrorKind =
  | 'cli-failed'
  | 'timeout'
  | 'parse'
  | 'network'
  | 'rate-limited'
  | 'rejected'
  | 'unavailable'
  | 'conflict'
  | 'store-full'
  | 'invalid'

export type ModmgrError = {
  readonly kind: ErrorKind
  /** What went wrong, in modmgr's words or the CLI's (sanitised before display). */
  readonly message: string
  /** The CLI's `failureCode`, when there is one. */
  readonly code?: string
}

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value })
export const err = <E>(error: E): Err<E> => ({ ok: false, error })

export const fail = (kind: ErrorKind, message: string, code?: string): Err<ModmgrError> =>
  err(code === undefined ? { kind, message } : { kind, message, code })

export const map = <T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> =>
  result.ok ? ok(fn(result.value)) : result

export const andThen = <T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> => (result.ok ? fn(result.value) : result)

export const unwrapOr = <T, E>(result: Result<T, E>, fallback: T): T =>
  result.ok ? result.value : fallback

/** Collects every value, or the first error. */
export const all = <T, E>(results: readonly Result<T, E>[]): Result<T[], E> => {
  const values: T[] = []
  for (const result of results) {
    if (!result.ok) return result
    values.push(result.value)
  }
  return ok(values)
}
