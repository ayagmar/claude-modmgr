// Parses `claude plugin validate --json <root>` into what a mod hooks,
// calls and reads, plus its errors and warnings. The notes are the validator's
// own lines, e.g. `./register.tsx calls: $.fs.read (via log), $.ui.toast`.

import type { CliRun } from './cli-results.ts'
import { arr, isRecord, type JsonRecord, parseJson, str } from './json.ts'
import { fail, ok, type Result } from './result.ts'
import { sanitize } from './sanitize.ts'

export type ValidateIssue = { readonly path: string; readonly message: string }

export type ValidateReport = {
  readonly success: boolean
  readonly errors: ValidateIssue[]
  readonly warnings: ValidateIssue[]
  /** True when a hooks module was found: the plugin is a mod. */
  readonly hasModule: boolean
  /** Event names, matchers stripped (`ui.render`), sorted, unique. */
  readonly events: string[]
  /** `noun.method`, sorted, unique (`process.run`). */
  readonly calls: string[]
  readonly envReads: string[]
  readonly envWrites: string[]
  readonly stateReads: string[]
  readonly stateWrites: string[]
  /** Gating hooks the validator found without a `.catch` (it warns about each). */
  readonly uncaughtGates: string[]
}

const ISSUE_MAX = 400

/** Splits a note list on commas outside `{…}` and `(…)`. */
export const splitList = (text: string): string[] => {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of text) {
    if (char === '{' || char === '(') depth += 1
    if ((char === '}' || char === ')') && depth > 0) depth -= 1
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += char
    }
  }
  parts.push(current)
  return parts.map(part => part.trim()).filter(part => part.length > 0 && part !== 'nothing')
}

const NOTE =
  /^\S+ (hooks|calls|env reads|env writes|state reads|state writes|gating hook without \.catch): (.*)$/

type NoteKind =
  | 'hooks'
  | 'calls'
  | 'env reads'
  | 'env writes'
  | 'state reads'
  | 'state writes'
  | 'gating hook without .catch'

const eventName = (hook: string): string => hook.replace(/\{.*$/, '').trim()
const callName = (call: string): string =>
  call
    .replace(/\s*\(via [^)]*\)\s*$/, '')
    .replace(/^\$\./, '')
    .trim()

const uniqueSorted = (values: Iterable<string>): string[] => [...new Set(values)].sort()

const issues = (section: JsonRecord, key: 'errors' | 'warnings'): ValidateIssue[] =>
  (arr(section, key) ?? []).filter(isRecord).map(issue => ({
    path: sanitize(str(issue, 'path') ?? '', { max: 120 }),
    message: sanitize(str(issue, 'message') ?? '', { max: ISSUE_MAX }),
  }))

export const parseValidateReport = (run: CliRun): Result<ValidateReport> => {
  const value = parseJson(run.stdout)
  if (!isRecord(value) || typeof value.success !== 'boolean') {
    return fail('parse', 'validate --json did not print a report')
  }
  const sections = [value.manifest, ...(arr(value, 'contents') ?? [])].filter(isRecord)
  const found: Record<NoteKind, string[]> = {
    hooks: [],
    calls: [],
    'env reads': [],
    'env writes': [],
    'state reads': [],
    'state writes': [],
    'gating hook without .catch': [],
  }
  let hasModule = false
  for (const section of sections) {
    if (str(section, 'type') === 'hooks') hasModule = true
    for (const note of arr(section, 'notes') ?? []) {
      if (typeof note !== 'string') continue
      const match = NOTE.exec(note)
      const kind = match?.[1] as NoteKind | undefined
      if (kind !== undefined && match?.[2] !== undefined) found[kind].push(...splitList(match[2]))
    }
  }
  return ok({
    success: value.success,
    errors: sections.flatMap(section => issues(section, 'errors')),
    warnings: sections.flatMap(section => issues(section, 'warnings')),
    hasModule,
    events: uniqueSorted(found.hooks.map(eventName)),
    calls: uniqueSorted(found.calls.map(callName)),
    envReads: uniqueSorted(found['env reads']),
    envWrites: uniqueSorted(found['env writes']),
    stateReads: uniqueSorted(found['state reads']),
    stateWrites: uniqueSorted(found['state writes']),
    uncaughtGates: uniqueSorted(found['gating hook without .catch']),
  })
}
