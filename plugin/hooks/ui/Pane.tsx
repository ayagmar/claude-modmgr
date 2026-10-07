// The `/mods` dialog (PLAN §5.2): a header, the Installed list (with the
// detail beside it from SPLIT_MIN_COLUMNS body columns), the overlay on top,
// and a footer of the keys that apply now. Sized to `scroll.bodyRows` so the
// header and footer never scroll away; everything drawn comes from `$.state`.

import type { RenderElement } from 'claude-code'
import type { Overlay } from '../../types/index.d.ts'
import type { KeySurface } from '../domain/keymap.ts'
import { sanitize } from '../domain/sanitize.ts'
import {
  FILTER_KEY,
  filterRows,
  layoutFor,
  pagerLabel,
  selectedIndex,
  stagedChanges,
  statusOf,
  topOverlay,
  windowAround,
} from '../domain/view.ts'
import { Detail } from './Detail.tsx'
import { List } from './Installed.tsx'
import { GLYPH, KeyButton, TONE, type ViewPorts } from './kit.tsx'
import { Help, Jobs, Review } from './overlays.tsx'

export type PaneFrame = {
  readonly bodyColumns: number
  readonly bodyRows: number
  readonly isFocused: boolean
  /** The clock, for how long a finished batch's line stays. */
  readonly now: number
}

/** Keymap actions this version doesn't draw yet: help leaves them out. */
const NOT_YET: ReadonlySet<string> = new Set([
  'tab.installed',
  'tab.discover',
  'tab.dev',
  'tab.health',
  'sort',
  'update',
  'update-all',
  'remove',
])

const OVERLAY_SURFACE: Readonly<Record<Overlay, KeySurface>> = {
  detail: 'detail',
  review: 'review',
  help: 'installed',
  jobs: 'jobs',
}

export const drawPane = async (v: ViewPorts, frame: PaneFrame): Promise<RenderElement> => {
  const [view, mods, detail, queue, review, sync, degraded] = await Promise.all([
    v.read('view'),
    v.read('mods'),
    v.read('detail'),
    v.read('queue'),
    v.read('review'),
    v.read('sync'),
    v.read('degraded'),
  ])
  const { Box, Button, Text, Input } = v.el
  const layout = layoutFor(frame.bodyColumns)
  const top = topOverlay(view)
  const readOnly = degraded.process
  // Only a missing CLI concerns Installed; network use matters to Discover and updates.
  const warning = degraded.process ? degraded.reason : undefined
  const rows = filterRows(mods, view.query)
  const selected = rows[selectedIndex(rows, view.selected)]
  const staged = stagedChanges(view, mods).length
  const status = statusOf(queue, frame.now)
  const on = mods.filter(row => row.enabled).length
  const listColumns = layout === 'split' ? Math.floor(frame.bodyColumns * 0.45) : frame.bodyColumns
  const showList = layout === 'split' || top === undefined
  const showFilter = Input !== undefined && showList && mods.length > 0

  // Rows the list may take: the body less every other line drawn.
  const footerRows = frame.bodyColumns < 80 ? 2 : 1
  const chrome =
    1 +
    (warning === undefined ? 0 : 1) +
    (showFilter ? 1 : 0) +
    1 +
    (staged > 0 ? 1 : 0) +
    (view.notice === undefined ? 0 : 1) +
    (status === undefined ? 0 : 1) +
    footerRows
  const listRows = Math.max(3, frame.bodyRows - chrome)
  const window = windowAround(rows.length, selectedIndex(rows, view.selected), listRows)
  const pager = pagerLabel(window, rows.length)

  const list = List(v, rows, {
    view,
    columns: listColumns,
    window,
    focusId: selected?.id,
    loading: sync.at === undefined && sync.error === undefined,
    total: mods.length,
  })

  const overlay = (which: Overlay | undefined): RenderElement | null => {
    if (which === 'review' && review !== null) return Review(v, review, mods)
    if (which === 'help') {
      const under = view.stack.at(-2)
      return Help(v, ['pane', under === undefined ? 'installed' : OVERLAY_SURFACE[under]], NOT_YET)
    }
    if (which === 'jobs') return Jobs(v, queue.jobs)
    return null
  }

  const detailOf = (actions: boolean) =>
    Detail(v, { row: selected, detail, view, actions, readOnly })

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
      detailOf(true)
    ) : (
      (overlay(top) ?? list)
    )

  const keys: RenderElement[] = []
  if (top === undefined) {
    if (!readOnly && selected !== undefined) {
      keys.push(
        KeyButton(v, {
          action: 'toggle',
          on: 'installed',
          label: 'toggle',
          onPress: () => v.act.toggle(),
        }),
      )
    }
    if (!readOnly) {
      keys.push(
        KeyButton(v, {
          action: 'undo',
          on: 'installed',
          label: 'undo',
          onPress: () => v.act.undo(),
        }),
      )
    }
    keys.push(
      KeyButton(v, {
        action: 'refresh',
        on: 'installed',
        label: 'refresh',
        onPress: () => v.act.refresh(),
      }),
    )
    if (showFilter) {
      keys.push(
        KeyButton(v, {
          action: 'filter',
          on: 'installed',
          label: 'filter',
          onPress: () => v.act.focusFilter(),
        }),
      )
    }
  }
  if (top !== 'review') {
    keys.push(
      KeyButton(v, {
        action: 'jobs',
        on: 'pane',
        label: 'jobs',
        onPress: () => v.act.overlay('jobs'),
      }),
    )
    keys.push(
      KeyButton(v, {
        action: 'help',
        on: 'pane',
        label: 'help',
        onPress: () => v.act.overlay('help'),
      }),
    )
  }

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
      {staged > 0 && !readOnly && top !== 'review' ? (
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
          <Button key="act:close" plain dimColor label="esc close" onPress={() => v.act.close()} />
        ) : (
          <Button key="act:back" plain dimColor label="esc back" onPress={() => v.act.back()} />
        )}
        {frame.isFocused ? null : <Text dimColor>ctrl+x tab to use the keys</Text>}
      </Box>
    </Box>
  )
}
