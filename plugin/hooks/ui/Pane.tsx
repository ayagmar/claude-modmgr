// The `/mods` dialog: the tabs and a line about the tab, the search field, the
// tab's list (with the detail beside it from SPLIT_MIN_COLUMNS body columns),
// the overlay on top, and a footer with the main keys of the moment. It fills
// `scroll.bodyRows`: the list is windowed and a taller overlay is clipped (the
// detail draws compactly), so the header and footer never scroll away.
// Everything drawn comes from `$.state`.

import type { RenderElement, UiPressArgument } from 'claude-code'
import type { Overlay, View } from '../../types/index.d.ts'
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
  listColumnsFor,
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
import { GLYPH, KeyButton, Rule, TONE, type ViewPorts } from './kit.tsx'
import {
  Help,
  helpRows,
  Jobs,
  MarketplaceForm,
  marketplaceRows,
  Review,
  reviewRows,
  Welcome,
  welcomeRows,
} from './overlays.tsx'

export type PaneFrame = {
  readonly bodyColumns: number
  readonly bodyRows: number
  readonly isFocused: boolean
}

/** Keymap actions this version doesn't draw yet: help leaves them out. */
const NOT_YET: ReadonlySet<string> = new Set()

/** From this many body rows the search field is drawn in a box. */
const BOXED_FIELD_MIN_ROWS = 18

/** A key of the moment: what it does, where its hotkey is bound, what it says. */
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
  const listColumns = layout === 'split' ? listColumnsFor(frame.bodyColumns) : frame.bodyColumns
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
  const split = layout === 'split'
  // Beside the list the detail draws its own keys (toggle, install, validate…);
  // stacked, the footer carries them until Enter opens the detail.
  const itemKeys = !split && top === undefined

  // The footer's keys: the actions of the moment. Every key is drawn where it
  // belongs (tabs, refresh, search, pager, footer): a hotkey needs a Button,
  // and every Button is a stop of the Tab ring, so none is hidden.
  const keys: Key[] = []
  const add = (key: Omit<Key, 'on'> & { readonly on?: KeySurface }) =>
    keys.push({ on: surface, ...key })
  if (top === undefined && installed && !readOnly) {
    const updatable = mods.filter(row => whyNoUpdate(row) === undefined).length
    if (itemKeys && selected !== undefined) {
      add({ action: 'toggle', label: 'toggle', onPress: () => v.act.toggle() })
      if (whyNoUpdate(selected) === undefined)
        add({ action: 'update', label: 'update', onPress: () => v.act.update() })
      if (whyNoRemove(selected) === undefined)
        add({ action: 'remove', label: 'remove', onPress: () => v.act.remove() })
    }
    if (updatable > 1)
      add({ action: 'update-all', label: 'update all', onPress: () => v.act.updateAll() })
    add({ action: 'undo', label: 'undo', onPress: () => v.act.undo() })
  }
  if (top === undefined && discover) {
    if (itemKeys && !readOnly && found !== undefined)
      add({ action: 'install', label: 'install', onPress: () => v.act.install() })
    // Each says what pressing it does next.
    add({
      action: 'kind',
      label:
        view.kind === 'mods' ? 'with hooks' : view.kind === 'hooks' ? 'all plugins' : 'mods only',
      onPress: () => v.act.cycleKind(),
    })
    add({
      action: 'sort',
      label: `sort by ${nextSort(view.sort)}`,
      onPress: () => v.act.cycleSort(),
    })
    if (!readOnly)
      add({
        action: 'marketplace-add',
        label: 'marketplace',
        onPress: () => v.act.addMarketplace(),
      })
  }
  if (top === undefined && dev) {
    if (itemKeys && devRow !== undefined) {
      const path = devRow.path
      if (!readOnly) {
        add({ action: 'validate', label: 'validate', onPress: () => v.act.devRun('validate') })
        add({ action: 'test', label: 'test', onPress: () => v.act.devRun('test') })
        add({ action: 'share', label: 'share', onPress: () => v.act.share() })
      }
      add({
        action: 'copy',
        label: 'copy path',
        onPress: press => v.act.copy(path, press.surface),
      })
    }
    if (!readOnly) add({ action: 'reload', label: 'reload', onPress: () => v.act.reload() })
  }
  if (top === undefined && health && !readOnly) {
    add({ action: 'reload', label: 'reload', onPress: () => v.act.reload() })
  }
  // `v` is Dev's validate: a waiting command is reviewed from Installed or Discover.
  if (top === undefined && stopped !== undefined && !dev) {
    add({ action: 'accept', label: 'review the command', onPress: () => v.act.acceptShown() })
  }
  // Jobs and keys go over any view; a review or the marketplace form holds the keys.
  const general: Key[] =
    top === 'review' || top === 'marketplace'
      ? []
      : [
          { action: 'jobs', on: 'pane', label: 'jobs', onPress: () => v.act.overlay('jobs') },
          { action: 'help', on: 'pane', label: 'keys', onPress: () => v.act.overlay('help') },
        ]
  const closeLabel =
    top === undefined ? (terminal ? 'esc close' : 'close') : terminal ? 'esc back' : 'back'
  const hint = frame.isFocused || !terminal ? undefined : 'ctrl+x tab to use the keys'

  // Rows the list may take: the body less every other line drawn. The footer's
  // keys wrap in what the jobs, keys and close group leaves them (a hotkey is
  // painted before its label: `e: toggle`).
  const rightColumns =
    general.reduce((sum, key) => sum + key.label.length + 3 + 2, 0) + closeLabel.length
  const footerRows = footerRowsFor(
    [...keys.map(key => key.label.length + 3), ...(hint === undefined ? [] : [hint.length])],
    Math.max(1, frame.bodyColumns - rightColumns - 2),
  )
  const boxedField = fieldShown && frame.bodyRows >= BOXED_FIELD_MIN_ROWS
  const chrome =
    2 +
    (warning === undefined ? 0 : 1) +
    (fieldShown ? (boxedField ? 3 : 1) : 0) +
    (showStaged ? 1 : 0) +
    (view.notice === undefined ? 0 : 1) +
    (status === undefined ? 0 : 1) +
    1 +
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
      stacked: !split,
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
    // Stacked, each entry takes two rows: its name, then what it says it does.
    const twoLine = !split
    const at = found === undefined ? 0 : page.rows.indexOf(found)
    const window = windowAround(page.rows.length, at, twoLine ? Math.floor(listRows / 2) : listRows)
    list = FoundList(v, page, {
      view,
      columns: listColumns,
      window,
      focusId: found?.id,
      networkOff: degraded.network,
      twoLine,
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
  const detailSurface: KeySurface = discover
    ? 'discover-detail'
    : dev
      ? 'dev-detail'
      : health
        ? 'health'
        : 'detail'
  const surfaceOf = (overlay: Overlay | undefined): KeySurface =>
    overlay === undefined
      ? surface
      : overlay === 'detail'
        ? detailSurface
        : overlay === 'share'
          ? 'share'
          : overlay === 'review'
            ? 'review'
            : overlay === 'jobs'
              ? 'jobs'
              : surface
  // Beside the list the detail's keys are mounted too.
  const helpSurfaces: KeySurface[] = [
    'pane',
    surfaceOf(under),
    ...(split && under === undefined ? [detailSurface] : []),
  ]
  const refused = degraded.acceptCommand
  const overlay = (which: Overlay | undefined): RenderElement | null => {
    if (which === 'review' && review !== null) return Review(v, review, mods, { refused })
    if (which === 'help') return Help(v, helpSurfaces, NOT_YET, frame.bodyColumns)
    if (which === 'jobs') return Jobs(v, queue.jobs, listRows)
    if (which === 'marketplace') return MarketplaceForm(v)
    if (which === 'share') return Share(v, devState.share)
    if (which === 'welcome') return Welcome(v)
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
        ? helpRows(helpSurfaces, NOT_YET, frame.bodyColumns)
        : which === 'marketplace'
          ? marketplaceRows
          : which === 'share'
            ? shareRows(devState.share, frame.bodyColumns)
            : which === 'welcome'
              ? welcomeRows
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

  // Help and the job log are about the whole dialog: they take the whole body.
  const wide = top === 'help' || top === 'jobs'
  const body =
    split && !wide ? (
      // Clipped to the list's rows, so the header and footer stay in view; the
      // whole detail is one Enter away. The detail beside the list carries its keys.
      <Box flexDirection="row" columnGap={1} height={listRows} overflow="hidden">
        <Box flexDirection="column" width={listColumns} flexShrink={0} overflow="hidden">
          <Box flexDirection="column" flexShrink={0}>
            {list}
          </Box>
        </Box>
        <Box flexDirection="column" width={1} flexShrink={0}>
          {Array.from({ length: listRows }, (_, index) => (
            <Text key={`divider:${index}`} dimColor>
              │
            </Text>
          ))}
        </Box>
        <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
          <Box flexDirection="column" flexShrink={0}>
            {overlay(top) ?? detailOf(true)}
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

  const button = (key: Key) =>
    KeyButton(v, { action: key.action, on: key.on, label: key.label, onPress: key.onPress })
  const on = mods.filter(row => row.enabled).length
  const tabs: readonly { readonly tab: View['tab']; readonly label: string }[] = [
    { tab: 'installed', label: 'Installed' },
    { tab: 'discover', label: 'Discover' },
    { tab: 'dev', label: 'Dev' },
    { tab: 'health', label: problems === 0 ? 'Health' : `Health ${GLYPH.problem}${problems}` },
  ]
  // The tab shown is a title; the others are its number keys.
  const tabRow = tabs.map(({ tab, label }) =>
    view.tab === tab ? (
      <Box key={`tab:${tab}`} flexShrink={0}>
        <Text bold underline color={TONE.accent}>
          {label}
        </Text>
      </Box>
    ) : (
      <Box key={`tab:${tab}`} flexShrink={0}>
        {KeyButton(v, {
          action: `tab.${tab}`,
          on: 'pane',
          label,
          dim: true,
          onPress: () => v.act.tab(tab),
        })}
      </Box>
    ),
  )
  const failing = devState.rows.filter(row => devState.failures[row.name] !== undefined).length
  const updates = mods.filter(row => row.updateTo !== undefined).length
  const count = (n: number, one: string, many: string) =>
    `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
  const meta = health
    ? problems === 0
      ? 'Nothing needs you.'
      : `${count(problems, 'problem', 'problems')} to look at`
    : dev
      ? [
          count(devState.rows.length, 'mod', 'mods') + ' under development',
          failing === 0 ? '' : `${failing} failing`,
        ]
          .filter(part => part !== '')
          .join(' · ')
      : discover
        ? [
            page.total === 0
              ? ''
              : page.matched < page.total
                ? `${page.matched.toLocaleString('en-US')} of ${count(page.total, 'plugin', 'plugins')}`
                : count(page.total, 'plugin', 'plugins'),
            detectLine(detect) ?? '',
          ]
            .filter(part => part !== '')
            .join(' · ')
        : [
            `${on} of ${count(mods.length, 'mod', 'mods')} on`,
            updates === 0 ? '' : count(updates, 'update', 'updates'),
          ]
            .filter(part => part !== '')
            .join(' · ')
  const stale = discover ? page.loading : dev ? devState.loading : sync.refreshing
  const field =
    fieldShown && Input !== undefined ? (
      <Box flexDirection="row" flexGrow={1}>
        <Text dimColor>⌕ </Text>
        <Box flexGrow={1}>
          <Input
            key={FILTER_KEY}
            placeholder={
              discover
                ? page.total === 0
                  ? 'Search the catalogue'
                  : `Search ${count(page.total, 'plugin', 'plugins')}`
                : `Filter ${count(mods.length, 'mod', 'mods')}`
            }
            value={discover ? view.search : view.query}
            onInput={value => v.act.filter(value)}
            onSubmit={value => v.act.filter(value)}
          />
        </Box>
        {KeyButton(v, {
          action: 'filter',
          on: surface,
          label: discover ? 'search' : 'filter',
          dim: true,
          onPress: () => v.act.focusFilter(),
        })}
      </Box>
    ) : null

  return (
    <Box flexDirection="column" height={frame.bodyRows}>
      <Box flexDirection="row" justifyContent="space-between" height={1} overflow="hidden">
        <Box flexDirection="row" columnGap={3} flexShrink={1}>
          {tabRow}
        </Box>
        <Box flexDirection="row" columnGap={1} flexShrink={0}>
          {stale ? (
            <Text dimColor>{GLYPH.stale}</Text>
          ) : installed && sync.error !== undefined ? (
            <Text color={TONE.warn}>{GLYPH.problem} couldn't refresh</Text>
          ) : null}
          {top === undefined
            ? KeyButton(v, {
                action: 'refresh',
                on: surface,
                label: 'refresh',
                dim: true,
                onPress: () => v.act.refresh(),
              })
            : null}
        </Box>
      </Box>
      <Box flexDirection="row" justifyContent="space-between" columnGap={2} height={1}>
        <Box flexShrink={1} overflow="hidden">
          <Text dimColor wrap="truncate-end">
            {meta}
          </Text>
        </Box>
        {showList && pager !== undefined ? (
          <Box flexDirection="row" columnGap={2} flexShrink={0}>
            <Text dimColor>{pager}</Text>
            {top === undefined && split
              ? KeyButton(v, {
                  action: 'page.first',
                  on: surface,
                  label: 'first',
                  dim: true,
                  onPress: () => v.act.edge('first'),
                })
              : null}
            {top === undefined && split
              ? KeyButton(v, {
                  action: 'page.last',
                  on: surface,
                  label: 'last',
                  dim: true,
                  onPress: () => v.act.edge('last'),
                })
              : null}
          </Box>
        ) : null}
      </Box>
      {warning === undefined ? null : (
        <Text color={TONE.warn} wrap="truncate-end">
          {sanitize(warning, { max: 300 })}
        </Text>
      )}
      {field === null ? null : boxedField ? (
        <Box borderStyle="round" borderDimColor paddingX={1} flexDirection="row">
          {field}
        </Box>
      ) : (
        <Box flexDirection="row">{field}</Box>
      )}
      <Box flexDirection="column" flexGrow={1}>
        {body}
      </Box>
      {showStaged ? (
        <Box flexDirection="row" gap={2}>
          <Text color={TONE.warn}>
            {staged} staged {staged === 1 ? 'change' : 'changes'}
          </Text>
          {KeyButton(v, {
            action: 'apply',
            on: 'installed',
            label: 'review and apply',
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
      {Rule(v, frame.bodyColumns)}
      <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
        <Box flexDirection="row" columnGap={2} flexWrap="wrap" flexShrink={1}>
          {keys.map(button)}
          {hint === undefined ? null : <Text dimColor>{hint}</Text>}
        </Box>
        <Box flexDirection="row" columnGap={2} flexShrink={0}>
          {general.map(key => KeyButton(v, { ...key, dim: true }))}
          {top === undefined ? (
            <Button
              key="act:close"
              plain
              dimColor
              label={closeLabel}
              onPress={() => v.act.close()}
            />
          ) : (
            <Button key="act:back" plain dimColor label={closeLabel} onPress={() => v.act.back()} />
          )}
        </Box>
      </Box>
    </Box>
  )
}
