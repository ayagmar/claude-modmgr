// A mod's detail: what it is, where it comes from, whether
// it can be toggled here, its notable capabilities, everything it hooks and
// calls grouped by reach, and its other parts. Pushed by Enter (stacked), or
// beside the list (split). The action keys sit under the title, so a body
// clipped to its rows never hides them. Validate's words are the plugin's own:
// Text only.

import type { RenderElement } from 'claude-code'
import type { ModDetail, ModRow, View } from '../../types/index.d.ts'
import { groupByReach, notableOf } from '../domain/capabilities.ts'
import { sanitize } from '../domain/sanitize.ts'
import { bytesLabel, partsLabel, whyLocked, whyNoRemove, whyNoUpdate } from '../domain/view.ts'
import { GLYPH, Heading, KeyButton, TONE, type ViewPorts } from './kit.tsx'

/** The reach groups that are only drawing: named on one line, not explained. */
const QUIET = new Set(['display'])

export type DetailHow = {
  readonly row: ModRow | undefined
  readonly detail: ModDetail | null
  /** The ids whose staged entry still changes something (`stagedIds`). */
  readonly staged: ReadonlySet<string>
  readonly view: View
  readonly readOnly: boolean
  /** Rows the body has: past them the reach groups draw one line each. */
  readonly rows: number
}

const groupsOf = (detail: ModDetail | null) =>
  detail?.caps === undefined ? [] : groupByReach(detail.caps)
const notableFor = (detail: ModDetail | null) =>
  detail?.caps === undefined ? [] : notableOf(detail.caps)
/** The notable items its last update added, drawn apart from the rest. */
const newFor = (detail: ModDetail | null) => {
  const added = detail?.capsNew?.added ?? []
  return notableFor(detail).filter(item => added.includes(item.id))
}
const oldFor = (detail: ModDetail | null) => {
  const added = detail?.capsNew?.added ?? []
  return notableFor(detail).filter(item => !added.includes(item.id))
}
/** Why `u` isn't offered, when it isn't for another reason than the lock line's. */
const updateNote = (row: ModRow): string | undefined =>
  whyLocked(row) === undefined ? whyNoUpdate(row) : undefined
const detailFor = (how: DetailHow): ModDetail | null =>
  how.row !== undefined && how.detail?.id === how.row.id ? how.detail : null

/** The rows the full detail takes (the facts under each notable item, every call on its own line). */
const fullRows = (how: DetailHow): number => {
  const { row } = how
  if (row === undefined) return 1
  const detail = detailFor(how)
  const staged = how.staged.has(row.id)
  const head =
    2 +
    1 +
    (whyLocked(row) === undefined ? 0 : 1) +
    (updateNote(row) !== undefined ? 1 : 0) +
    (staged ? 1 : 0)
  if (detail === null) return head + 1
  const fresh = newFor(detail)
  const notable = oldFor(detail)
  const groups = groupsOf(detail)
  const extras =
    (detail.mixedCounts !== undefined && partsLabel(detail.mixedCounts) !== '') ||
    (detail.tokens ?? 0) > 0 ||
    detail.dataBytes !== undefined
  return (
    head +
    (fresh.length === 0 ? 0 : 1 + 2 * fresh.length) +
    (notable.length === 0 ? 0 : 1 + 2 * notable.length) +
    1 +
    Math.max(
      1,
      groups.reduce((sum, g) => sum + (QUIET.has(g.reach) ? 1 : 1 + g.items.length), 0),
    ) +
    (extras ? 1 : 0) +
    (detail.validate === undefined ? 0 : 1)
  )
}

/** The rows the detail draws: the full form, or the compact one past `how.rows`. */
export const detailRows = (how: DetailHow): number => {
  const full = fullRows(how)
  if (full <= how.rows) return full
  // Compact: each notable item loses its facts line, each group is one line.
  const detail = detailFor(how)
  const explained = groupsOf(detail).reduce(
    (sum, g) => sum + (QUIET.has(g.reach) ? 0 : g.items.length),
    0,
  )
  return full - notableFor(detail).length - explained
}

export const Detail = (v: ViewPorts, how: DetailHow): RenderElement => {
  const { Box, Text } = v.el
  const { row, view } = how
  if (row === undefined) {
    return <Text dimColor>Select a mod to see what it can do.</Text>
  }
  const detail = detailFor(how)
  const marketplace = row.id.slice(row.id.indexOf('@') + 1)
  const locked = whyLocked(row)
  const staged = how.staged.has(row.id) ? view.staged[row.id] : undefined
  const fresh = newFor(detail)
  const notable = oldFor(detail)
  const groups = groupsOf(detail)
  const extras: string[] = []
  if (detail?.mixedCounts !== undefined) {
    const parts = partsLabel(detail.mixedCounts)
    if (parts !== '') extras.push(`also contains ${parts}`)
  }
  if (detail?.tokens !== undefined && detail.tokens > 0)
    extras.push(`~${detail.tokens} tokens per session`)
  if (detail?.dataBytes !== undefined) extras.push(`data ${bytesLabel(detail.dataBytes)}`)

  const compact = fullRows(how) > how.rows

  const toggleLabel = staged !== undefined ? 'unstage' : row.enabled ? 'disable' : 'enable'

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text bold>{sanitize(row.name, { max: 64 })}</Text>
        <Text dimColor>{row.version === undefined ? '' : sanitize(row.version, { max: 20 })}</Text>
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
      {updateNote(row) !== undefined ? (
        <Text dimColor wrap="truncate-end">
          {GLYPH.update} {updateNote(row)}
        </Text>
      ) : null}
      {staged === undefined ? null : (
        <Text color={TONE.warn}>
          staged: {staged ? 'on' : 'off'} after apply (s), after a reload
        </Text>
      )}
      {detail === null ? (
        <Text dimColor>Reading what it can do…</Text>
      ) : (
        <Box flexDirection="column">
          {fresh.length === 0 || detail.capsNew === undefined ? null : (
            <Box flexDirection="column">
              <Text bold color={TONE.warn}>
                New since {sanitize(detail.capsNew.since, { max: 20 })}
              </Text>
              {fresh.map(item => (
                <Box flexDirection="column">
                  <Box flexDirection="row" gap={1}>
                    <Text color={TONE.warn}>{GLYPH.notable}</Text>
                    <Text>{item.text}</Text>
                  </Box>
                  {compact ? null : (
                    <Box paddingLeft={2}>
                      <Text dimColor wrap="truncate-end">
                        {item.because.join(' ')}
                      </Text>
                    </Box>
                  )}
                </Box>
              ))}
            </Box>
          )}
          {notable.length === 0 ? null : (
            <Box flexDirection="column">
              {Heading(v, 'Notable')}
              {notable.map(item => (
                <Box flexDirection="column">
                  <Box flexDirection="row" gap={1}>
                    <Text color={TONE.accent}>{GLYPH.notable}</Text>
                    <Text>{item.text}</Text>
                  </Box>
                  {compact ? null : (
                    <Box paddingLeft={2}>
                      <Text dimColor wrap="truncate-end">
                        {item.because.join(' ')}
                      </Text>
                    </Box>
                  )}
                </Box>
              ))}
            </Box>
          )}
          {Heading(v, 'What it can do')}
          {groups.length === 0 ? <Text dimColor>Nothing beyond loading.</Text> : null}
          {groups.map(group =>
            compact || QUIET.has(group.reach) ? (
              <Box flexDirection="row" gap={1}>
                <Box flexShrink={0}>
                  <Text dimColor={QUIET.has(group.reach)}>{group.label}</Text>
                </Box>
                <Text dimColor wrap="truncate-end">
                  {group.items.map(item => item.name).join(' ')}
                </Text>
              </Box>
            ) : (
              <Box flexDirection="column">
                <Text>{group.label}</Text>
                {group.items.map(item => (
                  <Box flexDirection="row" gap={1} paddingLeft={1}>
                    <Box flexShrink={0}>
                      <Text color={TONE.accent}>{item.name}</Text>
                    </Box>
                    <Text dimColor wrap="truncate-end">
                      {item.line}
                    </Text>
                  </Box>
                ))}
              </Box>
            ),
          )}
          {extras.length === 0 ? null : <Text dimColor>{extras.join(' · ')}</Text>}
          {detail.validate === undefined ? null : detail.validate.errors > 0 ? (
            <Text color={TONE.bad}>
              {GLYPH.problem} validate: {detail.validate.errors} errors, {detail.validate.warnings}{' '}
              warnings
            </Text>
          ) : (
            <Text dimColor>
              {GLYPH.ok} validates
              {detail.validate.warnings > 0 ? ` (${detail.validate.warnings} warnings)` : ''}
            </Text>
          )}
        </Box>
      )}
    </Box>
  )
}
