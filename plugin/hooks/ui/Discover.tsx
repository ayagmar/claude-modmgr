// Discover (PLAN §2.3, §5.3): the catalogue's rows around the selection, its
// empty states, and an entry's detail. Rows are plain Buttons keyed `found:<id>`
// (Enter opens the detail); every name and blurb is the catalogue's own word,
// sanitised by the catalogue and drawn as Text.

import type { RenderElement } from 'claude-code'
import type { CatalogPage, CatalogRow, View } from '../../types/index.d.ts'
import { formatCount } from '../domain/catalog.ts'
import { foundKey, inspectionLines, KIND_LABEL } from '../domain/discover.ts'
import { sanitize } from '../domain/sanitize.ts'
import type { Window } from '../domain/view.ts'
import { GLYPH, Heading, KeyButton, TONE, type ViewPorts } from './kit.tsx'

/** Cells for the kind and the install count at a row's end. */
const TAIL = 14

const kindTone = (kind: CatalogRow['kind']): string | undefined =>
  kind === 'mod' ? TONE.accent : undefined

export const FoundRow = (
  v: ViewPorts,
  row: CatalogRow,
  how: { readonly columns: number; readonly focus: boolean },
): RenderElement => {
  const { Box, Button, Text } = v.el
  const wide = how.columns >= 60
  const name = Math.max(10, Math.min(36, how.columns - 2 - TAIL - (wide ? 20 : 0)))
  return (
    <Box key={`line:${row.id}`} flexDirection="row" gap={1}>
      <Text color={kindTone(row.kind) ?? TONE.muted}>
        {row.kind === 'mod' ? GLYPH.notable : ' '}
      </Text>
      <Box width={name} flexShrink={0}>
        <Button
          key={foundKey(row.id)}
          plain
          label={sanitize(row.name, { max: name })}
          {...(how.focus ? { autoFocus: true as const } : {})}
          onPress={() => v.act.openFound(row.id)}
        />
      </Box>
      {wide ? (
        <Box width={20} flexShrink={0}>
          <Text dimColor wrap="truncate-end">
            {row.marketplace}
          </Text>
        </Box>
      ) : null}
      <Box width={6} flexShrink={0}>
        <Text dimColor>{KIND_LABEL[row.kind]}</Text>
      </Box>
      <Text dimColor>{row.installs === undefined ? '' : formatCount(row.installs)}</Text>
    </Box>
  )
}

/** The rows in the window, or the line that stands in for them. */
export const FoundList = (
  v: ViewPorts,
  page: CatalogPage,
  how: {
    readonly view: View
    readonly columns: number
    /** Over `page.rows`: the part the body has room for. */
    readonly window: Window
    readonly focusId: string | undefined
    readonly networkOff: boolean
  },
): RenderElement => {
  const { Box, Text } = v.el
  if (page.rows.length === 0) {
    const lines: string[] = []
    if (page.loading) lines.push('Reading your marketplaces’ catalogues…')
    else if (page.error !== undefined)
      lines.push(`Couldn't read the catalogue: ${sanitize(page.error, { max: 200 })} (r retries)`)
    else if (page.total === 0) lines.push('Your marketplaces list nothing you haven’t installed.')
    else if (how.view.search !== '')
      lines.push(`Nothing matches "${sanitize(how.view.search, { max: 40 })}". Esc clears it.`)
    else if (how.view.kind === 'mods') {
      lines.push('No mods found in your marketplaces yet.')
      lines.push(
        how.networkOff
          ? 'Network use is off, so only local catalogues are checked.'
          : 'modmgr checks more of the catalogue while you work.',
      )
      // The footer draws `k` and `m`: a key is drawn once (two Buttons with one key clash, F12).
      lines.push('k shows plugins with hooks; m adds a marketplace.')
    } else lines.push('Nothing to show with this filter.')
    return (
      <Box flexDirection="column">
        {lines.map(line => (
          <Text dimColor>{line}</Text>
        ))}
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      {page.rows
        .slice(how.window.start, how.window.end)
        .map(row => FoundRow(v, row, { columns: how.columns, focus: row.id === how.focusId }))}
    </Box>
  )
}

/** The rows the catalogue detail draws (Pane clips a taller one to the body). */
export const foundDetailRows = (row: CatalogRow | undefined, actions: boolean): number => {
  if (row === undefined) return 1
  const notable = row.notable ?? []
  return (
    3 +
    (actions ? 1 : 0) +
    (row.blurb === '' ? 0 : 1) +
    1 +
    (notable.length === 0 ? 1 : 1 + notable.length)
  )
}

export const FoundDetail = (
  v: ViewPorts,
  row: CatalogRow | undefined,
  how: { readonly actions: boolean; readonly readOnly: boolean },
): RenderElement => {
  const { Box, Text } = v.el
  if (row === undefined) return <Text dimColor>Select an entry to see more.</Text>
  const notable =
    row.notable === undefined
      ? undefined
      : inspectionLines({ notable: row.notable, hasModule: row.kind === 'mod' })
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text bold>{row.name}</Text>
        <Text dimColor>{row.version ?? ''}</Text>
      </Box>
      <Text dimColor wrap="truncate-end">
        {KIND_LABEL[row.kind] === '?' ? 'not checked yet' : KIND_LABEL[row.kind]} ·{' '}
        {row.marketplace}
        {row.installs === undefined ? '' : ` · ${formatCount(row.installs)} installs`}
      </Text>
      {how.actions ? (
        <Box flexDirection="row" columnGap={2} flexWrap="wrap">
          {how.readOnly
            ? null
            : KeyButton(v, {
                action: 'install',
                on: 'discover-detail',
                label: 'install',
                onPress: () => v.act.install(row.id),
              })}
          {KeyButton(v, {
            action: 'copy',
            on: 'discover-detail',
            label: 'copy id',
            onPress: press => v.act.copy(row.id, press.surface),
          })}
        </Box>
      ) : null}
      {row.blurb === '' ? null : <Text>{row.blurb}</Text>}
      <Text dimColor wrap="truncate-end">
        from {row.source}
      </Text>
      {notable === undefined ? (
        <Text dimColor>
          {row.local === true
            ? 'Reading what it can do…'
            : 'What it can do is read once it is installed.'}
        </Text>
      ) : notable.length === 0 ? (
        <Text dimColor>{GLYPH.ok} Nothing notable in what it can do.</Text>
      ) : (
        <Box flexDirection="column">
          {Heading(v, 'Notable')}
          {notable.map(line => (
            <Box flexDirection="row" gap={1}>
              <Text color={TONE.accent}>{GLYPH.notable}</Text>
              <Text>{line}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}
