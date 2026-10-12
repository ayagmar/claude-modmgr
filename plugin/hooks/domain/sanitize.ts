// Untrusted text (catalogue names and descriptions, CLI messages, test output)
// is cleaned before it is drawn: no terminal escapes, no C0/C1
// controls, no bidi overrides that could spoof another plugin's name.

// CSI, OSC (BEL- or ST-terminated) and other two-byte ESC sequences.
const ANSI = new RegExp(
  [
    '\\u001b\\[[0-?]*[ -/]*[@-~]',
    '\\u009b[0-?]*[ -/]*[@-~]',
    '\\u001b\\][^\\u0007\\u001b]*(?:\\u0007|\\u001b\\\\)',
    '\\u009d[^\\u0007\\u001b\\u009c]*(?:\\u0007|\\u001b\\\\|\\u009c)',
    '\\u001b[@-Z\\\\-_]',
  ].join('|'),
  'g',
)
// C0 except TAB/LF, DEL, C1.
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point.
const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g
// Bidi embeddings/overrides/isolates, LRM/RLM/ALM, zero-width joiners, the soft
// hyphen, Hangul and Khmer fillers, the Mongolian vowel separator, variation
// selectors and tag characters: each draws as nothing, so can hide or fake text.
const INVISIBLES =
  // biome-ignore lint/suspicious/noMisleadingCharacterClass: matching each of these alone is the point.
  /[\u00ad\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\u3164\ufe00-\ufe0f\ufeff\uffa0\u{e0000}-\u{e007f}]/gu
// Line and paragraph separators: a line break, where one is kept.
const SEPARATORS = /[\u2028\u2029]/g

/** True when text holds a control, bidi or zero-width character (what `sanitize` strips). */
export const hasHiddenCharacters = (text: string): boolean =>
  new RegExp(CONTROLS.source).test(text.replace(/[\t\n]/g, '')) ||
  new RegExp(INVISIBLES.source, 'u').test(text) ||
  new RegExp(SEPARATORS.source).test(text)

export type SanitizeOptions = {
  /** Longest result, in code points; longer text ends with `…`. */
  readonly max?: number
  /** Keep line breaks (job logs). Off: every run of whitespace becomes one space. */
  readonly multiline?: boolean
}

export const sanitize = (input: unknown, options: SanitizeOptions = {}): string => {
  if (typeof input !== 'string') return ''
  const { max = 200, multiline = false } = options
  let text = input.replace(ANSI, '').replace(CONTROLS, '').replace(INVISIBLES, '')
  text = multiline
    ? text
        .replace(SEPARATORS, '\n')
        .replace(/\t/g, '  ')
        .replace(/[  ]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
    : text.replace(/\s+/g, ' ')
  text = text.trim()
  return truncate(text, max)
}

/** Cuts at a code point, never inside a surrogate pair. */
export const truncate = (text: string, max: number): string => {
  if (max <= 0) return ''
  const points = Array.from(text)
  if (points.length <= max) return text
  return `${points
    .slice(0, max - 1)
    .join('')
    .trimEnd()}…`
}

/** Sanitises each line and keeps the last `count` (streamed job output). */
export const tailLines = (lines: readonly string[], count: number, width = 300): string[] =>
  lines
    .flatMap(line => line.split(/\r?\n/))
    .map(line => sanitize(line, { max: width }))
    .filter(line => line.length > 0)
    .slice(-count)
