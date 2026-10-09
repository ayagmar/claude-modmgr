// The overlays the pane stacks over a view: the review of a
// batch, help generated from the keymap, and the job log.

import type { RenderElement } from 'claude-code'
import type { Job, ModRow, ReviewOp, ReviewRequest } from '../../types/index.d.ts'
import { INSTALL_SCOPES, isInstallScope, MARKETPLACE_KEY, SCOPE_LABEL } from '../domain/discover.ts'
import { SHOWN_MAX } from '../domain/jobs.ts'
import { helpFor, type KeySurface } from '../domain/keymap.ts'
import { hasHiddenCharacters, sanitize } from '../domain/sanitize.ts'
import {
  bytesLabel,
  cellRows,
  commandLine,
  lineWindow,
  marketplaceOf,
  nameOf,
  partsLabel,
  specsOf,
  wrappedRows,
} from '../domain/view.ts'
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
    case 'install':
      // From an untrusted catalogue: the marketplace beside the name.
      return only === undefined
        ? 'Install'
        : `Install ${name(only.id)} from ${sanitize(marketplaceOf(only.id), { max: 40 })}`
    case 'marketplace':
      return 'Add a marketplace'
    default:
      return `Apply ${count} ${count === 1 ? 'change' : 'changes'}`
  }
}

/**
 * A line of an overlay and its text, from which the rows it wraps to are
 * counted; `rows` where it never wraps (a truncated row of columns).
 */
type Line = { readonly el: RenderElement; readonly text: string; readonly rows?: number }

/** What the review knows beyond the request: Claude Code refused an acceptance from here. */
export type ReviewHow = { readonly refused: boolean }

/** The terminal command a person runs to accept a declared command themselves. */
const terminalCommand = (review: ReviewRequest): string | undefined => {
  const target = review.targets[0]
  if (target === undefined) return undefined
  const scope =
    target.scope === undefined || target.scope === 'user' ? '' : ` --scope ${target.scope}`
  return `claude plugin ${target.op === 'update' ? 'update' : 'install'} ${target.id}${scope}`
}

/**
 * The review's lines. The heading and the keys come first: a review taller
 * than its window keeps them and scrolls the rest.
 */
const reviewLines = (
  v: ViewPorts,
  review: ReviewRequest,
  rows: readonly ModRow[],
  how: ReviewHow,
  columns: number,
): Line[] => {
  const { Box, Text, Select } = v.el
  const declared = review.declaredCommand ?? review.headersHelper
  // Accepted in a terminal, never here: refused from this session, too long to
  // show whole, or holding characters the review can't show as they are.
  const hidden = declared !== undefined && hasHiddenCharacters(declared.text)
  const blocked = declared !== undefined && (how.refused || declared.truncated === true || hidden)
  const terminal = blocked ? terminalCommand(review) : undefined
  // A mod being reinstalled is no longer a row: its id names it.
  const name = (id: string) =>
    sanitize(rows.find(row => row.id === id)?.name ?? nameOf(id), { max: 40 })
  const removing = review.action === 'remove'
  const keepData = review.keepData !== false
  const heading = headingOf(review, name)
  // What `y` does is said on `y` itself once the data goes too.
  const confirmLabel =
    removing && !keepData
      ? 'remove and wipe its data'
      : declared !== undefined
        ? 'run it and install'
        : 'confirm'
  const dataLabel = keepData ? 'wipe its data too' : 'keep its data'
  const offersData = removing && review.dataBytes !== undefined
  const keyLabels = [
    ...(blocked ? ['c: copy the terminal command'] : [`y: ${confirmLabel}`]),
    'n: cancel',
    ...(offersData ? [`w: ${dataLabel}`] : []),
  ]
  const lines: Line[] = [
    { el: Heading(v, heading), text: heading },
    {
      text: keyLabels.join('  '),
      el: (
        <Box flexDirection="row" columnGap={2} flexWrap="wrap">
          {terminal !== undefined
            ? KeyButton(v, {
                action: 'copy',
                on: 'review',
                label: 'copy the terminal command',
                onPress: press => v.act.copy(terminal, press.surface),
              })
            : KeyButton(v, {
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
  // A blank row between the keys, what changes, what it means, and what runs.
  const gap = () => push(<Text> </Text>, '')
  gap()
  const scoped = review.targets[0]?.scope
  // The scope is chosen here; a declared command's sha is bound to the
  // install it was shown for, so that review keeps its scope.
  const scopeLabel = SCOPE_LABEL[isInstallScope(scoped) ? scoped : 'user']
  if (review.action === 'install' && declared === undefined && Select !== undefined) {
    push(
      <Select
        key="scope"
        label="scope"
        options={INSTALL_SCOPES.map(scope => ({ value: scope, label: SCOPE_LABEL[scope] }))}
        value={scoped ?? 'user'}
        onSelect={value => v.act.scope(value)}
      />,
      `scope: ${scopeLabel} ▾`,
    )
  } else if (review.action === 'install' && declared === undefined) {
    // No picker on this surface: the scope is said, and it is the safe one.
    push(<Text dimColor>{`scope: ${scopeLabel}`}</Text>, `scope: ${scopeLabel}`)
  }
  for (const target of review.targets) {
    const op = OP[target.op]
    const verb = review.action === 'install' && target.op === 'install' ? 'install' : op.verb
    const meta = [
      target.version === undefined ? '' : sanitize(target.version, { max: 20 }),
      review.action === 'install' ? sanitize(marketplaceOf(target.id), { max: 40 }) : '',
      target.scope ?? '',
    ]
      .filter(part => part !== '')
      .join(' · ')
    push(
      <Box flexDirection="row" gap={1}>
        <Text color={op.tone}>{op.glyph}</Text>
        <Box width={9} flexShrink={0}>
          <Text>{verb}</Text>
        </Box>
        <Text bold>{name(target.id)}</Text>
        <Text dimColor>{meta}</Text>
      </Box>,
      `x ${verb.padEnd(9)} ${name(target.id)} ${meta}`,
    )
  }
  gap()
  const say = (text: string, tone?: string) =>
    push(tone === undefined ? <Text>{text}</Text> : <Text color={tone}>{text}</Text>, text)
  if (review.notable.length > 0) {
    say(
      review.action === 'undo'
        ? 'What comes back can:'
        : review.action === 'install'
          ? 'Installing it lets it:'
          : 'Turning these on lets them:',
    )
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
    // The review doesn't say whether a newer version exists: an update finds out.
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
  if (review.action === 'install' && review.source !== undefined) {
    const source = sanitize(review.source, { max: 120 })
    say(`From the marketplace at github.com/${source}:`)
    say('the install adds it to your user settings first')
    say('(a clone; adding runs no plugin code).')
  }
  if (review.action === 'install' && review.indexedAt !== undefined) {
    say(`What it can do was read at ${review.indexedAt.slice(0, 7)}; modmgr`)
    say('reads the installed version again.')
  }
  if (review.action === 'install' && review.uninspected === true && declared === undefined) {
    if (review.unreadable !== undefined) {
      // A local entry it tried to read and couldn't: not the same as a remote one.
      say("modmgr couldn't read what it can do before", TONE.warn)
      say(`installing: ${sanitize(review.unreadable, { max: 160 })}`, TONE.warn)
      say('Its detail says what it can do once installed.')
    } else {
      say('modmgr reads what it can do once it is installed,')
      say('and shows it in its detail then.')
    }
  }
  if (declared !== undefined) {
    say(
      review.headersHelper === undefined
        ? 'Its marketplace runs this command on your machine:'
        : 'Its marketplace fetches the archive with this command:',
      TONE.warn,
    )
    // Line for line, never cut, each line in rows of the window's width: a
    // line taller than the window still scrolls into view a row at a time.
    // What sanitising removed is said.
    const width = Math.max(1, columns - 2)
    for (const line of sanitize(declared.text, { max: SHOWN_MAX, multiline: true }).split('\n')) {
      for (const row of cellRows(line, width)) push(<Text bold>{`  ${row}`}</Text>, `  ${row}`)
    }
    say(`sha256 ${declared.sha256.slice(0, 16)}…`)
    if (declared.truncated === true) {
      say('It is longer than modmgr shows, so it is not', TONE.bad)
      say('accepted here. Read and accept it in a terminal:', TONE.bad)
      say(terminal ?? '', TONE.bad)
    } else if (hidden) {
      say('It holds hidden or control characters, removed', TONE.bad)
      say('above, so it is not accepted here. Read and', TONE.bad)
      say(`accept it in a terminal: ${terminal ?? ''}`, TONE.bad)
    } else if (blocked) {
      say('Claude Code refuses to accept it from this session:', TONE.bad)
      say('accept it in /plugin, its details, or run this', TONE.bad)
      say(`in a terminal: ${terminal ?? ''}`, TONE.bad)
    } else {
      say('It runs once, and only while it is still this', TONE.warn)
      say('very command; a changed one is shown again.', TONE.warn)
    }
  }
  if (review.action === 'marketplace' && review.source !== undefined) {
    push(<Text bold>{`  ${sanitize(review.source, { max: 300 })}`}</Text>, `  ${review.source}`)
    say('Fetches its catalogue (a clone, for a repository)')
    say('and adds it to your settings; it runs no plugin code.')
  }
  const reinstalls = review.targets.filter(
    target => target.op === 'install' && review.action === 'undo',
  )
  if (reinstalls.length > 0) {
    say("Reinstalls the marketplace's current version.")
    // Only what the CLI said about the data; nothing when it said nothing.
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
  if (review.action !== 'marketplace') say('Takes effect after the reload modmgr runs.')
  gap()
  push(<Text dimColor>Runs</Text>, 'Runs')
  for (const spec of specsOf(review)) {
    const line = commandLine(spec)
    if (line === undefined) continue
    // Whole, wrapped: a review shows what will run, never part of it.
    push(
      <Box paddingLeft={2}>
        <Text dimColor>{line}</Text>
      </Box>,
      `  ${line}`,
    )
  }
  return lines
}

/** The rows an overlay is given, and the first line below what it keeps it shows. */
export type OverlayWindow = { readonly rows: number; readonly columns: number; readonly at: number }

/** An overlay drawn, its rows, the lines a page key moves, and the furthest line it scrolls to. */
export type DrawnOverlay = {
  readonly el: RenderElement
  readonly rows: number
  readonly page: number
  readonly last: number
}

/**
 * Lines in their window: whole when they fit, else the first `head` and last
 * `foot` lines kept, the lines from `at` between them that fit, and a row
 * saying where it stands. Every line is reachable, never clipped out of sight.
 */
const scrolled = (
  v: ViewPorts,
  lines: readonly Line[],
  keep: { readonly head: number; readonly foot: number },
  window: OverlayWindow,
): DrawnOverlay => {
  const { Box, Text } = v.el
  const rowsOf = (line: Line) => line.rows ?? wrappedRows([line.text], window.columns)
  const sum = (some: readonly Line[]) => some.reduce((total, line) => total + rowsOf(line), 0)
  const head = lines.slice(0, keep.head)
  const rest = lines.slice(keep.head, lines.length - keep.foot)
  const foot = lines.slice(lines.length - keep.foot)
  const total = sum(lines)
  if (total <= window.rows) {
    return {
      el: <Box flexDirection="column">{lines.map(line => line.el)}</Box>,
      rows: total,
      page: rest.length,
      last: 0,
    }
  }
  const kept = sum(head) + sum(foot) + 1
  const heights = rest.map(rowsOf)
  const shown = lineWindow(heights, Math.max(1, window.rows - kept), window.at)
  const where = `lines ${shown.start + 1}–${shown.end} of ${rest.length} · scroll or Page Up/Down`
  return {
    el: (
      <Box flexDirection="column">
        {head.map(line => line.el)}
        {rest.slice(shown.start, shown.end).map(line => line.el)}
        <Text dimColor wrap="truncate-end">
          {where}
        </Text>
        {foot.map(line => line.el)}
      </Box>
    ),
    rows: kept + heights.slice(shown.start, shown.end).reduce((total, rows) => total + rows, 0),
    page: Math.max(1, shown.end - shown.start),
    last: shown.last,
  }
}

/**
 * The review in its window, its heading and keys kept: what will run is
 * always reachable.
 */
export const Review = (
  v: ViewPorts,
  review: ReviewRequest,
  rows: readonly ModRow[],
  window: OverlayWindow,
  how: ReviewHow = { refused: false },
): DrawnOverlay =>
  scrolled(v, reviewLines(v, review, rows, how, window.columns), { head: 2, foot: 0 }, window)

/** The rows the marketplace form draws. */
export const marketplaceRows = 5

/** `m`: a source to add as a marketplace; Enter reviews it. */
export const MarketplaceForm = (v: ViewPorts): RenderElement => {
  const { Box, Text, Input } = v.el
  return (
    <Box flexDirection="column">
      {Heading(v, 'Add a marketplace')}
      <Text dimColor>A GitHub owner/repo, an https URL, or a folder's</Text>
      <Text dimColor>absolute path. Enter reviews it before anything runs.</Text>
      {Input === undefined ? (
        <Text dimColor>This surface can't take typing.</Text>
      ) : (
        <Input
          key={MARKETPLACE_KEY}
          placeholder="owner/repo"
          onSubmit={value => v.act.submitMarketplace(value)}
        />
      )}
    </Box>
  )
}

/** What the first session's dialog says first: what modmgr is, then each tab. */
const WELCOME_INTRO =
  'Mods are plugins that hook into Claude Code. modmgr shows what each one can do before it runs, and changes them safely, with undo.'
const WELCOME_TABS = [
  ['1', 'Installed', 'what you have: toggle, update and remove'],
  ['2', 'Discover', 'mods from your marketplaces and all of GitHub'],
  ['3', 'Dev', 'the mods you are writing: validate, test, share'],
  ['4', 'Health', 'what needs you, each with a fix'],
] as const

/** The welcome in its window: what modmgr is, each tab, and the key that starts, kept in view. */
export const Welcome = (v: ViewPorts, window: OverlayWindow): DrawnOverlay => {
  const { Box, Button, Text } = v.el
  const blank = (key: string): Line => ({ el: <Text key={key}> </Text>, text: '' })
  const lines: Line[] = [
    { el: Heading(v, 'modmgr: mods for Claude Code'), text: '', rows: 1 },
    blank('welcome:gap:intro'),
    { el: <Text key="welcome:intro">{WELCOME_INTRO}</Text>, text: WELCOME_INTRO },
    blank('welcome:gap:tabs'),
    ...WELCOME_TABS.map(([key, tab, what]) => ({
      el: (
        <Box key={`welcome:${tab}`} flexDirection="row" gap={1}>
          <Text color={TONE.accent}>{key}</Text>
          <Box width={10} flexShrink={0}>
            <Text bold>{tab}</Text>
          </Box>
          <Text dimColor wrap="truncate-end">
            {what}
          </Text>
        </Box>
      ),
      text: '',
      rows: 1,
    })),
    blank('welcome:gap:start'),
    {
      // Pushed at start-up, not by a press: the ring starts here by itself.
      el: (
        <Button key="act:start" plain autoFocus label="enter: start" onPress={() => v.act.back()} />
      ),
      text: '',
      rows: 1,
    },
  ]
  return scrolled(v, lines, { head: 1, foot: 1 }, window)
}

/** Cells one column of keys takes: the key, then what it does. */
const HELP_COLUMN = 36
const HELP_NOTE = 'Changes are staged with e and applied together with s; z undoes the last batch.'

type HelpRow = { readonly key: string; readonly label: string }

/** Help's two groups: the keys that move (tabs, rows, pages), then the actions. */
const helpGroups = (
  surfaces: readonly KeySurface[],
  hidden: ReadonlySet<string>,
): { readonly move: HelpRow[]; readonly act: HelpRow[] } => {
  const rows = helpFor(surfaces, hidden)
  return { move: rows.filter(row => row.moves), act: rows.filter(row => !row.moves) }
}

/** The groups sit side by side when two columns fit. */
const helpSideBySide = (columns: number): boolean => columns >= 2 * HELP_COLUMN + 2
/** The staging note concerns Installed alone. */
const helpNote = (surfaces: readonly KeySurface[]): string | undefined =>
  surfaces.includes('installed') ? HELP_NOTE : undefined

/** The keys in their window: what moves, then the actions, side by side where two columns fit. */
export const Help = (
  v: ViewPorts,
  surfaces: readonly KeySurface[],
  hidden: ReadonlySet<string>,
  window: OverlayWindow,
): DrawnOverlay => {
  const { Box, Text } = v.el
  const { move, act } = helpGroups(surfaces, hidden)
  const note = helpNote(surfaces)
  const cell = (row: HelpRow | undefined) => (
    <Box flexDirection="row" gap={1} width={HELP_COLUMN} flexShrink={0}>
      {row === undefined ? null : (
        <Box width={7} flexShrink={0}>
          <Text color={TONE.accent}>{row.key}</Text>
        </Box>
      )}
      {row === undefined ? null : <Text wrap="truncate-end">{row.label}</Text>}
    </Box>
  )
  const title = (text: string) => (
    <Box width={HELP_COLUMN} flexShrink={0}>
      <Text bold>{text}</Text>
    </Box>
  )
  const one = (el: RenderElement): Line => ({ el, text: '', rows: 1 })
  const pair = (left: RenderElement, right: RenderElement) =>
    one(
      <Box flexDirection="row" columnGap={2}>
        {left}
        {right}
      </Box>,
    )
  const blank = one(<Text> </Text>)
  const groups: Line[] = helpSideBySide(window.columns)
    ? [
        pair(title('Move'), title('Actions')),
        ...Array.from({ length: Math.max(move.length, act.length) }, (_, index) =>
          pair(cell(move[index]), cell(act[index])),
        ),
      ]
    : [
        one(title('Move')),
        ...move.map(row => one(cell(row))),
        blank,
        one(title('Actions')),
        ...act.map(row => one(cell(row))),
      ]
  const lines: Line[] = [
    one(Heading(v, 'Keys')),
    blank,
    ...groups,
    ...(note === undefined ? [] : [blank, { el: <Text dimColor>{note}</Text>, text: note }]),
  ]
  return scrolled(v, lines, { head: 1, foot: 0 }, window)
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

/** What each job does, as the log names it. */
const JOB_TITLE: Readonly<Record<Job['kind'], string>> = {
  install: 'Install',
  update: 'Update',
  remove: 'Remove',
  enable: 'Enable',
  disable: 'Disable',
  validate: 'Validate',
  test: 'Test',
  reload: 'Reload plugins',
  'marketplace-add': 'Add marketplace',
  'marketplace-update': 'Refresh marketplace',
}

/** How a job stands, in a word; one that changed nothing says so. */
const jobStateText = (job: Job): string =>
  job.state === 'ok'
    ? job.unchanged === true
      ? 'nothing to change'
      : 'done'
    : job.state === 'queued'
      ? 'waiting'
      : job.state

/**
 * The newest jobs first, each with its error, and the running or failed one's
 * output tail under it, in as many lines as `rows` allows.
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
        <Text>{JOB_TITLE[job.kind]}</Text>
        {job.target === undefined ? null : (
          <Text dimColor>{sanitize(job.target, { max: 60 })}</Text>
        )}
        <Text dimColor>{jobStateText(job)}</Text>
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
    // A job that found nothing to do says so in its tail.
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
            label: `cancel ${JOB_TITLE[cancellable.kind].toLowerCase()}`,
            onPress: () => v.act.cancelJob(cancellable.id),
          })}
    </Box>
  )
}
