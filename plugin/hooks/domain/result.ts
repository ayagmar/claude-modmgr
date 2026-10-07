// Result values and modmgr's error kinds (PLAN §3). Nothing in modmgr throws
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

type Explanation = { readonly sentence: string; readonly next: string }

const EXPLANATIONS: Readonly<Record<ErrorKind, Explanation>> = {
  'cli-failed': {
    sentence: 'The claude CLI reported a failure.',
    next: 'Open the job log (j) for its message.',
  },
  timeout: {
    sentence: 'The claude CLI took too long and was stopped.',
    next: 'Retry; if it keeps happening, run the command in a terminal.',
  },
  parse: {
    sentence: "modmgr couldn't read the CLI's answer.",
    next: 'Your Claude Code may be newer than modmgr; check for a modmgr update.',
  },
  network: {
    sentence: "A network request didn't complete.",
    next: 'Check your connection, then refresh (r).',
  },
  'rate-limited': {
    sentence: 'GitHub is rate-limiting requests.',
    next: 'modmgr will try again later on its own.',
  },
  rejected: {
    sentence: 'Claude Code refused the action.',
    next: 'Read the reason in the job log (j).',
  },
  unavailable: {
    sentence: "This isn't available in this session.",
    next: 'Managing mods needs a terminal session of Claude Code.',
  },
  conflict: {
    sentence: 'Something changed while you were deciding.',
    next: 'Review the new details and confirm again.',
  },
  'store-full': {
    sentence: "modmgr's cache is full.",
    next: 'Clear the cache from Health.',
  },
  invalid: {
    sentence: "modmgr refused an input that doesn't look safe.",
    next: 'This is likely a modmgr bug; please report it.',
  },
}

/** One sentence and one next step per error kind, for the UI and `/mods`. */
export const explain = (error: ModmgrError): Explanation => EXPLANATIONS[error.kind]
