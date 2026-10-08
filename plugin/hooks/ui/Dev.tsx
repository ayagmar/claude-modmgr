// Dev: the mods this session runs from a folder the person
// edits, their last validate and test, and the failures the session reported
// while hot-reloading them; a row's detail, and how to share it. Rows are
// plain Buttons keyed `dev:<key>` (Enter opens the detail). Names, paths,
// validate's and test's words are the plugin's own: sanitised, drawn as Text.

import type { RenderElement } from 'claude-code'
import type { DevFailures, DevRow, DevShare, Job } from '../../types/index.d.ts'
import {
  appliesOf,
  devKey,
  HOW_SHORT,
  lastRun,
  type RunMark,
  SECTION_LABEL,
  stopLoadingOf,
  testMark,
  validateMark,
} from '../domain/dev.ts'
import { sanitize } from '../domain/sanitize.ts'
import { type Window, wrappedRows } from '../domain/view.ts'
import {
  GLYPH,
  Heading,
  HiddenRows,
  KeyButton,
  LabelRow,
  Pointer,
  type Section,
  Sections,
  sectionRows,
  TONE,
  type ViewPorts,
} from './kit.tsx'

/** Lines of a run's output the detail shows (the job log has the rest). */
const TAIL_SHOWN = 6

const MARK_TONE: Readonly<Record<RunMark['tone'], string>> = {
  busy: TONE.accent,
  ok: TONE.ok,
  bad: TONE.bad,
  muted: TONE.muted,
}

export type DevHow = {
  readonly jobs: readonly Job[]
  readonly failures: Readonly<Record<string, DevFailures>>
}

const marksOf = (row: DevRow, how: DevHow): RunMark[] => {
  // A failure first: a narrow row keeps what it cuts last.
  const marks: RunMark[] = []
  const failed = how.failures[row.name]
  if (failed !== undefined) marks.push({ text: `${GLYPH.problem}${failed.count}`, tone: 'bad' })
  const valid = validateMark(lastRun(how.jobs, 'validate', row.path))
  const tests = testMark(lastRun(how.jobs, 'test', row.path))
  if (valid !== undefined) marks.push(valid)
  if (tests !== undefined) marks.push(tests)
  return marks
}

/** A dev row's Button: Enter opens the detail, or moves onto it beside the list. */
const devButton = (
  v: ViewPorts,
  row: DevRow,
  how: { readonly max: number; readonly focus: boolean; readonly beside: boolean },
): RenderElement => {
  const { Button } = v.el
  return (
    <Button
      key={devKey(row.key)}
      plain
      label={sanitize(row.name, { max: how.max })}
      {...(how.focus ? { autoFocus: true as const } : {})}
      onPress={() => (how.beside ? v.act.toDetail() : v.act.openDev(row.key))}
    />
  )
}

export const DevLine = (
  v: ViewPorts,
  row: DevRow,
  how: DevHow & { readonly columns: number; readonly focus: boolean; readonly beside: boolean },
): RenderElement => {
  const { Box, Text } = v.el
  const wide = how.columns >= 60
  const name = Math.max(8, Math.min(32, how.columns - 4 - (wide ? 14 : 0) - 18))
  return (
    <Box key={`line:${row.key}`} flexDirection="row" gap={1}>
      {Pointer(v, how.focus)}
      <Text color={row.enabled === false ? TONE.muted : TONE.ok}>
        {row.enabled === undefined ? ' ' : row.enabled ? GLYPH.on : GLYPH.off}
      </Text>
      <Box width={name} flexShrink={0}>
        {devButton(v, row, { max: name, focus: how.focus, beside: how.beside })}
      </Box>
      {wide ? (
        <Box width={13} flexShrink={0}>
          <Text dimColor wrap="truncate-end">
            {HOW_SHORT[row.how]}
          </Text>
        </Box>
      ) : null}
      <Box flexDirection="row" gap={1} flexShrink={1} height={1} overflow="hidden">
        {marksOf(row, how).map(mark => (
          <Text key={mark.text} color={MARK_TONE[mark.tone]}>
            {mark.text}
          </Text>
        ))}
      </Box>
    </Box>
  )
}

/** The rows in the window, or what stands in for them. */
export const DevList = (
  v: ViewPorts,
  rows: readonly DevRow[],
  how: DevHow & {
    readonly columns: number
    readonly window: Window
    readonly focusKey: string | undefined
    readonly loading: boolean
    readonly beside: boolean
  },
): RenderElement => {
  const { Box, Text } = v.el
  if (rows.length === 0) {
    const lines = how.loading
      ? ['Looking for mods under development…']
      : [
          'No mods under development in this session.',
          'Run one from its folder with claude --plugin-dir <folder>, or name it in CLAUDE_CODE_PLUGIN_DIRS; a folder marketplace or your skills folder works too.',
        ]
    return (
      <Box flexDirection="column">
        {lines.map((line, index) => (
          <Text key={`empty:${index}`} dimColor>
            {line}
          </Text>
        ))}
      </Box>
    )
  }
  const hidden = (shown: readonly DevRow[]) =>
    HiddenRows(
      v,
      shown.map(row => devButton(v, row, { max: 64, focus: false, beside: how.beside })),
    )
  return (
    <Box flexDirection="column">
      {hidden(rows.slice(0, how.window.start))}
      {rows.slice(how.window.start, how.window.end).map(row =>
        DevLine(v, row, {
          jobs: how.jobs,
          failures: how.failures,
          columns: how.columns,
          focus: row.key === how.focusKey,
          beside: how.beside,
        }),
      )}
      {hidden(rows.slice(how.window.end))}
    </Box>
  )
}

/** A test's last lines of output; a validate's first findings (its first line is the counts). */
const tailOf = (job: Job | undefined): readonly string[] => {
  if (job === undefined) return []
  const lines =
    job.kind === 'validate' ? job.tail.slice(1, 1 + TAIL_SHOWN) : job.tail.slice(-TAIL_SHOWN)
  return lines.map(line => sanitize(line, { max: 300 }))
}

export type DevDetailHow = DevHow & {
  readonly readOnly: boolean
  /** Rows and columns the detail has: past the rows it draws without blank rows. */
  readonly rows: number
  readonly columns: number
}

/** A run's mark beside its name, its output under it, cut at the frame. */
const runLines = (
  v: ViewPorts,
  label: string,
  mark: RunMark | undefined,
  idle: string,
  job: Job | undefined,
): { readonly rows: number; readonly el: RenderElement } => {
  const { Box, Text } = v.el
  const tail = tailOf(job)
  return {
    rows: 1 + tail.length,
    el: (
      <Box flexDirection="column">
        {LabelRow(
          v,
          label,
          8,
          mark === undefined ? (
            <Text dimColor>{idle}</Text>
          ) : (
            <Text color={MARK_TONE[mark.tone]}>{mark.text}</Text>
          ),
        )}
        {tail.map((line, index) => (
          <Box key={`tail:${index}`} paddingLeft={2}>
            <Text dimColor wrap="truncate-end">
              {line}
            </Text>
          </Box>
        ))}
      </Box>
    ),
  }
}

/** The head, where it loads from, and what its checks and the session said. */
const devSections = (v: ViewPorts, row: DevRow, how: DevDetailHow): Section[] => {
  const { Box, Text } = v.el
  const runs = !how.readOnly
  const { path } = row
  const keys = [...(runs ? ['v: validate', 't: test'] : []), 'c: copy path', 'p: share'].join('  ')
  const head: Section = {
    rows: 1 + wrappedRows([keys], how.columns),
    el: (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text bold>{sanitize(row.name, { max: 64 })}</Text>
          <Text dimColor>
            {row.version === undefined ? '' : sanitize(row.version, { max: 20 })}
          </Text>
        </Box>
        <Box flexDirection="row" columnGap={2} flexWrap="wrap">
          {runs
            ? KeyButton(v, {
                action: 'validate',
                on: 'dev-detail',
                label: 'validate',
                onPress: () => v.act.devRun('validate', row.key),
              })
            : null}
          {runs
            ? KeyButton(v, {
                action: 'test',
                on: 'dev-detail',
                label: 'test',
                onPress: () => v.act.devRun('test', row.key),
              })
            : null}
          {KeyButton(v, {
            action: 'copy',
            on: 'dev-detail',
            label: 'copy path',
            onPress: press => v.act.copy(path, press.surface),
          })}
          {KeyButton(v, {
            action: 'share',
            on: 'dev-detail',
            label: 'share',
            onPress: () => v.act.share(row.key),
          })}
        </Box>
      </Box>
    ),
  }
  const shownPath = sanitize(path, { max: 300 })
  const said = [appliesOf(row.how), stopLoadingOf(row)].filter(
    (line): line is string => line !== undefined,
  )
  const source: Section = {
    rows: 1 + wrappedRows([shownPath, ...said], how.columns),
    el: (
      <Box flexDirection="column">
        {Heading(v, SECTION_LABEL[row.how])}
        <Text>{shownPath}</Text>
        {said.map((line, index) => (
          <Text key={`said:${index}`} dimColor>
            {line}
          </Text>
        ))}
      </Box>
    ),
  }
  const validate = lastRun(how.jobs, 'validate', row.path)
  const test = lastRun(how.jobs, 'test', row.path)
  const checks = [
    runLines(v, 'Validate', validateMark(validate), 'not run yet (v)', validate),
    runLines(v, 'Tests', testMark(test), 'not run yet (t)', test),
  ]
  const failed = how.failures[row.name]
  const failure =
    failed === undefined
      ? []
      : [
          `${GLYPH.problem} ${failed.count} ${failed.count === 1 ? 'failure' : 'failures'} reported while it reloaded`,
        ]
  const check: Section = {
    rows:
      1 +
      checks.reduce((sum, run) => sum + run.rows, 0) +
      (failed === undefined ? 0 : wrappedRows(failure, how.columns) + 1),
    el: (
      <Box flexDirection="column">
        {Heading(v, 'Checks')}
        {checks.map(run => run.el)}
        {failed === undefined ? null : <Text color={TONE.bad}>{failure[0]}</Text>}
        {failed === undefined ? null : (
          <Box paddingLeft={2}>
            <Text dimColor wrap="truncate-end">
              last: {failed.lastReason}
            </Text>
          </Box>
        )}
      </Box>
    ),
  }
  return [head, source, check]
}

/** The rows the dev detail takes (Pane clips a taller one to the body). */
export const devDetailRows = (v: ViewPorts, row: DevRow | undefined, how: DevDetailHow): number => {
  if (row === undefined) return 1
  const sections = devSections(v, row, how)
  return sectionRows(sections, sectionRows(sections, true) <= how.rows)
}

export const DevDetail = (
  v: ViewPorts,
  row: DevRow | undefined,
  how: DevDetailHow,
): RenderElement => {
  const { Text } = v.el
  if (row === undefined) return <Text dimColor>Select a mod to see more.</Text>
  const sections = devSections(v, row, how)
  return Sections(v, sections, sectionRows(sections, true) <= how.rows)
}

/** The share overlay's lines of text. */
const shareText = (share: DevShare): string[] => [
  `Share ${sanitize(share.name, { max: 64 })}`,
  'Another person installs it with:',
  `  ${share.line}`,
  ...share.notes,
  ...(share.snippet === undefined ? [] : share.snippet.split('\n')),
]

/** The rows the share overlay takes at `columns` (its keys row included). */
export const shareRows = (share: DevShare | undefined, columns: number): number =>
  share === undefined ? 1 : wrappedRows(shareText(share), columns) + 1

/**
 * How to share a dev mod (`p`, the engine's reference, §Sharing a mod): the one install line
 * another person types, copied with `c`, and what is missing for it to work.
 * Nothing is written: the marketplace file is shown, not created.
 */
export const Share = (v: ViewPorts, share: DevShare | undefined): RenderElement => {
  const { Box, Text } = v.el
  if (share === undefined) return <Text dimColor>Nothing to share.</Text>
  const [heading, intro, line, ...rest] = shareText(share)
  return (
    <Box flexDirection="column">
      {Heading(v, heading ?? '')}
      <Box flexDirection="row" columnGap={2} flexWrap="wrap">
        {KeyButton(v, {
          action: 'copy',
          on: 'share',
          label: 'copy the install line',
          onPress: press => v.act.copy(share.line, press.surface),
        })}
      </Box>
      <Text dimColor>{intro}</Text>
      <Text color={share.complete ? TONE.accent : TONE.warn}>{line}</Text>
      {rest.map((text, index) => (
        <Text key={`share:${index}`} dimColor>
          {text}
        </Text>
      ))}
    </Box>
  )
}
