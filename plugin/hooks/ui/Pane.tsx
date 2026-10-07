// The `/mods` dialog (PLAN §5.2): a header, the Installed list (with the
// detail beside it from SPLIT_MIN_COLUMNS body columns), the overlay on top,
// and a footer of the keys that apply now. Sized to `scroll.bodyRows`: the list
// is windowed and a taller overlay is clipped (the detail draws compactly), so
// the header and footer never scroll away. Everything drawn comes from `$.state`.

import type { RenderElement } from 'claude-code'
import type { Overlay } from '../../types/index.d.ts'
import type { KeySurface } from '../domain/keymap.ts'
import { sanitize } from '../domain/sanitize.ts'
import {
  batchLineOf,
  FILTER_KEY,
  filterRows,
  footerRowsFor,
  layoutFor,
  pagerLabel,
  selectedRow,
  stagedIds,
  whyNoRemove,
  whyNoUpdate,
  windowAround,
} from '../domain/view.ts'
import { Detail, detailRows } from './Detail.tsx'
import { List } from './Installed.tsx'
import { GLYPH, KeyButton, TONE, type ViewPorts } from './kit.tsx'
import { Help, helpRows, Jobs, Review, reviewRows } from './overlays.tsx'

export type PaneFrame = {
  readonly bodyColumns: number
  readonly bodyRows: number
  readonly isFocused: boolean
}

/** Keymap actions this version doesn't draw yet: help leaves them out. */
const NOT_YET: ReadonlySet<string> = new Set([
  'tab.installed',
  'tab.discover',
  'tab.dev',
  'tab.health',
  'sort',
])

const OVERLAY_SURFACE: Readonly<Record<Overlay, KeySurface>> = {
  detail: 'detail',
  review: 'review',
  help: 'installed',
  jobs: 'jobs',
}

export const drawPane = async (v: ViewPorts, frame: PaneFrame): Promise<RenderElement> => {
  const [view, mods, detail, queue, review, sync, degraded, attention] = await Promise.all([
    v.read('view'),
    v.read('mods'),
    v.read('detail'),
    v.read('queue'),
    v.read('review'),
    v.read('sync'),
    v.read('degraded'),
    v.read('attention'),
  ])
  const { Box, Button, Text, Input } = v.el
  const layout = layoutFor(frame.bodyColumns)
  // A review overlay whose review was just taken (confirm) is already gone: the
  // tree drawn in between must be the final one, or the focus ring set on a row
  // in it is lost when the real list replaces it.
  const stack = review === null ? view.stack.filter(item => item !== 'review') : view.stack
  const top = stack.at(-1)
  const readOnly = degraded.process
  // Only a missing CLI concerns Installed; network use matters to Discover and updates.
  const warning = degraded.process ? degraded.reason : undefined
  const rows = filterRows(mods, view.query)
  const selected = selectedRow(view, mods)
  const changing = stagedIds(view, mods)
  const staged = changing.size
  const showStaged = staged > 0 && !readOnly && top !== 'review'
  const status = batchLineOf(queue, attention.lastReload !== undefined)
  const terminal = v.surface === 'terminal'
  const on = mods.filter(row => row.enabled).length
  const listColumns = layout === 'split' ? Math.floor(frame.bodyColumns * 0.45) : frame.bodyColumns
  const showList = layout === 'split' || top === undefined
  const showFilter = Input !== undefined && showList && mods.length > 0

  // The footer's keys: only what applies to what is shown (a key drawn is a
  // key that works; help lists the rest).
  type Key = {
    readonly action: string
    readonly on: KeySurface
    readonly label: string
    readonly onPress: () => void
  }
  const footer: Key[] = []
  if (top === undefined) {
    const updatable = readOnly ? 0 : mods.filter(row => whyNoUpdate(row) === undefined).length
    if (!readOnly && selected !== undefined) {
      footer.push({
        action: 'toggle',
        on: 'installed',
        label: 'toggle',
        onPress: () => v.act.toggle(),
      })
      if (whyNoUpdate(selected) === undefined) {
        footer.push({
          action: 'update',
          on: 'installed',
          label: 'update',
          onPress: () => v.act.update(),
        })
      }
      if (whyNoRemove(selected) === undefined) {
        footer.push({
          action: 'remove',
          on: 'installed',
          label: 'remove',
          onPress: () => v.act.remove(),
        })
      }
    }
    if (updatable > 1) {
      footer.push({
        action: 'update-all',
        on: 'installed',
        label: 'update all',
        onPress: () => v.act.updateAll(),
      })
    }
    if (!readOnly) {
      footer.push({ action: 'undo', on: 'installed', label: 'undo', onPress: () => v.act.undo() })
    }
    footer.push({
      action: 'refresh',
      on: 'installed',
      label: 'refresh',
      onPress: () => v.act.refresh(),
    })
    if (showFilter) {
      footer.push({
        action: 'filter',
        on: 'installed',
        label: 'filter',
        onPress: () => v.act.focusFilter(),
      })
    }
  }
  if (top !== 'review') {
    footer.push({ action: 'jobs', on: 'pane', label: 'jobs', onPress: () => v.act.overlay('jobs') })
    footer.push({ action: 'help', on: 'pane', label: 'help', onPress: () => v.act.overlay('help') })
  }
  const closeLabel =
    top === undefined ? (terminal ? 'esc close' : 'close') : terminal ? 'esc back' : 'back'
  const hint = frame.isFocused || !terminal ? undefined : 'ctrl+x tab to use the keys'

  // Rows the list may take: the body less every other line drawn.
  const footerRows = footerRowsFor(
    [
      // A hotkey is painted before its label (`e: toggle`).
      ...footer.map(key => key.label.length + 3),
      closeLabel.length,
      ...(hint === undefined ? [] : [hint.length]),
    ],
    frame.bodyColumns,
  )
  const chrome =
    1 +
    (warning === undefined ? 0 : 1) +
    (showFilter ? 1 : 0) +
    1 +
    (showStaged ? 1 : 0) +
    (view.notice === undefined ? 0 : 1) +
    (status === undefined ? 0 : 1) +
    footerRows
  const listRows = Math.max(3, frame.bodyRows - chrome)
  const window = windowAround(
    rows.length,
    selected === undefined ? 0 : rows.indexOf(selected),
    listRows,
  )
  const pager = pagerLabel(window, rows.length)

  const list = List(v, rows, {
    view,
    staged: changing,
    columns: listColumns,
    window,
    focusId: selected?.id,
    loading: sync.at === undefined && sync.error === undefined,
    total: mods.length,
  })

  const under = stack.at(-2)
  const helpSurfaces: KeySurface[] = [
    'pane',
    under === undefined ? 'installed' : OVERLAY_SURFACE[under],
  ]
  const overlay = (which: Overlay | undefined): RenderElement | null => {
    if (which === 'review' && review !== null) return Review(v, review, mods)
    if (which === 'help') return Help(v, helpSurfaces, NOT_YET)
    if (which === 'jobs') return Jobs(v, queue.jobs, listRows)
    return null
  }
  /** Rows the overlay on top draws, to clip it to the body (Jobs sizes itself). */
  const overlayRows = (
    which: Overlay | undefined,
    how: Parameters<typeof detailRows>[0],
  ): number =>
    which === 'review' && review !== null
      ? reviewRows(v, review, mods, frame.bodyColumns)
      : which === 'help'
        ? helpRows(helpSurfaces, NOT_YET)
        : which === 'detail'
          ? detailRows(how)
          : 0

  const detailHow = (actions: boolean) => ({
    row: selected,
    detail,
    staged: changing,
    view,
    actions,
    readOnly,
    rows: listRows,
  })
  const detailOf = (actions: boolean) => Detail(v, detailHow(actions))
  /** A tall overlay, held to the body's rows so the footer stays in view. */
  const clipped = (element: RenderElement, height: number): RenderElement =>
    height <= listRows ? (
      element
    ) : (
      <Box flexDirection="column" height={listRows} overflow="hidden">
        <Box flexDirection="column" flexShrink={0}>
          {element}
        </Box>
      </Box>
    )

  const body =
    layout === 'split' ? (
      // Clipped to the list's rows, so the header and footer stay in view; the
      // whole detail is one Enter away.
      <Box flexDirection="row" gap={2} height={listRows} overflow="hidden">
        <Box flexDirection="column" width={listColumns} flexShrink={0} overflow="hidden">
          <Box flexDirection="column" flexShrink={0}>
            {list}
          </Box>
        </Box>
        <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
          <Box flexDirection="column" flexShrink={0}>
            {overlay(top) ?? detailOf(top === 'detail')}
          </Box>
        </Box>
      </Box>
    ) : top === undefined ? (
      list
    ) : top === 'detail' ? (
      clipped(detailOf(true), overlayRows(top, detailHow(true)))
    ) : (
      clipped(overlay(top) ?? list, overlayRows(top, detailHow(true)))
    )

  const keys = footer.map(key =>
    KeyButton(v, { action: key.action, on: key.on, label: key.label, onPress: key.onPress }),
  )

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row" gap={1}>
          <Text bold color={TONE.accent}>
            Installed
          </Text>
          <Text dimColor>
            {mods.length} {mods.length === 1 ? 'mod' : 'mods'} · {on} on
          </Text>
        </Box>
        {sync.refreshing ? (
          <Text dimColor>{GLYPH.stale}</Text>
        ) : sync.error !== undefined ? (
          <Text color={TONE.warn}>{GLYPH.problem} couldn't refresh (r)</Text>
        ) : null}
      </Box>
      {warning === undefined ? null : (
        <Text color={TONE.warn} wrap="truncate-end">
          {sanitize(warning, { max: 300 })}
        </Text>
      )}
      {showFilter && Input !== undefined ? (
        <Input
          key={FILTER_KEY}
          placeholder="filter by name"
          value={view.query}
          onInput={value => v.act.filter(value)}
          onSubmit={value => v.act.filter(value)}
        />
      ) : null}
      {body}
      {showList && pager !== undefined ? (
        <Box flexDirection="row" gap={2}>
          <Text dimColor>{pager}</Text>
          {KeyButton(v, {
            action: 'page.first',
            on: 'installed',
            label: 'first',
            dim: true,
            onPress: () => v.act.edge('first'),
          })}
          {KeyButton(v, {
            action: 'page.last',
            on: 'installed',
            label: 'last',
            dim: true,
            onPress: () => v.act.edge('last'),
          })}
        </Box>
      ) : null}
      {showStaged ? (
        <Box flexDirection="row" gap={2}>
          <Text color={TONE.warn}>
            {staged} staged {staged === 1 ? 'change' : 'changes'}
          </Text>
          {KeyButton(v, {
            action: 'apply',
            on: 'installed',
            label: 'apply',
            onPress: () => v.act.apply(),
          })}
        </Box>
      ) : null}
      {view.notice === undefined ? null : (
        <Text dimColor wrap="truncate-end">
          {sanitize(view.notice, { max: 300 })}
        </Text>
      )}
      {status === undefined ? null : (
        <Text
          color={status.tone === 'error' ? TONE.bad : status.tone === 'ok' ? TONE.ok : TONE.accent}
          wrap="truncate-end"
        >
          {status.tone === 'error' ? GLYPH.failed : status.tone === 'ok' ? GLYPH.ok : GLYPH.stale}{' '}
          {status.text}
        </Text>
      )}
      <Box flexDirection="row" columnGap={2} flexWrap="wrap">
        {keys}
        {top === undefined ? (
          <Button key="act:close" plain dimColor label={closeLabel} onPress={() => v.act.close()} />
        ) : (
          <Button key="act:back" plain dimColor label={closeLabel} onPress={() => v.act.back()} />
        )}
        {hint === undefined ? null : <Text dimColor>{hint}</Text>}
      </Box>
    </Box>
  )
}
