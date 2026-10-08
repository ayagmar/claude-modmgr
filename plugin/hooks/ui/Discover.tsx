// Discover: the catalogue's rows around the selection, its empty states, and
// an entry's detail. Rows are plain Buttons keyed `found:<id>`
// (Enter opens the detail); every name and blurb is the catalogue's own word,
// sanitised by the catalogue and drawn as Text.

import type { RenderElement } from 'claude-code'
import type { CatalogPage, CatalogRow, View } from '../../types/index.d.ts'
import { formatCount } from '../domain/catalog.ts'
import { foundKey, inspectionLines } from '../domain/discover.ts'
import { sanitize } from '../domain/sanitize.ts'
import type { Window } from '../domain/view.ts'
import { GLYPH, Heading, KeyButton, Pointer, TONE, type ViewPorts } from './kit.tsx'

/** What an entry is, said in the detail. */
const KIND_ABOUT: Readonly<Record<CatalogRow['kind'], string>> = {
  mod: 'mod',
  hooks: 'plugin with command hooks',
  plain: 'plugin',
  unknown: 'not checked yet',
}

/** Cells for the install count at a row's end (`12.3k`). */
const INSTALLS = 5

/** A mod is marked; a plugin with command hooks quietly; the rest not at all. */
const badgeOf = (v: ViewPorts, kind: CatalogRow['kind']): RenderElement => {
  const { Text } = v.el
  if (kind === 'mod') return <Text color={TONE.accent}>{GLYPH.notable}</Text>
  if (kind === 'hooks') return <Text dimColor>{GLYPH.hooks}</Text>
  return <Text> </Text>
}

export const FoundRow = (
  v: ViewPorts,
  row: CatalogRow,
  how: { readonly columns: number; readonly focus: boolean; readonly twoLine: boolean },
): RenderElement => {
  const { Box, Button, Text } = v.el
  const name = Math.max(8, how.columns - 4 - 1 - INSTALLS)
  const installs = row.installs === undefined ? '' : formatCount(row.installs)
  const about = row.blurb === '' ? row.marketplace : row.blurb
  return (
    <Box key={`line:${row.id}`} flexDirection="column">
      <Box flexDirection="row" gap={1}>
        {Pointer(v, how.focus)}
        {badgeOf(v, row.kind)}
        <Box width={name} flexShrink={0}>
          <Button
            key={foundKey(row.id)}
            plain
            label={sanitize(row.name, { max: name })}
            {...(how.focus ? { autoFocus: true as const } : {})}
            onPress={() => v.act.openFound(row.id)}
          />
        </Box>
        <Box width={INSTALLS} flexShrink={0} justifyContent="flex-end">
          <Text dimColor>{installs}</Text>
        </Box>
      </Box>
      {how.twoLine ? (
        <Box paddingLeft={4} height={1} overflow="hidden">
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
    else if (how.view.search !== '')
      lines.push(`Nothing matches "${sanitize(how.view.search, { max: 40 })}". Esc clears it.`)
    else if (how.view.kind === 'mods') {
      lines.push('No mods found in your marketplaces yet.')
      lines.push(
        how.networkOff
          ? 'Network use is off, so only local catalogues are checked.'
          : 'modmgr checks more of the catalogue while you work.',
      )
      // The footer draws `k` and `m`: a key is drawn once (two Buttons with one hotkey clash).
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
      <Box flexDirection="row" gap={1} height={1} overflow="hidden">
        {row.kind === 'mod' ? <Text color={TONE.accent}>{GLYPH.notable} mod</Text> : null}
        <Text dimColor wrap="truncate-end">
          {row.kind === 'mod' ? '' : `${KIND_ABOUT[row.kind]} · `}
          {row.marketplace}
          {row.installs === undefined ? '' : ` · ${formatCount(row.installs)} installs`}
        </Text>
      </Box>
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
