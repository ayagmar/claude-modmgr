// The `/mods` dialog: the tabs and a line about the tab, the search field, the
// tab's list (with the detail beside it from SPLIT_MIN_COLUMNS body columns),
// the overlay on top, a line under the list for what is staged and the pager,
// and a footer with the main keys of the moment. It fills
// `scroll.bodyRows`: the list is windowed and a taller overlay is clipped (the
// detail draws compactly), so the header and footer never scroll away.
// Everything drawn comes from `$.state`.

import type { RenderElement } from 'claude-code'
import type { Overlay, View } from '../../types/index.d.ts'
import { awaitingAcceptance } from '../domain/discover.ts'
import { healthItemsOf, problemCount } from '../domain/health.ts'
import type { KeySurface } from '../domain/keymap.ts'
import { sanitize } from '../domain/sanitize.ts'
import {
  batchLineOf,
  FILTER_KEY,
  footerRowsFor,
  layoutFor,
  listColumnsFor,
  pagerLabel,
  stagedIds,
} from '../domain/view.ts'
import { Share, shareRows } from './Dev.tsx'
import { GLYPH, HiddenRows, KeyButton, Rule, TONE, type ViewPorts } from './kit.tsx'
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
import { type Key, tabView } from './tabs.tsx'

export type PaneFrame = {
  readonly bodyColumns: number
  readonly bodyRows: number
  readonly isFocused: boolean
}

/** Keymap actions this version doesn't draw yet: help leaves them out. */
const NOT_YET: ReadonlySet<string> = new Set()

/** From this many body rows the search field is drawn in a box. */
const BOXED_FIELD_MIN_ROWS = 18

/** The items one page of the list drawn last holds: what Page Up and Page Down move by. */
let lastPage = 1
export const pageSize = (): number => lastPage

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
  const installed = view.tab === 'installed'
  const layout = layoutFor(frame.bodyColumns)
  // A review overlay whose review was just taken (confirm) is already gone: the
  // tree drawn in between must be the final one, or the focus ring set on a row
  // in it is lost when the real list replaces it.
  const stack = review === null ? view.stack.filter(item => item !== 'review') : view.stack
  const top = stack.at(-1)
  const readOnly = degraded.process
  // A missing CLI concerns every tab; network use only Discover.
  const warning = degraded.process
    ? degraded.reason
    : view.tab === 'discover' && degraded.network
      ? 'Network use is off: only local catalogues are checked for mods.'
      : undefined
  const status = batchLineOf(queue, attention.lastReload !== undefined)
  const terminal = v.surface === 'terminal'
  // A terminal row is one cell high. A desktop's Buttons stand taller than its
  // line, so a row held to one there draws over the next.
  const oneRow = terminal ? { height: 1, overflow: 'hidden' as const } : {}
  const split = layout === 'split'
  // Help, the job log and the welcome are about the whole dialog: they take the
  // whole body (beside the list, the welcome's key would lose the ring to a row).
  const wide = top === 'help' || top === 'jobs' || top === 'welcome'
  const showList = (split && !wide) || top === undefined

  // Health's items count on its tab's label whichever tab is shown.
  const items = healthItemsOf({ mods, attention, degraded, sync, detect, queue, facts })
  const problems = problemCount(items)
  const tab = tabView(
    v,
    { view, mods, detail, queue, sync, degraded, page, detect, dev: devState, items },
    {
      // Beside the list the detail draws its own keys (toggle, install, validate…);
      // stacked, the footer carries them until Enter opens the detail.
      itemKeys: !split && top === undefined,
      showList,
      readOnly,
      bodyColumns: frame.bodyColumns,
    },
    problems,
  )
  const beside = split && tab.beside
  const listColumns = beside ? listColumnsFor(frame.bodyColumns) : frame.bodyColumns
  const field = Input === undefined ? undefined : tab.field
  // What is staged shows under Installed's list.
  const staged = installed ? stagedIds(view, mods).size : 0
  const showStaged = staged > 0 && !readOnly && top !== 'review'
  const stopped = readOnly ? undefined : awaitingAcceptance(queue.jobs)

  const tabs: readonly { readonly tab: View['tab']; readonly label: string }[] = [
    { tab: 'installed', label: 'Installed' },
    { tab: 'discover', label: 'Discover' },
    { tab: 'dev', label: 'Dev' },
    { tab: 'health', label: problems === 0 ? 'Health' : `Health ${GLYPH.problem}${problems}` },
  ]
  // The tab row's width: a shown tab is its label, another `n: label`. When it
  // and `r: refresh` don't fit, the tabs close up and refresh joins the footer.
  const tabsWidth = tabs.reduce(
    (sum, { tab, label }) => sum + label.length + (view.tab === tab ? 0 : 3),
    0,
  )
  const narrowHeader =
    tabsWidth + 3 * (tabs.length - 1) + 2 + 'r: refresh'.length > frame.bodyColumns
  // The footer's keys: the actions of the moment. Every key is drawn where it
  // belongs (tabs, refresh, search, pager, footer): a hotkey needs a Button,
  // and every Button is a stop of the Tab ring, so none is hidden.
  const keys: Key[] = []
  if (top === undefined) {
    keys.push(...tab.keys)
    if (narrowHeader)
      keys.push({
        action: 'refresh',
        on: tab.surface,
        label: 'refresh',
        onPress: () => v.act.refresh(),
      })
    // A waiting command is reviewed from a tab whose keys leave `v` to it.
    if (stopped !== undefined && tab.offersAccept)
      keys.push({
        action: 'accept',
        on: tab.surface,
        label: 'review the command',
        onPress: () => v.act.acceptShown(),
      })
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
  const boxedField = field !== undefined && frame.bodyRows >= BOXED_FIELD_MIN_ROWS
  const chrome =
    2 +
    (warning === undefined ? 0 : 1) +
    (field === undefined ? 0 : boxedField ? 3 : 1) +
    (view.notice === undefined ? 0 : 1) +
    (status === undefined ? 0 : 1) +
    1 +
    footerRows
  // Under the list, one line holds what is staged and the pager. The pager's
  // keys come after the field in the Tab ring: drawn above it, their coming
  // and going as the search narrows moved the ring off the field.
  const paging =
    ((beside && !wide) || top === undefined) &&
    tab.fullRows > frame.bodyRows - chrome - (showStaged ? 1 : 0)
  // Too narrow for both, the pager wraps under what is staged (its widest label counted).
  const stagedWidth = `${staged} staged changes  s: review and apply`.length
  const widestPager = pagerLabel({ start: tab.count - 1, end: tab.count }, tab.count) ?? ''
  const pagerWidth = `${widestPager}  ‹ prev  next ›  g: first  b: last`.length
  const underRows = showStaged
    ? paging
      ? footerRowsFor([stagedWidth, pagerWidth], frame.bodyColumns)
      : 1
    : paging
      ? 1
      : 0
  const listRows = Math.max(3, frame.bodyRows - chrome - underRows)

  // The list, windowed around the selection, and its pager.
  const { el: list, pager } = tab.list(listRows, { columns: listColumns, beside })
  const perPage = Math.max(1, Math.floor(listRows / tab.itemRows))
  lastPage = perPage

  const under = stack.at(-2)
  const surfaceOf = (overlay: Overlay | undefined): KeySurface =>
    overlay === undefined
      ? tab.surface
      : overlay === 'detail'
        ? tab.detailSurface
        : overlay === 'share'
          ? 'share'
          : overlay === 'review'
            ? 'review'
            : overlay === 'jobs'
              ? 'jobs'
              : tab.surface
  // Beside the list the detail's keys are mounted too.
  // Help takes the whole body: the detail beside the list isn't drawn under it.
  const helpSurfaces: KeySurface[] = ['pane', surfaceOf(under)]
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

  // Beside the list: what the list, the divider and their gaps leave; off the
  // terminal, inside the card's border and padding.
  const card = beside && !terminal ? 2 : 0
  const sized = {
    readOnly,
    rows: listRows - card,
    columns: beside ? frame.bodyColumns - listColumns - 3 - card : frame.bodyColumns,
  }
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
              ? welcomeRows(frame.bodyColumns)
              : which === 'detail'
                ? tab.detailRows(sized)
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
    beside && !wide ? (
      // Clipped to the list's rows, so the header and footer stay in view; the
      // whole detail is one Enter away. The detail beside the list carries its keys.
      <Box flexDirection="row" columnGap={1} height={listRows} overflow="hidden">
        <Box flexDirection="column" width={listColumns} flexShrink={0} overflow="hidden">
          <Box flexDirection="column" flexShrink={0}>
            {list}
          </Box>
        </Box>
        {terminal ? (
          <Box flexDirection="column" width={1} flexShrink={0}>
            {Array.from({ length: listRows }, (_, index) => (
              <Text key={`divider:${index}`} dimColor>
                │
              </Text>
            ))}
          </Box>
        ) : null}
        <Box
          flexDirection="column"
          flexGrow={1}
          flexShrink={1}
          overflow="hidden"
          {...(terminal ? {} : { borderStyle: 'round', borderDimColor: true, paddingX: 1 })}
        >
          <Box flexDirection="column" flexShrink={0}>
            {overlay(top) ?? tab.detail(sized)}
          </Box>
        </Box>
      </Box>
    ) : top === undefined ? (
      list
    ) : top === 'detail' ? (
      clipped(tab.detail(sized), overlayRows(top))
    ) : (
      clipped(overlay(top) ?? list, overlayRows(top))
    )

  const button = (key: Key) =>
    KeyButton(v, { action: key.action, on: key.on, label: key.label, onPress: key.onPress })
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
  const fieldRow =
    field !== undefined && Input !== undefined ? (
      <Box flexDirection="row" flexGrow={1}>
        <Text dimColor>⌕ </Text>
        <Box flexGrow={1}>
          <Input
            key={FILTER_KEY}
            placeholder={field.placeholder}
            value={field.value}
            onInput={value => v.act.filter(value)}
            onSubmit={value => v.act.filter(value)}
          />
        </Box>
        {KeyButton(v, {
          action: 'filter',
          on: tab.surface,
          label: field.label,
          dim: true,
          onPress: () => v.act.focusFilter(),
        })}
      </Box>
    ) : null

  return (
    <Box flexDirection="column" height={frame.bodyRows}>
      <Box flexDirection="row" justifyContent="space-between" {...oneRow}>
        <Box flexDirection="row" columnGap={narrowHeader ? 2 : 3} flexShrink={1}>
          {tabRow}
        </Box>
        <Box flexDirection="row" columnGap={1} flexShrink={0}>
          {tab.stale ? (
            <Text dimColor>{GLYPH.stale}</Text>
          ) : installed && sync.error !== undefined ? (
            <Text color={TONE.warn}>{GLYPH.problem} couldn't refresh</Text>
          ) : null}
          {top === undefined && !narrowHeader
            ? KeyButton(v, {
                action: 'refresh',
                on: tab.surface,
                label: 'refresh',
                dim: true,
                onPress: () => v.act.refresh(),
              })
            : null}
        </Box>
      </Box>
      <Box {...oneRow}>
        <Text dimColor wrap="truncate-end">
          {tab.meta}
        </Text>
      </Box>
      {warning === undefined ? null : (
        <Text color={TONE.warn} wrap="truncate-end">
          {sanitize(warning, { max: 300 })}
        </Text>
      )}
      {fieldRow === null ? null : boxedField ? (
        <Box borderStyle="round" borderDimColor paddingX={1} flexDirection="row" width="100%">
          {fieldRow}
        </Box>
      ) : (
        <Box flexDirection="row" width="100%">
          {fieldRow}
        </Box>
      )}
      <Box flexDirection="column" flexGrow={1}>
        {body}
      </Box>
      {underRows > 0 ? (
        <Box flexDirection="row" justifyContent="space-between" columnGap={2} flexWrap="wrap">
          <Box flexDirection="row" gap={2} flexShrink={0}>
            {showStaged ? (
              <Text color={TONE.warn}>
                {staged} staged {staged === 1 ? 'change' : 'changes'}
              </Text>
            ) : null}
            {showStaged
              ? KeyButton(v, {
                  action: 'apply',
                  on: 'installed',
                  label: 'review and apply',
                  onPress: () => v.act.apply(),
                })
              : null}
          </Box>
          {paging && pager !== undefined ? (
            <Box flexDirection="row" columnGap={2} flexShrink={0}>
              <Text dimColor>{pager}</Text>
              {top === undefined
                ? KeyButton(v, {
                    action: 'page.prev',
                    on: tab.surface,
                    label: '‹ prev',
                    dim: true,
                    onPress: () => v.act.scroll(-perPage),
                  })
                : null}
              {top === undefined
                ? KeyButton(v, {
                    action: 'page.next',
                    on: tab.surface,
                    label: 'next ›',
                    dim: true,
                    onPress: () => v.act.scroll(perPage),
                  })
                : null}
              {top === undefined
                ? KeyButton(v, {
                    action: 'page.first',
                    on: tab.surface,
                    label: 'first',
                    dim: true,
                    onPress: () => v.act.edge('first'),
                  })
                : null}
              {top === undefined
                ? KeyButton(v, {
                    action: 'page.last',
                    on: tab.surface,
                    label: 'last',
                    dim: true,
                    onPress: () => v.act.edge('last'),
                  })
                : null}
            </Box>
          ) : null}
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
      {/* j and k step the selection as the arrows do (vim's keys): last, so
          they come after every stop the ring walks to. */}
      {top === undefined
        ? HiddenRows(v, [
            KeyButton(v, {
              action: 'row.next',
              on: tab.surface,
              label: 'next row',
              onPress: () => v.act.scroll(1),
            }),
            KeyButton(v, {
              action: 'row.prev',
              on: tab.surface,
              label: 'previous row',
              onPress: () => v.act.scroll(-1),
            }),
          ])
        : null}
    </Box>
  )
}
