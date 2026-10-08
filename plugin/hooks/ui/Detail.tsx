// A mod's detail: what it is, where it comes from, whether
// it can be toggled here, its notable capabilities, everything it hooks and
// calls grouped by reach, and its other parts. Pushed by Enter (stacked), or
// beside the list (split). The action keys sit under the title, so a body
// clipped to its rows never hides them. Validate's words are the plugin's own:
// Text only.

import type { RenderElement } from 'claude-code'
import type { ModDetail, ModRow, View } from '../../types/index.d.ts'
import { groupByReach, type Notable, notableOf, type ReachGroup } from '../domain/capabilities.ts'
import { sanitize } from '../domain/sanitize.ts'
import { bytesLabel, partsLabel, whyLocked, whyNoRemove, whyNoUpdate } from '../domain/view.ts'
import {
  GLYPH,
  Heading,
  KeyButton,
  LabelRow,
  type Section,
  Sections,
  sectionRows,
  TONE,
  type ViewPorts,
} from './kit.tsx'

/** The reach groups that are only drawing: named on one line, not explained. */
const QUIET = new Set(['display'])

/** Cells at most for the capability table's group and name columns. */
const LABEL_MAX = 20
const NAME_MAX = 20

export type DetailHow = {
  readonly row: ModRow | undefined
  readonly detail: ModDetail | null
  /** The ids whose staged entry still changes something (`stagedIds`). */
  readonly staged: ReadonlySet<string>
  readonly view: View
  readonly readOnly: boolean
  /** Rows the body has: past them the detail draws closer, then compactly. */
  readonly rows: number
}

const detailFor = (how: DetailHow): ModDetail | null =>
  how.row !== undefined && how.detail?.id === how.row.id ? how.detail : null
/** Why `u` isn't offered, when it isn't for another reason than the lock line's. */
const updateNote = (row: ModRow): string | undefined =>
  whyLocked(row) === undefined ? whyNoUpdate(row) : undefined
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * How much the detail says: `full` gives each notable item its facts and each
 * hook or call its own explained row; `compact` one line per item and group.
 */
type Form = { readonly full: boolean; readonly spaced: boolean }
/** The forms tried in turn, the first that fits the body drawn. */
const FORMS: readonly Form[] = [
  { full: true, spaced: true },
  { full: false, spaced: true },
  { full: false, spaced: false },
]

/** The notable items, each with its facts under it in the full form. */
const notableSection = (
  v: ViewPorts,
  heading: RenderElement,
  items: readonly Notable[],
  tone: string,
  full: boolean,
): Section => {
  const { Box, Text } = v.el
  return {
    rows: 1 + items.length * (full ? 2 : 1),
    el: (
      <Box flexDirection="column">
        {heading}
        {items.map(item => (
          <Box flexDirection="column">
            <Box flexDirection="row" gap={1}>
              <Text color={tone}>{GLYPH.notable}</Text>
              <Text>{item.text}</Text>
            </Box>
            {full ? (
              <Box paddingLeft={2}>
                <Text dimColor wrap="truncate-end">
                  {item.because.join(' ')}
                </Text>
              </Box>
            ) : null}
          </Box>
        ))}
      </Box>
    ),
  }
}

/**
 * Everything it hooks and calls, grouped by reach. In the full form each group
 * is named on its own row and each item follows on a row of its own, its name
 * in a column, then what it does; a group that only draws lists its names.
 * Compactly, a table: the reach in the first column, the names beside it.
 */
const reachSection = (v: ViewPorts, groups: readonly ReachGroup[], full: boolean): Section => {
  const { Box, Text } = v.el
  const heading = Heading(v, 'What it can do')
  if (groups.length === 0) {
    return {
      rows: 2,
      el: (
        <Box flexDirection="column">
          {heading}
          <Text dimColor>Nothing beyond loading.</Text>
        </Box>
      ),
    }
  }
  const names = (group: ReachGroup) => group.items.map(item => item.name).join(' ')
  if (!full) {
    const label = Math.min(LABEL_MAX, Math.max(...groups.map(g => g.label.length)))
    return {
      rows: 1 + groups.length,
      el: (
        <Box flexDirection="column">
          {heading}
          {groups.map(group =>
            LabelRow(
              v,
              group.label,
              label,
              <Text dimColor={QUIET.has(group.reach)} wrap="truncate-end">
                {names(group)}
              </Text>,
            ),
          )}
        </Box>
      ),
    }
  }
  const name = Math.min(
    NAME_MAX,
    Math.max(...groups.flatMap(g => g.items.map(item => item.name.length))),
  )
  const lines = groups.flatMap(group => [
    <Text>{group.label}</Text>,
    ...(QUIET.has(group.reach)
      ? [
          <Box paddingLeft={2}>
            <Text dimColor wrap="truncate-end">
              {names(group)}
            </Text>
          </Box>,
        ]
      : group.items.map(item => (
          <Box flexDirection="row" gap={1} paddingLeft={2}>
            <Box width={name} flexShrink={0}>
              <Text wrap="truncate-end">{item.name}</Text>
            </Box>
            <Text dimColor wrap="truncate-end">
              {item.line}
            </Text>
          </Box>
        ))),
  ])
  return {
    rows: 1 + lines.length,
    el: (
      <Box flexDirection="column">
        {heading}
        {lines}
      </Box>
    ),
  }
}

/** The sections under the head, in `form`. */
const bodySections = (v: ViewPorts, detail: ModDetail | null, full: boolean): Section[] => {
  const { Box, Text } = v.el
  if (detail === null) {
    return [{ rows: 1, el: <Text dimColor>Reading what it can do…</Text> }]
  }
  const notable = detail.caps === undefined ? [] : notableOf(detail.caps)
  // The notable items its last update added are drawn apart from the rest.
  const added = detail.capsNew?.added ?? []
  const fresh = notable.filter(item => added.includes(item.id))
  const old = notable.filter(item => !added.includes(item.id))
  const sections: Section[] = []
  if (fresh.length > 0 && detail.capsNew !== undefined) {
    const heading = (
      <Text bold color={TONE.warn}>
        New since {sanitize(detail.capsNew.since, { max: 20 })}
      </Text>
    )
    sections.push(notableSection(v, heading, fresh, TONE.warn, full))
  }
  if (old.length > 0) {
    sections.push(notableSection(v, Heading(v, 'Notable'), old, TONE.accent, full))
  }
  sections.push(reachSection(v, detail.caps === undefined ? [] : groupByReach(detail.caps), full))

  const extras: string[] = []
  if (detail.mixedCounts !== undefined) {
    const parts = partsLabel(detail.mixedCounts)
    if (parts !== '') extras.push(`also contains ${parts}`)
  }
  if (detail.tokens !== undefined && detail.tokens > 0)
    extras.push(`~${detail.tokens} tokens per session`)
  if (detail.dataBytes !== undefined) extras.push(`data ${bytesLabel(detail.dataBytes)}`)
  const { validate } = detail
  const facts: RenderElement[] = []
  if (extras.length > 0) facts.push(<Text dimColor>{extras.join(' · ')}</Text>)
  if (validate !== undefined) {
    facts.push(
      validate.errors > 0 ? (
        <Text color={TONE.bad}>
          {GLYPH.problem} validate: {plural(validate.errors, 'error', 'errors')},{' '}
          {plural(validate.warnings, 'warning', 'warnings')}
        </Text>
      ) : (
        <Text dimColor>
          {GLYPH.ok} validates
          {validate.warnings > 0 ? ` (${plural(validate.warnings, 'warning', 'warnings')})` : ''}
        </Text>
      ),
    )
  }
  if (facts.length > 0) {
    sections.push({ rows: facts.length, el: <Box flexDirection="column">{facts}</Box> })
  }
  return sections
}

/** The head: name and version, state and origin, the keys, and what holds it back. */
const headSection = (v: ViewPorts, row: ModRow, how: DetailHow): Section => {
  const { Box, Text } = v.el
  const marketplace = row.id.slice(row.id.indexOf('@') + 1)
  const locked = whyLocked(row)
  const note = updateNote(row)
  const staged = how.staged.has(row.id) ? how.view.staged[row.id] : undefined
  const toggleLabel = staged !== undefined ? 'unstage' : row.enabled ? 'disable' : 'enable'
  return {
    rows:
      3 +
      (locked === undefined ? 0 : 1) +
      (note === undefined ? 0 : 1) +
      (staged === undefined ? 0 : 1),
    el: (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text bold>{sanitize(row.name, { max: 64 })}</Text>
          <Text dimColor>
            {row.version === undefined ? '' : sanitize(row.version, { max: 20 })}
          </Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text color={row.enabled ? TONE.ok : TONE.muted}>
            {row.enabled ? `${GLYPH.on} on` : `${GLYPH.off} off`}
          </Text>
          <Text dimColor>
            · {row.scope ?? row.origin} · {sanitize(marketplace, { max: 64 })}
          </Text>
        </Box>
        <Box flexDirection="row" columnGap={2} flexWrap="wrap">
          {how.readOnly || locked !== undefined
            ? null
            : KeyButton(v, {
                action: 'toggle',
                on: 'detail',
                label: toggleLabel,
                onPress: () => v.act.toggle(row.id),
              })}
          {how.readOnly || whyNoUpdate(row) !== undefined
            ? null
            : KeyButton(v, {
                action: 'update',
                on: 'detail',
                label: 'update',
                onPress: () => v.act.update(row.id),
              })}
          {how.readOnly || whyNoRemove(row) !== undefined
            ? null
            : KeyButton(v, {
                action: 'remove',
                on: 'detail',
                label: 'remove',
                onPress: () => v.act.remove(row.id),
              })}
          {KeyButton(v, {
            action: 'copy',
            on: 'detail',
            label: 'copy id',
            onPress: press => v.act.copy(row.id, press.surface),
          })}
        </Box>
        {locked === undefined ? null : (
          <Text color={TONE.warn}>
            {GLYPH.locked} {locked}
          </Text>
        )}
        {note === undefined ? null : (
          <Text dimColor wrap="truncate-end">
            {GLYPH.update} {note}
          </Text>
        )}
        {staged === undefined ? null : (
          <Text color={TONE.warn}>
            staged: {staged ? 'on' : 'off'} after apply (s), after a reload
          </Text>
        )}
      </Box>
    ),
  }
}

/** The head and body in the first form that fits `how.rows`, else the closest. */
const laidOut = (
  v: ViewPorts,
  how: DetailHow,
): { readonly sections: Section[]; readonly spaced: boolean } | undefined => {
  const { row } = how
  if (row === undefined) return undefined
  const head = headSection(v, row, how)
  const detail = detailFor(how)
  let last: { sections: Section[]; spaced: boolean } | undefined
  for (const form of FORMS) {
    last = { sections: [head, ...bodySections(v, detail, form.full)], spaced: form.spaced }
    if (sectionRows(last.sections, last.spaced) <= how.rows) return last
  }
  return last
}

/** The rows the detail draws (Pane clips a taller one to the body). */
export const detailRows = (v: ViewPorts, how: DetailHow): number => {
  const laid = laidOut(v, how)
  return laid === undefined ? 1 : sectionRows(laid.sections, laid.spaced)
}

export const Detail = (v: ViewPorts, how: DetailHow): RenderElement => {
  const { Text } = v.el
  const laid = laidOut(v, how)
  if (laid === undefined) return <Text dimColor>Select a mod to see what it can do.</Text>
  return Sections(v, laid.sections, laid.spaced)
}
