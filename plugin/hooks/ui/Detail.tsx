// A mod's detail: what it is, where it comes from, whether
// it can be toggled here, its notable capabilities, everything it hooks and
// calls grouped by reach, and its other parts. Beside the list (split) in the
// first form that fits its rows; opened by Enter, in full over the whole body,
// scrolling. The action keys sit under the title, so neither hides them. Validate's words are the plugin's own:
// Text only.

import type { RenderElement } from 'claude-code'
import type { ModDetail, ModRow, View } from '../../types/index.d.ts'
import {
  groupByReach,
  type Notable,
  type NotableId,
  notableOf,
  type ReachGroup,
} from '../domain/capabilities.ts'
import { sanitize } from '../domain/sanitize.ts'
import {
  bytesLabel,
  partsLabel,
  whyLocked,
  whyNoRemove,
  whyNoUpdate,
  wrappedRows,
} from '../domain/view.ts'
import {
  type DetailLines,
  GLYPH,
  Heading,
  KeyButton,
  LabelRow,
  line,
  type Section,
  sectionLines,
  sectionRows,
  TONE,
  type ViewPorts,
} from './kit.tsx'

/** The reach groups that are only drawing: named on one line, not explained. */
const QUIET = new Set(['display'])

/** What modmgr does with each of its own notable capabilities (docs/SECURITY.md has the rest). */
const OWN_WHY: Readonly<Partial<Record<NotableId, string>>> = {
  'runs-programs':
    'It runs the claude CLI and nothing else: every install, update, enable and validate goes through it.',
  'reads-and-sends':
    'It reads plugin manifests and its own debug log, and fetches the daily mod indexes from raw.githubusercontent.com. Nothing it reads is sent.',
}
const OWN_WHY_MORE = 'docs/SECURITY.md lists all it reads, fetches and stores.'

const sameFolder = (a: string, b: string): boolean =>
  a.replace(/\/+$/, '') === b.replace(/\/+$/, '')

/** Cells at most for the capability table's group and name columns. */
const LABEL_MAX = 20
const NAME_MAX = 23

export type DetailHow = {
  readonly row: ModRow | undefined
  readonly detail: ModDetail | null
  /** The ids whose staged entry still changes something (`stagedIds`). */
  readonly staged: ReadonlySet<string>
  readonly view: View
  readonly readOnly: boolean
  /** Rows the body has: past them the detail draws closer, then compactly. */
  readonly rows: number
  /** Columns it has, where its prose wraps. */
  readonly columns: number
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
/**
 * The forms tried in turn, the first that fits the body drawn. The blank rows
 * outrank the facts: a full detail without them reads as one block.
 */
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
  columns: number,
): Section => {
  const { Box, Text } = v.el
  return {
    lines: [
      line(heading),
      ...items.flatMap(item => {
        const because = item.because.join(' ')
        return [
          line(
            <Box flexDirection="row" gap={1}>
              <Text color={tone}>{GLYPH.notable}</Text>
              <Text>{item.text}</Text>
            </Box>,
            wrappedRows([item.text], columns - 2),
          ),
          ...(full
            ? [
                line(
                  <Box paddingLeft={2}>
                    <Text dimColor>{because}</Text>
                  </Box>,
                  wrappedRows([because], columns - 2),
                ),
              ]
            : []),
        ]
      }),
    ],
  }
}

/**
 * A hook reads `on <event>`, as a module spells it, so it never passes for the
 * call of that name; the space doesn't break, so a wrapped list never parts them.
 */
const itemName = (item: ReachGroup['items'][number]): string =>
  item.kind === 'event' ? `on\u00a0${item.name}` : item.name

/**
 * Everything it hooks and calls, grouped by reach. In the full form each group
 * is named on its own row and each item follows, its name in a column, then
 * what it does, wrapped under itself; a group that only draws lists its names.
 * Compactly, the command that explains each one, as the full form would,
 * then a table: the reach in the first column, the names beside it. The
 * command comes first, as a detail cut short is cut at its end.
 */
const reachSection = (
  v: ViewPorts,
  id: string,
  groups: readonly ReachGroup[],
  full: boolean,
  columns: number,
): Section => {
  const { Box, Text } = v.el
  const heading = Heading(v, 'What it can do')
  if (groups.length === 0) {
    return { lines: [line(heading), line(<Text dimColor>Nothing beyond loading.</Text>)] }
  }
  const names = (group: ReachGroup) => group.items.map(itemName).join('  ')
  if (!full) {
    // A group that only draws is counted: its names are noise beside the reach
    // that matters, and the full detail and /mods info still list them.
    const said = (group: ReachGroup) =>
      QUIET.has(group.reach)
        ? `${group.items.length} ${group.items.length === 1 ? 'hook or call' : 'hooks and calls'}`
        : names(group)
    const label = Math.min(LABEL_MAX, Math.max(...groups.map(g => g.label.length)))
    // The names wrap beside the label: a cut list hid what the mod reaches.
    const beside = columns - label - 1
    const more = `/mods info ${id} explains each one.`
    return {
      lines: [
        line(heading),
        line(<Text dimColor>{more}</Text>, wrappedRows([more], columns)),
        ...groups.map(group =>
          line(
            LabelRow(
              v,
              group.label,
              label,
              <Box width={beside} flexShrink={1}>
                <Text dimColor={QUIET.has(group.reach)}>{said(group)}</Text>
              </Box>,
            ),
            wrappedRows([said(group)], beside),
          ),
        ),
      ],
    }
  }
  const name = Math.min(
    NAME_MAX,
    Math.max(...groups.flatMap(g => g.items.map(item => itemName(item).length))),
  )
  // What an item does wraps in the column beside its name.
  const said = Math.max(10, columns - 2 - name - 1)
  const lines = groups.flatMap(group => {
    if (QUIET.has(group.reach)) {
      return [
        line(<Text>{group.label}</Text>),
        line(
          <Box paddingLeft={2}>
            <Text dimColor>{names(group)}</Text>
          </Box>,
          wrappedRows([names(group)], columns - 2),
        ),
      ]
    }
    return [
      line(<Text>{group.label}</Text>),
      ...group.items.map(item =>
        line(
          <Box flexDirection="row" gap={1} paddingLeft={2}>
            <Box width={name} flexShrink={0}>
              <Text wrap="truncate-end">{itemName(item)}</Text>
            </Box>
            <Box width={said} flexShrink={0}>
              <Text dimColor>{item.line}</Text>
            </Box>
          </Box>,
          wrappedRows([item.line], said),
        ),
      ),
    ]
  })
  return { lines: [line(heading), ...lines] }
}

/**
 * What the mod says it is, wrapped (a line in the compact form), and its page,
 * a link every surface opens.
 */
const aboutSection = (
  v: ViewPorts,
  detail: ModDetail,
  full: boolean,
  columns: number,
): Section | undefined => {
  const { Text, Link } = v.el
  const said = detail.description === undefined ? '' : sanitize(detail.description, { max: 300 })
  const { link } = detail
  if (said === '' && link === undefined) return undefined
  return {
    lines: [
      ...(said === ''
        ? []
        : [
            full
              ? line(<Text>{said}</Text>, wrappedRows([said], columns))
              : line(<Text wrap="truncate-end">{said}</Text>),
          ]),
      ...(link === undefined
        ? []
        : [
            line(
              <Text dimColor wrap="truncate-end">
                from <Link href={link}>{link.replace(/^https:\/\//, '')}</Link>
              </Text>,
            ),
          ]),
    ],
  }
}

/** The sections under the head, in `form`. */
const bodySections = (
  v: ViewPorts,
  detail: ModDetail | null,
  full: boolean,
  columns: number,
): Section[] => {
  const { Text } = v.el
  if (detail === null) {
    return [{ lines: [line(<Text dimColor>Reading what it can do…</Text>)] }]
  }
  const notable = detail.caps === undefined ? [] : notableOf(detail.caps)
  // The notable items its last update added are drawn apart from the rest.
  const added = detail.capsNew?.added ?? []
  const fresh = notable.filter(item => added.includes(item.id))
  const old = notable.filter(item => !added.includes(item.id))
  const about = aboutSection(v, detail, full, columns)
  const sections: Section[] = about === undefined ? [] : [about]
  if (fresh.length > 0 && detail.capsNew !== undefined) {
    const heading = (
      <Text bold color={TONE.warn}>
        New since {sanitize(detail.capsNew.since, { max: 20 })}
      </Text>
    )
    sections.push(notableSection(v, heading, fresh, TONE.warn, full, columns))
  }
  if (old.length > 0) {
    sections.push(notableSection(v, Heading(v, 'Notable'), old, TONE.accent, full, columns))
  }
  // modmgr's own row (its folder, not its name, which any plugin can take) says why.
  const own = detail.root !== undefined && sameFolder(detail.root, v.ownRoot)
  const why = own ? notable.flatMap(item => OWN_WHY[item.id] ?? []) : []
  if (why.length > 0) {
    const lines = [...why, OWN_WHY_MORE]
    sections.push({
      lines: [
        line(Heading(v, 'Why modmgr needs these')),
        ...lines.map(text => line(<Text dimColor>{text}</Text>, wrappedRows([text], columns))),
      ],
    })
  }
  sections.push(
    reachSection(
      v,
      sanitize(detail.id, { max: 130 }),
      detail.caps === undefined ? [] : groupByReach(detail.caps),
      full,
      columns,
    ),
  )

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
  if (extras.length > 0)
    facts.push(
      <Text dimColor wrap="truncate-end">
        {extras.join(' · ')}
      </Text>,
    )
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
  if (facts.length > 0) sections.push({ lines: facts.map(fact => line(fact)) })
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
  const lockedLine = locked === undefined ? undefined : `${GLYPH.locked} ${locked}`
  const stagedLine =
    staged === undefined
      ? undefined
      : `staged: ${staged ? 'on' : 'off'} after apply (s), after a reload`
  return {
    lines: [
      line(
        <Box flexDirection="row" gap={1}>
          <Text bold>{sanitize(row.name, { max: 64 })}</Text>
          <Text dimColor>
            {row.version === undefined ? '' : sanitize(row.version, { max: 20 })}
          </Text>
        </Box>,
      ),
      line(
        <Box flexDirection="row" gap={1}>
          <Text color={row.enabled ? TONE.ok : TONE.muted}>
            {row.enabled ? `${GLYPH.on} on` : `${GLYPH.off} off`}
          </Text>
          <Text dimColor wrap="truncate-end">
            · {row.scope ?? row.origin} · {sanitize(marketplace, { max: 64 })}
          </Text>
        </Box>,
      ),
      line(
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
        </Box>,
      ),
      ...(lockedLine === undefined
        ? []
        : [
            line(
              <Text color={TONE.warn}>{lockedLine}</Text>,
              wrappedRows([lockedLine], how.columns),
            ),
          ]),
      ...(note === undefined
        ? []
        : [
            line(
              <Text dimColor wrap="truncate-end">
                {GLYPH.update} {note}
              </Text>,
            ),
          ]),
      ...(stagedLine === undefined
        ? []
        : [
            line(
              <Text color={TONE.warn}>{stagedLine}</Text>,
              wrappedRows([stagedLine], how.columns),
            ),
          ]),
    ],
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
    last = {
      sections: [head, ...bodySections(v, detail, form.full, how.columns)],
      spaced: form.spaced,
    }
    if (sectionRows(last.sections, last.spaced) <= how.rows) return last
  }
  return last
}

/**
 * The detail's lines in the first form that fits `how.rows`, and how many the
 * head takes: its name, state and keys, kept in view when it scrolls.
 */
export const detailLines = (v: ViewPorts, how: DetailHow): DetailLines => {
  const { Text } = v.el
  const laid = laidOut(v, how)
  if (laid === undefined)
    return { lines: [line(<Text dimColor>Select a mod to see what it can do.</Text>)], head: 0 }
  const [head] = laid.sections
  return { lines: sectionLines(v, laid.sections, laid.spaced), head: head?.lines.length ?? 0 }
}
