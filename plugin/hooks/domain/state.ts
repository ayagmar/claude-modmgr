// What each `$.state` key reads before anything is written, and the shape tag
// its atom is kept under (C3). Bump a key's tag whenever its type in
// types/index.d.ts changes: the new module then reads the old value as absent.

import type {
  Attention,
  CatalogPage,
  Degraded,
  DetectProgress,
  DevState,
  JobQueue,
  ModDetail,
  ModRow,
  ReviewRequest,
  Sync,
  View,
} from '../../types/index.d.ts'

/** `PluginState['modmgr']` with each `Shaped<T>` read as its `T`. */
export type ModmgrState = {
  mods: ModRow[]
  detail: ModDetail | null
  catalogPage: CatalogPage
  detect: DetectProgress
  queue: JobQueue
  sync: Sync
  view: View
  review: ReviewRequest | null
  attention: Attention
  degraded: Degraded
  dev: DevState
}

export type StateKey = keyof ModmgrState

export const SHAPES: Readonly<Record<StateKey, string>> = {
  mods: 'mods/2',
  detail: 'detail/2',
  catalogPage: 'catalogPage/2',
  detect: 'detect/1',
  queue: 'queue/1',
  sync: 'sync/1',
  view: 'view/5',
  review: 'review/3',
  attention: 'attention/2',
  degraded: 'degraded/1',
  dev: 'dev/1',
}

export const INITIAL_VIEW: View = {
  tab: 'installed',
  stack: [],
  query: '',
  search: '',
  kind: 'mods',
  sort: 'name',
  staged: {},
}

export const INITIAL: Readonly<ModmgrState> = {
  mods: [],
  detail: null,
  catalogPage: { rows: [], total: 0, matched: 0, offset: 0, loading: false },
  detect: { checked: 0, total: 0, found: 0, running: false },
  queue: { owner: '', jobs: [] },
  sync: { refreshing: false, skipped: 0 },
  view: INITIAL_VIEW,
  review: null,
  attention: { updates: 0, problems: 0, reloadPending: false, capsChanged: 0 },
  degraded: { process: false, network: false, acceptCommand: false },
  dev: { rows: [], failures: {}, loading: false },
}
