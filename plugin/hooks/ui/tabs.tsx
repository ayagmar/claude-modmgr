// What each tab puts in the dialog: its keys of the moment, its field, the line
// about it, its list (windowed to the rows the Pane leaves it) and the detail of
// its selection. The Pane draws the frame around whichever tab is shown and asks
// that tab alone; nothing here branches on another tab.

import type { RenderElement, UiPressArgument } from 'claude-code'
import type {
  CatalogPage,
  Degraded,
  DetectProgress,
  DevState,
  JobQueue,
  ModDetail,
  ModRow,
  Sync,
  View,
} from '../../types/index.d.ts'
import { devRowOf } from '../domain/dev.ts'
import { detectLine, foundRow, nextSort, SORT_LABEL } from '../domain/discover.ts'
import { type HealthItem, healthLines } from '../domain/health.ts'
import type { KeySurface } from '../domain/keymap.ts'
import {
  filterRows,
  pagerLabel,
  selectedRow,
  stagedIds,
  type Window,
  whyNoRemove,
  whyNoUpdate,
  windowFollowing,
} from '../domain/view.ts'
import { Detail, detailRows } from './Detail.tsx'
import { DevDetail, DevList, devDetailRows } from './Dev.tsx'
import { FoundDetail, FoundList, foundDetailRows } from './Discover.tsx'
import { HealthItemDetail, HealthList, healthDetailRows } from './Health.tsx'
import { List } from './Installed.tsx'
import type { ViewPorts } from './kit.tsx'

/** Everything the dialog reads from `$.state`, read once per draw. */
export type PaneData = {
  readonly view: View
  readonly mods: readonly ModRow[]
  readonly detail: ModDetail | null
  readonly queue: JobQueue
  readonly sync: Sync
  readonly degraded: Degraded
  readonly page: CatalogPage
  readonly detect: DetectProgress
  readonly dev: DevState
  /** Health's items, from state alone (`healthItemsOf`). */
  readonly items: readonly HealthItem[]
}

/** A key of the moment: what it does, where its hotkey is bound, what it says. */
export type Key = {
  readonly action: string
  readonly on: KeySurface
  readonly label: string
  /** Gets the press: a copy targets the surface it came from. */
  readonly onPress: (press: UiPressArgument) => void
}

/** How the Pane has laid the body out, which the tab's list and keys follow. */
export type TabFrame = {
  /** No overlay is up and the list is drawn alone: the footer carries the item's keys. */
  readonly itemKeys: boolean
  readonly showList: boolean
  readonly readOnly: boolean
  readonly bodyColumns: number
}

/** Where the list is drawn: its columns, and whether the detail stands beside it. */
export type ListFrame = { readonly columns: number; readonly beside: boolean }

/** The search or filter field above the list. */
export type TabField = {
  readonly placeholder: string
  readonly value: string
  /** The key that moves the focus to it, and what it says. */
  readonly label: string
}

/** What the detail is drawn in: the rows and columns it has. */
export type Sized = { readonly readOnly: boolean; readonly rows: number; readonly columns: number }

export type TabView = {
  /** Where the list's hotkeys are bound. */
  readonly surface: KeySurface
  /** Where the detail's hotkeys are bound. */
  readonly detailSurface: KeySurface
  /** The tab's own keys for the footer. */
  readonly keys: readonly Key[]
  /** A command waiting to be accepted is offered from this tab (Dev's `v` is validate). */
  readonly offersAccept: boolean
  readonly field: TabField | undefined
  /** The line under the tabs. */
  readonly meta: string
  /** A refresh is running for what the tab shows. */
  readonly stale: boolean
  /** The detail stands beside the list when the body is wide enough. */
  readonly beside: boolean
  /** Items in the list, and the rows the whole list would take. */
  readonly count: number
  readonly fullRows: number
  /** The list in `rows` rows, and its pager when it doesn't all show. */
  readonly list: (
    rows: number,
    frame: ListFrame,
  ) => {
    readonly el: RenderElement
    readonly pager: string | undefined
  }
  readonly detail: (sized: Sized) => RenderElement
  readonly detailRows: (sized: Sized) => number
}

/**
 * Where each list's window starts, by surface and list, kept between draws: a
 * list scrolls only when the selection reaches its edge (`windowFollowing`), so
 * the window has to remember where it was. A module's memory, like the
 * catalogue's; a reload starts each list centred on its selection again.
 */
const scrolled = new Map<string, number>()

const follow = (v: ViewPorts, list: string, count: number, index: number, size: number): Window => {
  const key = `${v.surface}:${list}`
  const window = windowFollowing(scrolled.get(key), count, index, size)
  scrolled.set(key, window.start)
  return window
}

const count = (n: number, one: string, many: string) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

const installedTab = (v: ViewPorts, d: PaneData, f: TabFrame): TabView => {
  const { view, mods, sync } = d
  const rows = filterRows(mods, view.query)
  const selected = selectedRow(view, mods)
  const staged = stagedIds(view, mods)
  const keys: Key[] = []
  if (!f.readOnly) {
    const add = (key: Omit<Key, 'on'>) => keys.push({ on: 'installed', ...key })
    if (f.itemKeys && selected !== undefined) {
      add({ action: 'toggle', label: 'toggle', onPress: () => v.act.toggle() })
      if (whyNoUpdate(selected) === undefined)
        add({ action: 'update', label: 'update', onPress: () => v.act.update() })
      if (whyNoRemove(selected) === undefined)
        add({ action: 'remove', label: 'remove', onPress: () => v.act.remove() })
    }
    if (mods.filter(row => whyNoUpdate(row) === undefined).length > 1)
      add({ action: 'update-all', label: 'update all', onPress: () => v.act.updateAll() })
    add({ action: 'undo', label: 'undo', onPress: () => v.act.undo() })
  }
  const on = mods.filter(row => row.enabled).length
  const updates = mods.filter(row => row.updateTo !== undefined).length
  const detailHow = (sized: Sized) => ({ ...sized, row: selected, detail: d.detail, staged, view })
  return {
    surface: 'installed',
    detailSurface: 'detail',
    keys,
    offersAccept: true,
    field:
      f.showList && mods.length > 0
        ? {
            placeholder: `Filter ${count(mods.length, 'mod', 'mods')}`,
            value: view.query,
            label: 'filter',
          }
        : undefined,
    meta: [
      `${on} of ${count(mods.length, 'mod', 'mods')} on`,
      updates === 0 ? '' : count(updates, 'update', 'updates'),
    ]
      .filter(part => part !== '')
      .join(' · '),
    stale: sync.refreshing,
    beside: rows.length > 0,
    count: rows.length,
    fullRows: rows.length,
    list: (size, frame) => {
      const window = follow(
        v,
        'installed',
        rows.length,
        selected === undefined ? 0 : rows.indexOf(selected),
        size,
      )
      return {
        el: List(v, rows, {
          view,
          staged,
          columns: frame.columns,
          window,
          focusId: selected?.id,
          loading: sync.at === undefined && sync.error === undefined,
          total: mods.length,
          beside: frame.beside,
        }),
        pager: pagerLabel(window, rows.length),
      }
    },
    detail: sized => Detail(v, detailHow(sized)),
    detailRows: sized => detailRows(v, detailHow(sized)),
  }
}

const discoverTab = (v: ViewPorts, d: PaneData, f: TabFrame): TabView => {
  const { view, page, detect, degraded } = d
  const found = foundRow(view, page)
  const keys: Key[] = []
  const add = (key: Omit<Key, 'on'>) => keys.push({ on: 'discover', ...key })
  if (f.itemKeys && !f.readOnly && found !== undefined)
    add({ action: 'install', label: 'install', onPress: () => v.act.install() })
  // It says what pressing it does next.
  add({
    action: 'sort',
    label: `sort by ${SORT_LABEL[nextSort(view.sort)]}`,
    onPress: () => v.act.cycleSort(),
  })
  add({
    action: 'mine',
    label: view.mine === true ? 'all of GitHub' : 'yours only',
    onPress: () => v.act.toggleMine(),
  })
  if (!f.readOnly)
    add({ action: 'marketplace-add', label: 'marketplace', onPress: () => v.act.addMarketplace() })
  // The mods Discover can list: with `k`, only your marketplaces' (what the detector found).
  const listed = detect.found + (view.mine === true ? 0 : page.community)
  return {
    surface: 'discover',
    detailSurface: 'discover-detail',
    keys,
    offersAccept: true,
    field:
      f.showList && (page.total > 0 || view.search !== '')
        ? {
            placeholder: listed === 0 ? 'Search mods' : `Search ${count(listed, 'mod', 'mods')}`,
            value: view.search,
            label: 'search',
          }
        : undefined,
    meta: [
      view.search === '' ? '' : `${page.matched.toLocaleString('en-US')} matching`,
      detectLine(detect) ?? '',
      page.community === 0 || view.mine === true
        ? ''
        : `${page.community.toLocaleString('en-US')} from GitHub`,
    ]
      .filter(part => part !== '')
      .join(' · '),
    stale: page.loading,
    beside: page.matched > 0,
    count: page.matched,
    // Each entry takes two rows: its name, then what it says it does.
    fullRows: page.matched * 2,
    list: (size, frame) => {
      const at = found === undefined ? 0 : page.rows.indexOf(found)
      const window = follow(
        v,
        `discover@${page.offset}`,
        page.rows.length,
        at,
        Math.floor(size / 2),
      )
      return {
        el: FoundList(v, page, {
          view,
          columns: frame.columns,
          window,
          focusId: found?.id,
          networkOff: degraded.network,
          checking: detect.running,
          beside: frame.beside,
        }),
        pager:
          page.matched > window.end - window.start
            ? pagerLabel(
                { start: page.offset + window.start, end: page.offset + window.end },
                page.matched,
              )
            : undefined,
      }
    },
    detail: sized => FoundDetail(v, found, sized),
    detailRows: sized => foundDetailRows(v, found, sized),
  }
}

const devTab = (v: ViewPorts, d: PaneData, f: TabFrame): TabView => {
  const rows = d.dev.rows
  const row = devRowOf(d.view.dev, rows)
  const how = { jobs: d.queue.jobs }
  const keys: Key[] = []
  const add = (key: Omit<Key, 'on'>) => keys.push({ on: 'dev', ...key })
  if (f.itemKeys && row !== undefined) {
    const path = row.path
    if (!f.readOnly) {
      add({ action: 'validate', label: 'validate', onPress: () => v.act.devRun('validate') })
      add({ action: 'test', label: 'test', onPress: () => v.act.devRun('test') })
      add({ action: 'share', label: 'share', onPress: () => v.act.share() })
    }
    add({ action: 'copy', label: 'copy path', onPress: press => v.act.copy(path, press.surface) })
  }
  if (!f.readOnly) add({ action: 'reload', label: 'reload', onPress: () => v.act.reload() })
  return {
    surface: 'dev',
    detailSurface: 'dev-detail',
    keys,
    offersAccept: false,
    field: undefined,
    meta: `${count(rows.length, 'mod', 'mods')} under development`,
    stale: d.dev.loading,
    beside: rows.length > 0,
    count: rows.length,
    fullRows: rows.length,
    list: (size, frame) => {
      const window = follow(v, 'dev', rows.length, row === undefined ? 0 : rows.indexOf(row), size)
      return {
        el: DevList(v, rows, {
          ...how,
          columns: frame.columns,
          window,
          focusKey: row?.key,
          loading: d.dev.loading && d.dev.at === undefined,
          beside: frame.beside,
        }),
        pager: pagerLabel(window, rows.length),
      }
    },
    detail: sized => DevDetail(v, row, { ...how, ...sized }),
    detailRows: sized => devDetailRows(v, row, { ...how, ...sized }),
  }
}

/** Health: every item, `problems` of them needing the person. */
const healthTab = (v: ViewPorts, d: PaneData, f: TabFrame, problems: number): TabView => {
  const { items } = d
  const item = items.find(each => each.key === d.view.health) ?? items[0]
  const keys: Key[] = f.readOnly
    ? []
    : [{ action: 'reload', on: 'health', label: 'reload', onPress: () => v.act.reload() }]
  return {
    surface: 'health',
    detailSurface: 'health',
    keys,
    offersAccept: true,
    field: undefined,
    meta:
      problems === 0
        ? 'Nothing needs you.'
        : `${count(problems, 'problem', 'problems')} to look at`,
    // Its items follow the installed list.
    stale: d.sync.refreshing,
    // Its items are sentences: the list takes the body, Enter opens one whole.
    beside: false,
    count: items.length,
    // Each group's name takes a row of its own.
    fullRows:
      items.length +
      items.filter((each, index) => index === 0 || items[index - 1]?.group !== each.group).length,
    list: (size, frame) => {
      const shown = healthLines(items, item === undefined ? 0 : items.indexOf(item), size)
      return {
        el: HealthList(v, shown.lines, {
          columns: frame.columns,
          focusKey: item?.key,
          before: items.slice(0, shown.items.start),
          after: items.slice(shown.items.end),
        }),
        pager: pagerLabel(shown.items, items.length),
      }
    },
    detail: () => HealthItemDetail(v, item),
    detailRows: () => healthDetailRows(item, f.bodyColumns),
  }
}

/** The tab `d.view.tab` names. */
export const tabView = (v: ViewPorts, d: PaneData, f: TabFrame, problems: number): TabView => {
  switch (d.view.tab) {
    case 'discover':
      return discoverTab(v, d, f)
    case 'dev':
      return devTab(v, d, f)
    case 'health':
      return healthTab(v, d, f, problems)
    default:
      return installedTab(v, d, f)
  }
}
