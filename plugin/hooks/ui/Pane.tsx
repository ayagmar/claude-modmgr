// The `/mods` dialog (PLAN §5.2): the tabs, the tab's list (with the detail
// beside it from SPLIT_MIN_COLUMNS body columns), the overlay on top, and a
// footer of the keys that apply now. Sized to `scroll.bodyRows`: the list is
// windowed and a taller overlay is clipped (the detail draws compactly), so
// the header and footer never scroll away. Everything drawn comes from `$.state`.

import type { RenderElement, UiPressArgument } from 'claude-code'
import type { Overlay } from '../../types/index.d.ts'
import { devRowOf } from '../domain/dev.ts'
import { awaitingAcceptance, detectLine, foundRow, nextSort } from '../domain/discover.ts'
import { healthItemsOf, problemCount } from '../domain/health.ts'
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
import { DevDetail, DevList, devDetailRows, Share, shareRows } from './Dev.tsx'
import { FoundDetail, FoundList, foundDetailRows } from './Discover.tsx'
import { HealthItemDetail, HealthList, healthDetailRows } from './Health.tsx'
import { List } from './Installed.tsx'
import { GLYPH, KeyButton, TONE, type ViewPorts } from './kit.tsx'
import {
  Help,
  helpRows,
  Jobs,
  MarketplaceForm,
  marketplaceRows,
  Review,
  reviewRows,
} from './overlays.tsx'

export type PaneFrame = {
  readonly bodyColumns: number
  readonly bodyRows: number
  readonly isFocused: boolean
}

/** Keymap actions this version doesn't draw yet: help leaves them out. */
const NOT_YET: ReadonlySet<string> = new Set()

/** A footer key: what it does, where its hotkey is bound, what it says. */
type Key = {
  readonly action: string
  readonly on: KeySurface
  readonly label: string
  /** Gets the press: a copy targets the surface it came from. */
  readonly onPress: (press: UiPressArgument) => void
}

export const drawPane = async (v: ViewPorts, frame: PaneFrame): Promise<RenderElement> => {
  const [
    view,
    mods,
    detail,
    queue,
    review,
    sync,
    degraded,
    attention,
    page,
    detect,
    devState,
    facts,
  ] = await Promise.all([
    v.read('view'),
    v.read('mods'),
    v.read('detail'),
    v.read('queue'),
    v.read('review'),
    v.read('sync'),
    v.read('degraded'),
    v.read('attention'),
    v.read('catalogPage'),
    v.read('detect'),
    v.read('dev'),
    v.read('health'),
  ])
  const { Box, Button, Text, Input } = v.el
  const discover = view.tab === 'discover'
  const dev = view.tab === 'dev'
  const health = view.tab === 'health'
  const installed = !discover && !dev && !health
  const surface: KeySurface = discover ? 'discover' : dev ? 'dev' : health ? 'health' : 'installed'
  const layout = layoutFor(frame.bodyColumns)
  // A review overlay whose review was just taken (confirm) is already gone: the
  // tree drawn in between must be the final one, or the focus ring set on a row
  // in it is lost when the real list replaces it.
  const stack = review === null ? view.stack.filter(item => item !== 'review') : view.stack
  const top = stack.at(-1)
  const readOnly = degraded.process
  // A missing CLI concerns both tabs; network use only Discover.
  const warning = degraded.process
    ? degraded.reason
    : discover && degraded.network
      ? 'Network use is off: only local catalogues are checked for mods.'
      : undefined
  const status = batchLineOf(queue, attention.lastReload !== undefined)
  const terminal = v.surface === 'terminal'
  const listColumns = layout === 'split' ? Math.floor(frame.bodyColumns * 0.45) : frame.bodyColumns
  const showList = layout === 'split' || top === undefined

  // Installed: rows, the selection, what is staged.
  const rows = filterRows(mods, view.query)
  const selected = selectedRow(view, mods)
  const changing = stagedIds(view, mods)
  const staged = changing.size
  const showStaged = installed && staged > 0 && !readOnly && top !== 'review'
  // Discover: the window of rows `$.state` holds, and the selection in it.
  const found = foundRow(view, page)
  // Dev: its rows, and what validate, test and the session said of them.
  const devRow = devRowOf(view.dev, devState.rows)
  const devHow = { jobs: queue.jobs, failures: devState.failures }
  // Health: every item, from state alone, and the one selected.
  const items = healthItemsOf({
    mods,
    dev: devState,
    attention,
    degraded,
    sync,
    detect,
    queue,
    facts,
  })
  const item = items.find(each => each.key === view.health) ?? items[0]
  const problems = problemCount(items)

  const fieldShown = discover
    ? Input !== undefined && showList && (page.total > 0 || view.search !== '')
    : Input !== undefined && showList && installed && mods.length > 0
  const stopped = readOnly ? undefined : awaitingAcceptance(queue.jobs)

  // The footer's keys: only what applies to what is shown (a key drawn is a
  // key that works; help lists the rest).
  const footer: Key[] = []
  if (top === undefined && installed) {
    const updatable = readOnly ? 0 : mods.filter(row => whyNoUpdate(row) === undefined).length
    if (!readOnly && selected !== undefined) {
      footer.push({ action: 'toggle', on: surface, label: 'toggle', onPress: () => v.act.toggle() })
      if (whyNoUpdate(selected) === undefined) {
        footer.push({
          action: 'update',
          on: surface,
          label: 'update',
          onPress: () => v.act.update(),
        })
      }
      if (whyNoRemove(selected) === undefined) {
        footer.push({
          action: 'remove',
          on: surface,
          label: 'remove',
          onPress: () => v.act.remove(),
        })
      }
    }
    if (updatable > 1) {
      footer.push({
        action: 'update-all',
        on: surface,
        label: 'update all',
        onPress: () => v.act.updateAll(),
      })
    }
    if (!readOnly) {
      footer.push({ action: 'undo', on: surface, label: 'undo', onPress: () => v.act.undo() })
    }
  }
  if (top === undefined && discover) {
    if (!readOnly && found !== undefined) {
      footer.push({
        action: 'install',
        on: surface,
        label: 'install',
        onPress: () => v.act.install(),
      })
    }
    // Each says what pressing it does next.
    footer.push({
      action: 'kind',
      on: surface,
      label:
        view.kind === 'mods' ? 'with hooks' : view.kind === 'hooks' ? 'all plugins' : 'mods only',
      onPress: () => v.act.cycleKind(),
    })
    footer.push({
      action: 'sort',
      on: surface,
      label: `sort by ${nextSort(view.sort)}`,
      onPress: () => v.act.cycleSort(),
    })
    if (!readOnly) {
      footer.push({
        action: 'marketplace-add',
        on: surface,
        label: 'add marketplace',
        onPress: () => v.act.addMarketplace(),
      })
    }
  }
  if (top === undefined && health && !readOnly) {
    footer.push({ action: 'reload', on: surface, label: 'reload', onPress: () => v.act.reload() })
  }
  if (top === undefined && dev && !readOnly) {
    if (devRow !== undefined) {
      footer.push({
        action: 'validate',
        on: surface,
        label: 'validate',
        onPress: () => v.act.devRun('validate'),
      })
      footer.push({
        action: 'test',
        on: surface,
        label: 'test',
        onPress: () => v.act.devRun('test'),
      })
      footer.push({ action: 'share', on: surface, label: 'share', onPress: () => v.act.share() })
    }
    footer.push({ action: 'reload', on: surface, label: 'reload', onPress: () => v.act.reload() })
  }
  if (top === undefined && dev && devRow !== undefined) {
    const path = devRow.path
    footer.push({
      action: 'copy',
      on: surface,
      label: 'copy path',
      onPress: press => v.act.copy(path, press.surface),
    })
  }
  if (top === undefined) {
    // `v` is Dev's validate: a waiting command is reviewed from Installed or Discover.
    if (stopped !== undefined && !dev) {
      footer.push({
        action: 'accept',
        on: surface,
        label: 'review the command',
        onPress: () => v.act.acceptShown(),
      })
    }
    footer.push({
      action: 'refresh',
      on: surface,
      label: 'refresh',
      onPress: () => v.act.refresh(),
    })
    if (fieldShown) {
      footer.push({
        action: 'filter',
        on: surface,
        label: discover ? 'search' : 'filter',
        onPress: () => v.act.focusFilter(),
      })
    }
  }
  if (top !== 'review' && top !== 'marketplace') {
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
    (fieldShown ? 1 : 0) +
    1 +
    (showStaged ? 1 : 0) +
    (view.notice === undefined ? 0 : 1) +
    (status === undefined ? 0 : 1) +
    footerRows
  const listRows = Math.max(3, frame.bodyRows - chrome)

  // The list, windowed around the selection, and its pager.
  let list: RenderElement
  let pager: string | undefined
  if (health) {
    const window = windowAround(
      items.length,
      item === undefined ? 0 : items.indexOf(item),
      listRows,
    )
    pager = pagerLabel(window, items.length)
    list = HealthList(v, items, {
      columns: listColumns,
      window,
      focusKey: item?.key,
      stacked: layout !== 'split',
    })
  } else if (dev) {
    const at = devRow === undefined ? 0 : devState.rows.indexOf(devRow)
    const window = windowAround(devState.rows.length, at, listRows)
    pager = pagerLabel(window, devState.rows.length)
    list = DevList(v, devState.rows, {
      ...devHow,
      columns: listColumns,
      window,
      focusKey: devRow?.key,
      loading: devState.loading && devState.at === undefined,
    })
  } else if (discover) {
    const at = found === undefined ? 0 : page.rows.indexOf(found)
    const window = windowAround(page.rows.length, at, listRows)
    list = FoundList(v, page, {
      view,
      columns: listColumns,
      window,
      focusId: found?.id,
      networkOff: degraded.network,
    })
    pager =
      page.matched > window.end - window.start
        ? pagerLabel(
            { start: page.offset + window.start, end: page.offset + window.end },
            page.matched,
          )
        : undefined
  } else {
    const window = windowAround(
      rows.length,
      selected === undefined ? 0 : rows.indexOf(selected),
      listRows,
    )
    pager = pagerLabel(window, rows.length)
    list = List(v, rows, {
      view,
      staged: changing,
      columns: listColumns,
      window,
      focusId: selected?.id,
      loading: sync.at === undefined && sync.error === undefined,
      total: mods.length,
    })
  }

  const under = stack.at(-2)
  const surfaceOf = (overlay: Overlay | undefined): KeySurface =>
    overlay === undefined
      ? surface
      : overlay === 'detail'
        ? discover
          ? 'discover-detail'
          : dev
            ? 'dev-detail'
            : health
              ? 'health'
              : 'detail'
        : overlay === 'share'
          ? 'share'
          : overlay === 'review'
            ? 'review'
            : overlay === 'jobs'
              ? 'jobs'
              : surface
  const helpSurfaces: KeySurface[] = ['pane', surfaceOf(under)]
  const refused = degraded.acceptCommand
  const overlay = (which: Overlay | undefined): RenderElement | null => {
    if (which === 'review' && review !== null) return Review(v, review, mods, { refused })
    if (which === 'help') return Help(v, helpSurfaces, NOT_YET)
    if (which === 'jobs') return Jobs(v, queue.jobs, listRows)
    if (which === 'marketplace') return MarketplaceForm(v)
    if (which === 'share') return Share(v, devState.share)
    return null
  }

  const detailHow = (actions: boolean) => ({
    row: selected,
    detail,
    staged: changing,
    view,
    actions,
    readOnly,
    rows: listRows,
  })
  const detailOf = (actions: boolean) =>
    discover
      ? FoundDetail(v, found, { actions, readOnly })
      : dev
        ? DevDetail(v, devRow, { ...devHow, actions, readOnly })
        : health
          ? HealthItemDetail(v, item, { actions })
          : Detail(v, detailHow(actions))
  /** Rows the overlay on top draws, to clip it to the body (Jobs sizes itself). */
  const overlayRows = (which: Overlay | undefined): number =>
    which === 'review' && review !== null
      ? reviewRows(v, review, mods, frame.bodyColumns, { refused })
      : which === 'help'
        ? helpRows(helpSurfaces, NOT_YET)
        : which === 'marketplace'
          ? marketplaceRows
          : which === 'share'
            ? shareRows(devState.share, frame.bodyColumns)
            : which === 'detail'
              ? discover
                ? foundDetailRows(found, true)
                : dev
                  ? devDetailRows(devRow, devHow, true, frame.bodyColumns)
                  : health
                    ? healthDetailRows(item, frame.bodyColumns)
                    : detailRows(detailHow(true))
              : 0
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
      clipped(detailOf(true), overlayRows(top))
    ) : (
      clipped(overlay(top) ?? list, overlayRows(top))
    )

  const keys = footer.map(key =>
    KeyButton(v, { action: key.action, on: key.on, label: key.label, onPress: key.onPress }),
  )
  const on = mods.filter(row => row.enabled).length
  // Tabs keep their width (F48: children shrink by default); the counts give way.
  const tabKey = (tab: 'installed' | 'discover' | 'dev' | 'health', label: string) => (
    <Box flexDirection="row" flexShrink={0}>
      {KeyButton(v, {
        action: `tab.${tab}`,
        on: 'pane',
        label,
        ...(view.tab === tab ? {} : { dim: true }),
        onPress: () => v.act.tab(tab),
      })}
    </Box>
  )
  const failing = devState.rows.filter(row => devState.failures[row.name] !== undefined).length
  const meta = health
    ? problems === 0
      ? 'nothing needs you'
      : `${problems} ${problems === 1 ? 'problem' : 'problems'}`
    : dev
      ? [
          `${devState.rows.length} ${devState.rows.length === 1 ? 'mod' : 'mods'} under development`,
          failing === 0 ? '' : `${failing} failing`,
        ]
          .filter(part => part !== '')
          .join(' · ')
      : discover
        ? [
            page.total === 0 ? '' : `${page.matched.toLocaleString('en-US')} shown`,
            detectLine(detect) ?? '',
          ]
            .filter(part => part !== '')
            .join(' · ')
        : `${mods.length} ${mods.length === 1 ? 'mod' : 'mods'} · ${on} on`
  const stale = discover ? page.loading : dev ? devState.loading : sync.refreshing

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row" columnGap={2} flexShrink={1}>
          {tabKey('installed', 'Installed')}
          {tabKey('discover', 'Discover')}
          {tabKey('dev', 'Dev')}
          {tabKey('health', problems === 0 ? 'Health' : `Health ${GLYPH.problem}${problems}`)}
          <Box flexShrink={1} height={1} overflow="hidden">
            <Text dimColor wrap="truncate-end">
              {meta}
            </Text>
          </Box>
        </Box>
        {stale ? (
          <Text dimColor>{GLYPH.stale}</Text>
        ) : installed && sync.error !== undefined ? (
          <Text color={TONE.warn}>{GLYPH.problem} couldn't refresh (r)</Text>
        ) : null}
      </Box>
      {warning === undefined ? null : (
        <Text color={TONE.warn} wrap="truncate-end">
          {sanitize(warning, { max: 300 })}
        </Text>
      )}
      {fieldShown && Input !== undefined ? (
        <Input
          key={FILTER_KEY}
          placeholder={discover ? 'search the catalogue' : 'filter by name'}
          value={discover ? view.search : view.query}
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
            on: surface,
            label: 'first',
            dim: true,
            onPress: () => v.act.edge('first'),
          })}
          {KeyButton(v, {
            action: 'page.last',
            on: surface,
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
