// Discover: the mods the catalogue holds, around the selection, its empty
// states, and a mod's detail. Rows are plain Buttons keyed `found:<id>`
// (Enter opens the detail); every name and blurb is the catalogue's own word,
// sanitised by the catalogue and drawn as Text.

import type { RenderElement } from 'claude-code'
import type { CatalogPage, CatalogRow, View } from '../../types/index.d.ts'
import { formatCount } from '../domain/catalog.ts'
import { foundKey, inspectionLines } from '../domain/discover.ts'
import { sanitize } from '../domain/sanitize.ts'
import { type Window, wrappedRows } from '../domain/view.ts'
import {
  GLYPH,
  Heading,
  KeyButton,
  Pointer,
  type Section,
  Sections,
  sectionRows,
  TONE,
  type ViewPorts,
} from './kit.tsx'

/** Cells for the install count at a row's end (`12.3k`). */
const INSTALLS = 5

export const FoundRow = (
  v: ViewPorts,
  row: CatalogRow,
  how: {
    readonly columns: number
    readonly focus: boolean
    readonly twoLine: boolean
    /** The detail is beside the list: Enter moves onto its keys. */
    readonly beside: boolean
    /** Another entry has its name: its marketplace tells them apart. */
    readonly twin: boolean
  },
): RenderElement => {
  const { Box, Button, Text } = v.el
  const name = Math.max(8, how.columns - 2 - 1 - INSTALLS)
  const label = how.twin ? `${row.name} · ${row.marketplace}` : row.name
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
            label={sanitize(label, { max: name })}
            {...(how.focus ? { autoFocus: true as const } : {})}
            onPress={() => (how.beside ? v.act.toDetail() : v.act.openFound(row.id))}
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
    readonly beside: boolean
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
      if (how.view.search === '') lines.push('No mods found in your marketplaces yet.')
      else
        lines.push(
          `No mod matches "${sanitize(how.view.search, { max: 40 })}".`,
          'Esc clears the search.',
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
  const names = page.rows.map(row => row.name)
  return (
    <Box flexDirection="column">
      {page.rows.slice(how.window.start, how.window.end).map(row =>
        FoundRow(v, row, {
          twin: names.indexOf(row.name) !== names.lastIndexOf(row.name),
          columns: how.columns,
          focus: row.id === how.focusId,
          twoLine: how.twoLine,
          beside: how.beside,
        }),
      )}
    </Box>
  )
}

export type FoundDetailHow = {
  readonly readOnly: boolean
  /** Rows and columns the detail has: past the rows it draws without blank rows. */
  readonly rows: number
  readonly columns: number
}

/** The head, what it says it is, and what it can do: the detail's sections. */
const foundSections = (v: ViewPorts, row: CatalogRow, how: FoundDetailHow): Section[] => {
  const { Box, Text } = v.el
  const notable =
    row.notable === undefined
      ? undefined
      : inspectionLines({ notable: row.notable, hasModule: row.kind === 'mod' })
  const origin = [
    row.marketplace,
    row.installs === undefined ? '' : `${formatCount(row.installs)} installs`,
  ]
    .filter(part => part !== '')
    .join(' · ')
  const source = `from ${row.source}`
  const head: Section = {
    rows: 3,
    el: (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text bold>{row.name}</Text>
          <Text dimColor>{row.version ?? ''}</Text>
        </Box>
        <Text dimColor wrap="truncate-end">
          {origin}
        </Text>
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
      </Box>
    ),
  }
  const about: Section = {
    rows: (row.blurb === '' ? 0 : wrappedRows([row.blurb], how.columns)) + 1,
    el: (
      <Box flexDirection="column">
        {row.blurb === '' ? null : <Text>{row.blurb}</Text>}
        <Text dimColor wrap="truncate-end">
          {source}
        </Text>
      </Box>
    ),
  }
  const said =
    row.unread !== undefined ? (
      <Text color={TONE.warn} wrap="truncate-end">
        Couldn't read it: {sanitize(row.unread, { max: 160 })} (r retries)
      </Text>
    ) : notable === undefined ? (
      <Text dimColor>
        {row.local === true ? 'Reading it…' : 'modmgr reads it once the mod is installed.'}
      </Text>
    ) : notable.length === 0 ? (
      <Text dimColor>{GLYPH.ok} Nothing notable.</Text>
    ) : undefined
  const caps: Section = {
    rows: 1 + (said === undefined ? (notable?.length ?? 0) : 1),
    el: (
      <Box flexDirection="column">
        {Heading(v, 'What it can do')}
        {said ??
          (notable ?? []).map(line => (
            <Box flexDirection="row" gap={1}>
              <Text color={TONE.accent}>{GLYPH.notable}</Text>
              <Text>{line}</Text>
            </Box>
          ))}
      </Box>
    ),
  }
  return [head, about, caps]
}

/** The rows the catalogue detail draws (Pane clips a taller one to the body). */
export const foundDetailRows = (
  v: ViewPorts,
  row: CatalogRow | undefined,
  how: FoundDetailHow,
): number => {
  if (row === undefined) return 1
  const sections = foundSections(v, row, how)
  const spaced = sectionRows(sections, true) <= how.rows
  return sectionRows(sections, spaced)
}

export const FoundDetail = (
  v: ViewPorts,
  row: CatalogRow | undefined,
  how: FoundDetailHow,
): RenderElement => {
  const { Text } = v.el
  if (row === undefined) return <Text dimColor>Select a mod to see more.</Text>
  const sections = foundSections(v, row, how)
  return Sections(v, sections, sectionRows(sections, true) <= how.rows)
}
