// Discover: the mods the catalogue holds, around the selection, its empty
// states, and a mod's detail. Rows are plain Buttons keyed `found:<id>`
// (Enter opens the detail); every name and blurb is the catalogue's own word,
// sanitised by the catalogue and drawn as Text.

import type { RenderElement } from 'claude-code'
import type { CatalogPage, CatalogRow, View } from '../../types/index.d.ts'
import { formatCount } from '../domain/catalog.ts'
import { foundKey, inspectionLines } from '../domain/discover.ts'
import { sanitize } from '../domain/sanitize.ts'
import type { Window } from '../domain/view.ts'
import { GLYPH, Heading, KeyButton, Pointer, TONE, type ViewPorts } from './kit.tsx'

/** Cells for the install count at a row's end (`12.3k`). */
const INSTALLS = 5

export const FoundRow = (
  v: ViewPorts,
  row: CatalogRow,
  how: { readonly columns: number; readonly focus: boolean; readonly twoLine: boolean },
): RenderElement => {
  const { Box, Button, Text } = v.el
  const name = Math.max(8, how.columns - 2 - 1 - INSTALLS)
  const installs = row.installs === undefined ? '' : formatCount(row.installs)
  const about = row.blurb === '' ? row.marketplace : row.blurb
  return (
    <Box key={`line:${row.id}`} flexDirection="column">
      <Box flexDirection="row" gap={1}>
        {Pointer(v, how.focus)}
        <Box width={name} flexShrink={0}>
          <Button
            key={foundKey(row.id)}
            plain
            label={sanitize(row.name, { max: name })}
            {...(how.focus ? { autoFocus: true as const } : {})}
            onPress={() => (how.twoLine ? v.act.openFound(row.id) : v.act.toDetail())}
          />
        </Box>
        <Box width={INSTALLS} flexShrink={0} justifyContent="flex-end">
          <Text dimColor>{installs}</Text>
        </Box>
      </Box>
      {how.twoLine ? (
        <Box paddingLeft={2} height={1} overflow="hidden">
          <Text dimColor wrap="truncate-end">
            {sanitize(about, { max: 200 })}
          </Text>
        </Box>
      ) : null}
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
    /** The detector is still checking the catalogue for mods. */
    readonly checking: boolean
    /** Each entry takes two rows: its name, then what it says it does. */
    readonly twoLine: boolean
  },
): RenderElement => {
  const { Box, Text } = v.el
  if (page.rows.length === 0) {
    const lines: string[] = []
    if (page.loading) lines.push('Reading your marketplaces’ catalogues…')
    else if (page.error !== undefined)
      lines.push(`Couldn't read the catalogue: ${sanitize(page.error, { max: 200 })} (r retries)`)
    else if (page.total === 0) lines.push('Your marketplaces list nothing you haven’t installed.')
    else {
      lines.push(
        how.view.search === ''
          ? 'No mods found in your marketplaces yet.'
          : `No mod matches "${sanitize(how.view.search, { max: 40 })}". Esc clears it.`,
      )
      if (how.networkOff) lines.push('Network use is off, so only local catalogues are checked.')
      else if (how.checking) lines.push('modmgr is still checking the catalogue: more may appear.')
      // The footer draws `m`: a key is drawn once (two Buttons with one key clash).
      if (how.view.search === '') lines.push('m adds a marketplace.')
    }
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
      {page.rows.slice(how.window.start, how.window.end).map(row =>
        FoundRow(v, row, {
          columns: how.columns,
          focus: row.id === how.focusId,
          twoLine: how.twoLine,
        }),
      )}
    </Box>
  )
}

/** The rows the catalogue detail draws (Pane clips a taller one to the body). */
export const foundDetailRows = (row: CatalogRow | undefined): number => {
  if (row === undefined) return 1
  const notable = row.notable ?? []
  return 3 + 1 + (row.blurb === '' ? 0 : 1) + 1 + (notable.length === 0 ? 1 : 1 + notable.length)
}

export const FoundDetail = (
  v: ViewPorts,
  row: CatalogRow | undefined,
  how: { readonly readOnly: boolean },
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
      <Box flexDirection="row" gap={1} height={1} overflow="hidden">
        <Text color={TONE.accent}>{GLYPH.notable} mod</Text>
        <Text dimColor wrap="truncate-end">
          · {row.marketplace}
          {row.installs === undefined ? '' : ` · ${formatCount(row.installs)} installs`}
        </Text>
      </Box>
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
      {row.blurb === '' ? null : <Text>{row.blurb}</Text>}
      <Text dimColor wrap="truncate-end">
        from {row.source}
      </Text>
      {row.unread !== undefined ? (
        <Text color={TONE.warn} wrap="truncate-end">
          Couldn't read what it can do: {sanitize(row.unread, { max: 160 })} (r retries)
        </Text>
      ) : notable === undefined ? (
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
