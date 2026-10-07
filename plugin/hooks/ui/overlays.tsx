// The overlays the pane stacks over a view (PLAN §5.3): the review of a
// batch, help generated from the keymap, and the job log.

import type { RenderElement } from 'claude-code'
import type { Job, ModRow, ReviewRequest } from '../../types/index.d.ts'
import { helpFor, type KeySurface } from '../domain/keymap.ts'
import { sanitize } from '../domain/sanitize.ts'
import { commandLine, partsLabel, specsOf } from '../domain/view.ts'
import { GLYPH, Heading, KeyButton, TONE, type ViewPorts } from './kit.tsx'

/** The rows the review draws (Pane clips a taller one to the body). */
export const reviewRows = (review: ReviewRequest): number =>
  1 +
  review.targets.length +
  (review.notable.length === 0 ? 0 : 1 + review.notable.length) +
  (review.alsoDisables === undefined ? 0 : 1) +
  (review.changesRepoFile ? 1 : 0) +
  2 +
  review.targets.length +
  1

export const Review = (
  v: ViewPorts,
  review: ReviewRequest,
  rows: readonly ModRow[],
): RenderElement => {
  const { Box, Text } = v.el
  const count = review.targets.length
  const name = (id: string) => sanitize(rows.find(row => row.id === id)?.name ?? id, { max: 40 })
  const lines = specsOf(review).flatMap(spec => {
    const line = commandLine(spec)
    return line === undefined ? [] : [line]
  })
  return (
    <Box flexDirection="column">
      {Heading(v, `Apply ${count} ${count === 1 ? 'change' : 'changes'}`)}
      {review.targets.map(target => (
        <Box flexDirection="row" gap={1}>
          <Text color={target.enable === false ? TONE.muted : TONE.ok}>
            {target.enable === false ? GLYPH.off : GLYPH.on}
          </Text>
          <Box width={8}>
            <Text>{target.enable === false ? 'disable' : 'enable'}</Text>
          </Box>
          <Text bold>{name(target.id)}</Text>
          <Text dimColor>{target.scope ?? ''}</Text>
        </Box>
      ))}
      {review.notable.length === 0 ? null : (
        <Box flexDirection="column">
          <Text>Turning these on lets them:</Text>
          {review.notable.map(line => (
            <Box flexDirection="row" gap={1} paddingLeft={1}>
              <Text color={TONE.accent}>{GLYPH.notable}</Text>
              <Text>{line}</Text>
            </Box>
          ))}
        </Box>
      )}
      {review.alsoDisables === undefined ? null : (
        <Text color={TONE.warn}>
          Also turns off what they carry: {partsLabel(review.alsoDisables)}.
        </Text>
      )}
      {review.changesRepoFile ? (
        <Text color={TONE.warn}>Changes .claude/settings.json in this repository.</Text>
      ) : null}
      <Text>Takes effect after a plugin reload, which modmgr runs for you.</Text>
      <Text dimColor>Runs</Text>
      {lines.map(line => (
        <Text dimColor wrap="truncate-end">
          {'  '}
          {line}
        </Text>
      ))}
      <Box flexDirection="row" gap={2}>
        {KeyButton(v, {
          action: 'confirm',
          on: 'review',
          label: 'confirm',
          onPress: () => v.act.confirm(),
        })}
        {KeyButton(v, {
          action: 'cancel',
          on: 'review',
          label: 'cancel',
          onPress: () => v.act.cancel(),
        })}
      </Box>
    </Box>
  )
}

/** The rows help draws: its heading, a row per key, the closing line. */
export const helpRows = (surfaces: readonly KeySurface[], hidden: ReadonlySet<string>): number =>
  2 + helpFor(surfaces, hidden).length

export const Help = (
  v: ViewPorts,
  surfaces: readonly KeySurface[],
  hidden: ReadonlySet<string> = new Set(),
): RenderElement => {
  const { Box, Text } = v.el
  return (
    <Box flexDirection="column">
      {Heading(v, 'Keys')}
      {helpFor(surfaces, hidden).map(row => (
        <Box flexDirection="row" gap={1}>
          <Box width={8}>
            <Text color={TONE.accent}>{row.key}</Text>
          </Box>
          <Text>{row.label}</Text>
        </Box>
      ))}
      <Text dimColor>
        Changes are staged with e and applied together with s; z undoes the last batch.
      </Text>
    </Box>
  )
}

const JOB_GLYPH: Readonly<Record<Job['state'], string>> = {
  queued: GLYPH.off,
  running: '…',
  ok: GLYPH.ok,
  failed: GLYPH.failed,
  cancelled: GLYPH.locked,
  interrupted: GLYPH.failed,
}

const JOB_TONE: Readonly<Record<Job['state'], string>> = {
  queued: TONE.muted,
  running: TONE.accent,
  ok: TONE.ok,
  failed: TONE.bad,
  cancelled: TONE.muted,
  interrupted: TONE.bad,
}

/**
 * The newest jobs first, each with its error, and the running or failed one's
 * output tail under it, in as many lines as `rows` allows (review R-M3a-8).
 */
export const Jobs = (v: ViewPorts, jobs: readonly Job[], rows = 14): RenderElement => {
  const { Box, Text } = v.el
  const cancellable =
    jobs.find(job => job.state === 'running' && job.kind === 'test') ??
    jobs.find(job => job.state === 'queued')
  // The heading and the cancel key take a row each.
  const budget = Math.max(1, rows - 1 - (cancellable === undefined ? 0 : 1))
  const lines: RenderElement[] = []
  let shown = 0
  for (const job of [...jobs].reverse()) {
    const own: RenderElement[] = [
      <Box flexDirection="row" gap={1}>
        <Text color={JOB_TONE[job.state]}>{JOB_GLYPH[job.state]}</Text>
        <Text>{job.kind === 'reload' ? 'reload plugins' : job.kind}</Text>
        {job.target === undefined ? null : (
          <Text dimColor>{sanitize(job.target, { max: 60 })}</Text>
        )}
        <Text dimColor>{job.state}</Text>
      </Box>,
    ]
    if (job.error !== undefined) {
      own.push(
        <Text color={TONE.bad} wrap="truncate-end">
          {'  '}
          {sanitize(job.error.message, { max: 200 })}
        </Text>,
      )
    }
    if (job.state === 'running' || job.state === 'failed') {
      for (const line of job.tail.slice(-5)) {
        own.push(
          <Text dimColor wrap="truncate-end">
            {'  '}
            {sanitize(line, { max: 200 })}
          </Text>,
        )
      }
    }
    if (lines.length + 1 > budget) break
    lines.push(...own.slice(0, budget - lines.length))
    shown += 1
  }
  const older = jobs.length - shown
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        {Heading(v, 'Jobs')}
        {older > 0 && shown > 0 ? (
          <Text dimColor>
            (newest {shown}; {older} older)
          </Text>
        ) : null}
      </Box>
      {jobs.length === 0 ? <Text dimColor>Nothing has run yet.</Text> : null}
      {lines}
      {cancellable === undefined
        ? null
        : KeyButton(v, {
            action: 'cancel-job',
            on: 'jobs',
            label: `cancel ${cancellable.kind}`,
            onPress: () => v.act.cancelJob(cancellable.id),
          })}
    </Box>
  )
}
