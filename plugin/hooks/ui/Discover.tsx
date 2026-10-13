// Discover: the mods the catalogue holds, around the selection, its empty
// states, and a mod's detail. Rows are plain Buttons keyed `found:<id>`
// (Enter opens the detail); every name and blurb is the catalogue's own word,
// sanitised by the catalogue and drawn as Text.

import type { RenderElement } from 'claude-code'
import type { CatalogPage, CatalogRow, View } from '../../types/index.d.ts'
import { formatCount } from '../domain/catalog.ts'
import { isProjectMod } from '../domain/community.ts'
import { foundKey, inspectionLines } from '../domain/discover.ts'
import { hotkeyFor } from '../domain/keymap.ts'
import { sanitize } from '../domain/sanitize.ts'
import { type Window, wrappedRows } from '../domain/view.ts'
import {
  type DetailLines,
  factsLine,
  GLYPH,
  Heading,
  HiddenRows,
  KeyButton,
  ListButton,
  line,
  Pointer,
  type Section,
  sectionLines,
  sectionRows,
  TONE,
  type ViewPorts,
} from './kit.tsx'

/** Cells for the count at a row's end (`12.3k`, `★1.2k`). */
const COUNT = 5

/** An entry's Button: its name; it opens the detail (`ListButton`). */
const foundButton = (
  v: ViewPorts,
  row: CatalogRow,
  how: {
    readonly label: string
    readonly max: number
    readonly focus: boolean
    readonly beside: boolean
  },
): RenderElement =>
  ListButton(
    v,
    {
      key: foundKey(row.id),
      label: how.label,
      open: () => v.act.openFound(row.id),
      select: () => v.act.focusFound(row.id),
    },
    how,
  )

export const FoundRow = (
  v: ViewPorts,
  row: CatalogRow,
  how: {
    readonly columns: number
    readonly focus: boolean
    /** The detail is beside the list: a press on another row selects it first. */
    readonly beside: boolean
    /** Another entry has its name: its marketplace tells them apart. */
    readonly twin: boolean
    /** The list is sorted by stars: a row with both counts shows its stars. */
    readonly byStars: boolean
  },
): RenderElement => {
  const { Box, Text } = v.el
  const name = Math.max(8, how.columns - 2 - 1 - COUNT)
  const label = how.twin ? `${row.name} · ${row.marketplace}` : row.name
  const stars = row.stars === undefined ? undefined : `★${formatCount(row.stars)}`
  const installs = row.installs === undefined ? undefined : formatCount(row.installs)
  const count = (how.byStars ? (stars ?? installs) : (installs ?? stars)) ?? ''
  const about = row.blurb === '' ? row.marketplace : row.blurb
  return (
    <Box key={`line:${row.id}`} flexDirection="column">
      <Box flexDirection="row" gap={1}>
        {Pointer(v, how.focus)}
        <Box width={name} flexShrink={0}>
          {foundButton(v, row, { label, max: name, focus: how.focus, beside: how.beside })}
        </Box>
        <Box width={COUNT} flexShrink={0} justifyContent="flex-end">
          <Text dimColor>{count}</Text>
        </Box>
      </Box>
      <Box paddingLeft={2} height={1} overflow="hidden">
        <Text dimColor wrap="truncate-end">
          {sanitize(about, { max: 200 })}
        </Text>
      </Box>
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
    /** The detail is beside the list: a press on another row selects it first. */
    readonly beside: boolean
    /** Changes are off: no key that adds a marketplace is drawn. */
    readonly readOnly: boolean
  },
): RenderElement => {
  const { Box, Text } = v.el
  if (page.rows.length === 0) {
    const lines: string[] = []
    if (page.loading) lines.push('Reading your marketplaces’ catalogues…')
    else if (page.error !== undefined)
      lines.push(`Couldn't read the catalogue: ${sanitize(page.error, { max: 200 })} (r retries)`)
    else {
      // Nothing in any catalogue, community mods included: there may be no marketplace yet.
      if (page.total === 0) lines.push('No mods to list yet.')
      else if (how.view.search === '') lines.push('No mods found in your marketplaces yet.')
      else
        lines.push(
          `No mod matches "${sanitize(how.view.search, { max: 40 })}".`,
          'Esc clears the search.',
        )
      if (how.networkOff) lines.push('Network use is off, so only local catalogues are checked.')
      else if (how.checking) lines.push('modmgr is still checking the catalogue: more may appear.')
      // The footer draws the key: a key is drawn once (two Buttons with one key clash).
      const add = hotkeyFor('marketplace-add', 'discover')
      if (how.view.search === '' && !how.readOnly && add !== undefined)
        lines.push(`${add} adds a marketplace.`)
    }
    return (
      <Box flexDirection="column">
        {lines.map(line => (
          <Text dimColor>{line}</Text>
        ))}
      </Box>
    )
  }
  // Names the rows held share, counted once.
  const named = new Map<string, number>()
  for (const row of page.rows) named.set(row.name, (named.get(row.name) ?? 0) + 1)
  const hidden = (shown: readonly CatalogRow[]) =>
    HiddenRows(
      v,
      shown.map(row =>
        foundButton(v, row, { label: row.name, max: 64, focus: false, beside: how.beside }),
      ),
    )
  return (
    <Box flexDirection="column">
      {hidden(page.rows.slice(0, how.window.start))}
      {page.rows.slice(how.window.start, how.window.end).map(row =>
        FoundRow(v, row, {
          twin: (named.get(row.name) ?? 0) > 1,
          byStars: how.view.sort === 'stars',
          columns: how.columns,
          focus: row.id === how.focusId,
          beside: how.beside,
        }),
      )}
      {hidden(page.rows.slice(how.window.end))}
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
  const { Box, Text, Link } = v.el
  const notable =
    row.notable === undefined
      ? undefined
      : inspectionLines({ notable: row.notable, hasModule: row.kind === 'mod' })
  const { community } = row
  const origin = [
    row.marketplace,
    row.installs === undefined ? '' : `${formatCount(row.installs)} installs`,
    row.stars === undefined
      ? ''
      : `${formatCount(row.stars)} ${row.stars === 1 ? 'star' : 'stars'}`,
  ].filter(part => part !== '')
  // A community mod no marketplace lists can't be installed by id: its link is what to take.
  const installable = community === undefined || community.installId !== undefined
  const head: Section = {
    lines: [
      line(
        <Box flexDirection="row" gap={1}>
          <Text bold>{row.name}</Text>
          <Text dimColor>{row.version ?? ''}</Text>
        </Box>,
      ),
      factsLine(v, origin, how.columns),
      line(
        <Box flexDirection="row" columnGap={2} flexWrap="wrap">
          {how.readOnly || !installable
            ? null
            : KeyButton(v, {
                action: 'install',
                on: 'discover-detail',
                label: 'install',
                onPress: () => v.act.install(row.id),
              })}
          {community === undefined
            ? KeyButton(v, {
                action: 'copy',
                on: 'discover-detail',
                label: 'copy id',
                onPress: press => v.act.copy(row.id, press.surface),
              })
            : KeyButton(v, {
                action: 'copy',
                on: 'discover-detail',
                label: 'copy link',
                onPress: press => v.act.copy(row.link ?? row.source, press.surface),
              })}
        </Box>,
      ),
    ],
  }
  const described = row.about ?? row.blurb
  const howTo = [
    ...(community !== undefined && isProjectMod(community.path)
      ? [`Kept in ${community.repo}'s .claude folder: a mod that project uses itself.`]
      : []),
    ...(installable
      ? []
      : ['No marketplace lists it. Clone it and run:', 'claude --plugin-dir <its folder>']),
  ]
  const about: Section = {
    lines: [
      ...(described === ''
        ? []
        : [line(<Text>{described}</Text>, wrappedRows([described], how.columns))]),
      // Its page on GitHub opens from here: a link on every surface. The whole
      // URL, wrapped: a terminal without hyperlinks shows it as text to click.
      row.link === undefined
        ? line(
            <Text dimColor wrap="truncate-end">
              from {row.source}
            </Text>,
          )
        : line(
            <Text dimColor>
              from <Link href={row.link}>{row.link}</Link>
            </Text>,
            wrappedRows([`from ${row.link}`], how.columns),
          ),
      ...howTo.map(text =>
        line(
          <Text dimColor wrap="truncate-end">
            {text}
          </Text>,
        ),
      ),
    ],
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
  // Where the facts come from, for a community mod or a remote entry the
  // community index read: the commit it validated. A local read is modmgr's own.
  const read =
    community !== undefined
      ? [
          `as validate read it at ${community.commit.slice(0, 7)}${community.check === 'warnings' ? ', with warnings' : ''}`,
        ]
      : row.readAt !== undefined && row.local !== true
        ? [`as validate read it at ${row.readAt.slice(0, 7)}, in the community index`]
        : []
  const caps: Section = {
    lines: [
      line(Heading(v, 'What it can do')),
      ...(said !== undefined
        ? [line(said)]
        : (notable ?? []).map(text =>
            line(
              <Box flexDirection="row" gap={1}>
                <Text color={TONE.accent}>{GLYPH.notable}</Text>
                <Text>{text}</Text>
              </Box>,
              wrappedRows([text], how.columns - 2),
            ),
          )),
      ...read.map(text =>
        line(
          <Text dimColor wrap="truncate-end">
            {text}
          </Text>,
        ),
      ),
    ],
  }
  return [head, about, caps]
}

/** The catalogue detail's lines, blank rows apart where they fit, and its head's. */
export const foundDetailLines = (
  v: ViewPorts,
  row: CatalogRow | undefined,
  how: FoundDetailHow,
): DetailLines => {
  const { Text } = v.el
  if (row === undefined)
    return { lines: [line(<Text dimColor>Select a mod to see more.</Text>)], head: 0 }
  const sections = foundSections(v, row, how)
  const [head] = sections
  return {
    lines: sectionLines(v, sections, sectionRows(sections, true) <= how.rows),
    head: head?.lines.length ?? 0,
  }
}
