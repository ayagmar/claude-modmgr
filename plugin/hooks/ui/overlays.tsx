// The overlays the pane stacks over a view (PLAN §5.3): the review of a
// batch, help generated from the keymap, and the job log.

import type { RenderElement } from 'claude-code'
import type { Job, ModRow, ReviewOp, ReviewRequest } from '../../types/index.d.ts'
import { helpFor, type KeySurface } from '../domain/keymap.ts'
import { sanitize } from '../domain/sanitize.ts'
import { bytesLabel, commandLine, nameOf, partsLabel, specsOf } from '../domain/view.ts'
import { GLYPH, Heading, KeyButton, TONE, type ViewPorts } from './kit.tsx'

const OP: Readonly<
  Record<ReviewOp, { readonly glyph: string; readonly verb: string; readonly tone: string }>
> = {
  enable: { glyph: GLYPH.on, verb: 'enable', tone: TONE.ok },
  disable: { glyph: GLYPH.off, verb: 'disable', tone: TONE.muted },
  update: { glyph: GLYPH.update, verb: 'update', tone: TONE.accent },
  remove: { glyph: GLYPH.failed, verb: 'remove', tone: TONE.bad },
  install: { glyph: GLYPH.on, verb: 'reinstall', tone: TONE.ok },
}

const headingOf = (review: ReviewRequest, name: (id: string) => string): string => {
  const count = review.targets.length
  const only = review.targets[0]
  switch (review.action) {
    case 'update':
      return count === 1 && only !== undefined ? `Update ${name(only.id)}` : `Update ${count} mods`
    case 'remove':
      return only === undefined ? 'Remove' : `Remove ${name(only.id)}`
    case 'undo':
      return 'Undo the last batch'
    default:
      return `Apply ${count} ${count === 1 ? 'change' : 'changes'}`
  }
}

/** A line of the review and its text, from which the rows it wraps to are counted. */
type Line = { readonly el: RenderElement; readonly text: string }

/**
 * The review's lines (Pane clips a taller review to the body). The keys come
 * right under the heading, so a clipped review keeps them.
 */
const reviewLines = (v: ViewPorts, review: ReviewRequest, rows: readonly ModRow[]): Line[] => {
  const { Box, Text } = v.el
  // A mod being reinstalled is no longer a row: its id names it.
  const name = (id: string) =>
    sanitize(rows.find(row => row.id === id)?.name ?? nameOf(id), { max: 40 })
  const removing = review.action === 'remove'
  const keepData = review.keepData !== false
  const heading = headingOf(review, name)
  // What `y` does is said on `y` itself once the data goes too (review R-M3b-5).
  const confirmLabel = removing && !keepData ? 'remove and wipe its data' : 'confirm'
  const dataLabel = keepData ? 'wipe its data too' : 'keep its data'
  const offersData = removing && review.dataBytes !== undefined
  const keyLabels = [`y: ${confirmLabel}`, 'n: cancel', ...(offersData ? [`w: ${dataLabel}`] : [])]
  const lines: Line[] = [
    { el: Heading(v, heading), text: heading },
    {
      text: keyLabels.join('  '),
      el: (
        <Box flexDirection="row" columnGap={2} flexWrap="wrap">
          {KeyButton(v, {
            action: 'confirm',
            on: 'review',
            label: confirmLabel,
            onPress: () => v.act.confirm(),
          })}
          {KeyButton(v, {
            action: 'cancel',
            on: 'review',
            label: 'cancel',
            onPress: () => v.act.cancel(),
          })}
          {offersData
            ? KeyButton(v, {
                action: 'keep-data',
                on: 'review',
                label: dataLabel,
                onPress: () => v.act.keepData(),
              })
            : null}
        </Box>
      ),
    },
  ]
  const push = (el: RenderElement, text: string) => lines.push({ el, text })
  for (const target of review.targets) {
    const op = OP[target.op]
    const meta = [
      target.version === undefined ? '' : sanitize(target.version, { max: 20 }),
      target.scope ?? '',
    ]
      .filter(part => part !== '')
      .join(' · ')
    push(
      <Box flexDirection="row" gap={1}>
        <Text color={op.tone}>{op.glyph}</Text>
        <Box width={9} flexShrink={0}>
          <Text>{op.verb}</Text>
        </Box>
        <Text bold>{name(target.id)}</Text>
        <Text dimColor>{meta}</Text>
      </Box>,
      `x ${op.verb.padEnd(9)} ${name(target.id)} ${meta}`,
    )
  }
  const say = (text: string, tone?: string) =>
    push(tone === undefined ? <Text>{text}</Text> : <Text color={tone}>{text}</Text>, text)
  if (review.notable.length > 0) {
    say(review.action === 'undo' ? 'What comes back can:' : 'Turning these on lets them:')
    for (const line of review.notable) {
      push(
        <Box flexDirection="row" gap={1} paddingLeft={1}>
          <Text color={TONE.accent}>{GLYPH.notable}</Text>
          <Text>{line}</Text>
        </Box>,
        `  x ${line}`,
      )
    }
  }
  if (review.parts !== undefined) {
    say(
      `${removing ? 'Also removes what it carries' : 'Also turns off what they carry'}: ${partsLabel(review.parts)}.`,
      TONE.warn,
    )
  }
  if (review.action === 'update') {
    const marketplaces = review.marketplaces ?? []
    if (marketplaces.length > 0) {
      say(`Refreshes ${marketplaces.map(m => sanitize(m, { max: 40 })).join(', ')} first.`)
    }
    // modmgr hasn't checked that a newer version exists (detection is M5b's).
    say('If a newer version exists, its code runs')
    say('after the reload; modmgr shows what is new.')
    say("An update can't be undone.", TONE.warn)
  }
  if (removing) {
    if (review.dataBytes === undefined) say('It keeps no data.')
    else if (keepData) say(`Keeps its data (${bytesLabel(review.dataBytes)}): undo restores it.`)
    else say(`Deletes its data (${bytesLabel(review.dataBytes)}) for good.`, TONE.bad)
    say('Undo (z) reinstalls it from its marketplace.')
  }
  const reinstalls = review.targets.filter(target => target.op === 'install')
  if (reinstalls.length > 0) {
    say("Reinstalls the marketplace's current version.")
    // Only what the CLI said about the data (R-M3b-6); nothing when it said nothing.
    for (const target of reinstalls) {
      if (target.keptData === true) say(`${name(target.id)}: its data was kept.`)
      if (target.keptData === false) say(`${name(target.id)}: its data went with it.`)
    }
    say('A declared install command stops it,', TONE.warn)
    say('shown first; nothing runs unaccepted.', TONE.warn)
  }
  if (review.changesRepoFile) {
    say('Changes .claude/settings.json in this repository.', TONE.warn)
  }
  say('Takes effect after the reload modmgr runs.')
  push(<Text dimColor>Runs</Text>, 'Runs')
  for (const spec of specsOf(review)) {
    const line = commandLine(spec)
    if (line === undefined) continue
    // One row each: cut at the frame, not wrapped.
    push(
      <Text dimColor wrap="truncate-end">
        {'  '}
        {line}
      </Text>,
      '',
    )
  }
  return lines
}

/** The rows the review draws at `columns`: each line's text, wrapped. */
export const reviewRows = (
  v: ViewPorts,
  review: ReviewRequest,
  rows: readonly ModRow[],
  columns: number,
): number =>
  reviewLines(v, review, rows).reduce(
    (sum, line) => sum + Math.max(1, Math.ceil(line.text.length / Math.max(1, columns))),
    0,
  )

export const Review = (
  v: ViewPorts,
  review: ReviewRequest,
  rows: readonly ModRow[],
): RenderElement => {
  const { Box } = v.el
  return <Box flexDirection="column">{reviewLines(v, review, rows).map(line => line.el)}</Box>
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
    // A job that found nothing to do says so in its tail (R-M3b-1).
    if (job.state === 'running' || job.state === 'failed' || job.unchanged === true) {
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
