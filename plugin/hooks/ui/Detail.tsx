// A mod's detail (PLAN §5.3, §2.2): what it is, where it comes from, whether
// it can be toggled here, its notable capabilities, everything it hooks and
// calls grouped by reach, and its other parts. Pushed by Enter (stacked), or
// beside the list (split). Validate's words are the plugin's own: Text only.

import type { RenderElement } from 'claude-code'
import type { ModDetail, ModRow, View } from '../../types/index.d.ts'
import { groupByReach, notableOf } from '../domain/capabilities.ts'
import { sanitize } from '../domain/sanitize.ts'
import { partsLabel, whyLocked } from '../domain/view.ts'
import { GLYPH, Heading, KeyButton, TONE, type ViewPorts } from './kit.tsx'

const bytes = (n: number): string =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${Math.round(n / 1024)} KB`
      : `${(n / 1048576).toFixed(1)} MB`

/** The reach groups that are only drawing: named on one line, not explained. */
const QUIET = new Set(['display'])

export const Detail = (
  v: ViewPorts,
  how: {
    readonly row: ModRow | undefined
    readonly detail: ModDetail | null
    readonly view: View
    /** Draw the action keys (the overlay is on top), not just the facts (a split's preview). */
    readonly actions: boolean
    readonly readOnly: boolean
  },
): RenderElement => {
  const { Box, Text } = v.el
  const { row, view } = how
  if (row === undefined) {
    return <Text dimColor>Select a mod to see what it can do.</Text>
  }
  const detail = how.detail?.id === row.id ? how.detail : null
  const marketplace = row.id.slice(row.id.indexOf('@') + 1)
  const locked = whyLocked(row)
  const staged = view.staged[row.id]
  const caps = detail?.caps
  const notable = caps === undefined ? [] : notableOf(caps)
  const groups = caps === undefined ? [] : groupByReach(caps)
  const extras: string[] = []
  if (detail?.mixedCounts !== undefined) {
    const parts = partsLabel(detail.mixedCounts)
    if (parts !== '') extras.push(`also contains ${parts}`)
  }
  if (detail?.tokens !== undefined && detail.tokens > 0)
    extras.push(`~${detail.tokens} tokens per session`)
  if (detail?.dataBytes !== undefined) extras.push(`data ${bytes(detail.dataBytes)}`)

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
      {locked === undefined ? null : (
        <Text color={TONE.warn}>
          {GLYPH.locked} {locked}
        </Text>
      )}
      {staged === undefined ? null : (
        <Text color={TONE.warn}>
          staged: {staged ? 'on' : 'off'} after apply (s), after a reload
        </Text>
      )}
      {detail === null ? (
        <Text dimColor>Reading what it can do…</Text>
      ) : (
        <Box flexDirection="column">
          {notable.length === 0 ? null : (
            <Box flexDirection="column">
              {Heading(v, 'Notable')}
              {notable.map(item => (
                <Box flexDirection="column">
                  <Box flexDirection="row" gap={1}>
                    <Text color={TONE.accent}>{GLYPH.notable}</Text>
                    <Text>{item.text}</Text>
                  </Box>
                  <Box paddingLeft={2}>
                    <Text dimColor wrap="truncate-end">
                      {item.because.join(' ')}
                    </Text>
                  </Box>
                </Box>
              ))}
            </Box>
          )}
          {Heading(v, 'What it can do')}
          {groups.length === 0 ? <Text dimColor>Nothing beyond loading.</Text> : null}
          {groups.map(group =>
            QUIET.has(group.reach) ? (
              <Box flexDirection="row" gap={1}>
                <Box flexShrink={0}>
                  <Text dimColor>{group.label}</Text>
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
      {how.actions ? (
        <Box flexDirection="row" columnGap={2} flexWrap="wrap">
          {how.readOnly || locked !== undefined
            ? null
            : KeyButton(v, {
                action: 'toggle',
                on: 'detail',
                label: staged !== undefined ? 'unstage' : row.enabled ? 'disable' : 'enable',
                onPress: () => v.act.toggle(row.id),
              })}
          {KeyButton(v, {
            action: 'copy',
            on: 'detail',
            label: 'copy id',
            onPress: () => v.act.copy(row.id, v.surface),
          })}
        </Box>
      ) : null}
    </Box>
  )
}
