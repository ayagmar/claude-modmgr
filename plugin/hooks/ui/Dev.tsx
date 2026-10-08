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
import { GLYPH, Heading, KeyButton, Pointer, TONE, type ViewPorts } from './kit.tsx'

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

export const DevLine = (
  v: ViewPorts,
  row: DevRow,
  how: DevHow & { readonly columns: number; readonly focus: boolean },
): RenderElement => {
  const { Box, Button, Text } = v.el
  const wide = how.columns >= 60
  const name = Math.max(8, Math.min(32, how.columns - 4 - (wide ? 14 : 0) - 18))
  return (
    <Box key={`line:${row.key}`} flexDirection="row" gap={1}>
      {Pointer(v, how.focus)}
      <Text color={row.enabled === false ? TONE.muted : TONE.ok}>
        {row.enabled === undefined ? ' ' : row.enabled ? GLYPH.on : GLYPH.off}
      </Text>
      <Box width={name} flexShrink={0}>
        <Button
          key={devKey(row.key)}
          plain
          label={sanitize(row.name, { max: name })}
          {...(how.focus ? { autoFocus: true as const } : {})}
          onPress={() => v.act.openDev(row.key)}
        />
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
  return (
    <Box flexDirection="column">
      {rows.slice(how.window.start, how.window.end).map(row =>
        DevLine(v, row, {
          jobs: how.jobs,
          failures: how.failures,
          columns: how.columns,
          focus: row.key === how.focusKey,
        }),
      )}
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

/** A line of the detail: prose wraps; a line of output is cut at the frame. */
type DetailLine = { readonly text: string; readonly tone?: string; readonly output?: true }

/** What the detail says, line by line (its row count clips it). */
const detailLines = (row: DevRow, how: DevHow): DetailLine[] => {
  const lines: DetailLine[] = []
  lines.push({ text: SECTION_LABEL[row.how] })
  lines.push({ text: sanitize(row.path, { max: 300 }) })
  lines.push({ text: appliesOf(row.how) })
  const stop = stopLoadingOf(row)
  if (stop !== undefined) lines.push({ text: stop })
  const validate = lastRun(how.jobs, 'validate', row.path)
  const valid = validateMark(validate)
  lines.push({
    text: valid === undefined ? 'Not validated yet (v).' : `Validate: ${valid.text}`,
    ...(valid === undefined ? {} : { tone: MARK_TONE[valid.tone] }),
  })
  for (const line of tailOf(validate)) lines.push({ text: `  ${line}`, output: true })
  const test = lastRun(how.jobs, 'test', row.path)
  const tests = testMark(test)
  lines.push({
    text: tests === undefined ? 'Not tested yet (t).' : `Tests: ${tests.text}`,
    ...(tests === undefined ? {} : { tone: MARK_TONE[tests.tone] }),
  })
  for (const line of tailOf(test)) lines.push({ text: `  ${line}`, output: true })
  const failed = how.failures[row.name]
  if (failed !== undefined) {
    lines.push({
      text: `${GLYPH.problem} ${failed.count} ${failed.count === 1 ? 'failure' : 'failures'} reported while it reloaded`,
      tone: TONE.bad,
    })
    lines.push({ text: `  last: ${failed.lastReason}`, output: true })
  }
  return lines
}

/** The rows the dev detail takes at `columns` (Pane clips a taller one to the body). */
export const devDetailRows = (
  row: DevRow | undefined,
  how: DevHow,
  actions: boolean,
  columns: number,
): number => {
  if (row === undefined) return 1
  const lines = detailLines(row, how)
  const prose = lines.filter(line => line.output !== true).map(line => line.text)
  // The keys row: four labels at most, wrapping like the footer's.
  const keys = actions ? wrappedRows(['v: validate  t: test  c: copy path  p: share'], columns) : 0
  return 1 + keys + wrappedRows(prose, columns) + (lines.length - prose.length)
}

export const DevDetail = (
  v: ViewPorts,
  row: DevRow | undefined,
  how: DevHow & { readonly actions: boolean; readonly readOnly: boolean },
): RenderElement => {
  const { Box, Text } = v.el
  if (row === undefined) return <Text dimColor>Select a mod to see more.</Text>
  const runs = !how.readOnly
  const { path } = row
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text bold>{sanitize(row.name, { max: 64 })}</Text>
        <Text dimColor>{row.version === undefined ? '' : sanitize(row.version, { max: 20 })}</Text>
      </Box>
      {how.actions ? (
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
      ) : null}
      {detailLines(row, how).map((line, index) => {
        const wrap = line.output === true ? ('truncate-end' as const) : ('wrap' as const)
        return line.tone === undefined ? (
          <Text key={`detail:${index}`} dimColor wrap={wrap}>
            {line.text}
          </Text>
        ) : (
          <Text key={`detail:${index}`} color={line.tone} wrap={wrap}>
            {line.text}
          </Text>
        )
      })}
    </Box>
  )
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
