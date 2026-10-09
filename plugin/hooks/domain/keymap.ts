// The one keymap. Every hotkey a Button carries comes from
// here, and the help overlay and the landing page are generated from it.
// A hotkey is one digit or one lowercase letter; the band takes letters
// only, since a bare digit in an empty composer presses a band Button.

export const SURFACES = [
  'pane',
  'installed',
  'discover',
  'discover-empty',
  'dev',
  'health',
  'detail',
  'discover-detail',
  'dev-detail',
  'share',
  'review',
  'help',
  'jobs',
  'band',
] as const
export type KeySurface = (typeof SURFACES)[number]

export type Binding = {
  readonly action: string
  /** A Button hotkey, or undefined for an engine key (shown in help only). */
  readonly hotkey?: string
  /** How help names an engine key (`enter`, `esc`, `↑↓`). */
  readonly key?: string
  readonly label: string
  readonly on: readonly KeySurface[]
}

const LISTS: readonly KeySurface[] = ['installed', 'discover', 'dev', 'health']

export const BINDINGS: readonly Binding[] = [
  { action: 'tab.installed', hotkey: '1', label: 'Installed', on: ['pane'] },
  { action: 'tab.discover', hotkey: '2', label: 'Discover', on: ['pane'] },
  { action: 'tab.dev', hotkey: '3', label: 'Dev', on: ['pane'] },
  { action: 'tab.health', hotkey: '4', label: 'Health', on: ['pane'] },
  { action: 'move', key: '↑↓ tab', label: 'move', on: ['pane'] },
  { action: 'row.next', hotkey: 'j', label: 'next row', on: LISTS },
  { action: 'row.prev', hotkey: 'k', label: 'previous row', on: LISTS },
  { action: 'open', key: 'enter', label: 'open', on: LISTS },
  { action: 'back', key: 'esc', label: 'back · list · clear · close', on: ['pane'] },
  { action: 'jobs', hotkey: 'q', label: 'jobs', on: ['pane'] },
  { action: 'help', hotkey: 'h', label: 'keys', on: ['pane'] },
  { action: 'filter', hotkey: 'f', label: 'filter', on: ['installed', 'discover'] },
  { action: 'sort', hotkey: 'o', label: 'sort', on: ['discover'] },
  { action: 'mine', hotkey: 'u', label: 'only your marketplaces', on: ['discover'] },
  { action: 'page.prev', key: 'pgup', label: 'previous page', on: LISTS },
  { action: 'page.next', key: 'pgdn', label: 'next page', on: LISTS },
  { action: 'page.first', hotkey: 'g', label: 'first page', on: LISTS },
  { action: 'page.last', hotkey: 'b', label: 'last page', on: LISTS },
  { action: 'refresh', hotkey: 'r', label: 'refresh', on: LISTS },
  { action: 'toggle', hotkey: 'e', label: 'enable/disable', on: ['installed', 'detail'] },
  { action: 'apply', hotkey: 's', label: 'apply staged', on: ['installed'] },
  { action: 'undo', hotkey: 'z', label: 'undo last batch', on: ['installed'] },
  { action: 'update', hotkey: 'u', label: 'update', on: ['installed', 'detail'] },
  { action: 'update-all', hotkey: 'a', label: 'update all', on: ['installed', 'detail'] },
  { action: 'remove', hotkey: 'x', label: 'remove', on: ['installed', 'detail'] },
  { action: 'install', hotkey: 'i', label: 'install', on: ['discover', 'discover-detail'] },
  {
    action: 'accept',
    hotkey: 'v',
    label: 'review a declared command',
    on: ['installed', 'discover'],
  },
  {
    action: 'marketplace-add',
    hotkey: 'm',
    label: 'add a marketplace',
    on: ['discover', 'discover-empty'],
  },
  { action: 'validate', hotkey: 'v', label: 'validate', on: ['dev', 'dev-detail'] },
  { action: 'test', hotkey: 't', label: 'test', on: ['dev', 'dev-detail'] },
  {
    action: 'copy',
    hotkey: 'c',
    label: 'copy id, path or command',
    on: ['detail', 'discover-detail', 'dev', 'dev-detail', 'share', 'review'],
  },
  { action: 'share', hotkey: 'p', label: 'share', on: ['dev', 'dev-detail'] },
  { action: 'reload', hotkey: 'l', label: 'reload plugins', on: ['dev', 'health', 'band'] },
  { action: 'confirm', hotkey: 'y', label: 'confirm', on: ['review'] },
  { action: 'cancel', hotkey: 'n', label: 'cancel', on: ['review'] },
  // Not `d`: that dismisses the band, a reflex there.
  { action: 'keep-data', hotkey: 'w', label: "keep or wipe a removed mod's data", on: ['review'] },
  { action: 'cancel-job', hotkey: 'd', label: 'cancel running job', on: ['jobs'] },
  { action: 'open-modmgr', hotkey: 'm', label: 'open mods', on: ['band'] },
  { action: 'dismiss', hotkey: 'd', label: 'dismiss', on: ['band'] },
]

/**
 * Surfaces mounted together: the pane shell, one view, and the overlay on top
 * (in the split layout the list and the overlay are both drawn). A view's
 * detail is its own (Installed's, Discover's, Dev's); review, help and the job
 * log go over any view. The band is its own site.
 */
export const MOUNT_SETS: readonly (readonly KeySurface[])[] = (() => {
  const shared: KeySurface[] = ['review', 'help', 'jobs']
  const own: Readonly<Record<string, readonly KeySurface[]>> = {
    installed: ['detail'],
    discover: ['discover-detail'],
    'discover-empty': ['discover-detail'],
    dev: ['dev-detail', 'share'],
    health: [],
  }
  const sets: KeySurface[][] = [['band']]
  for (const [view, overlays] of Object.entries(own) as [KeySurface, readonly KeySurface[]][]) {
    sets.push(['pane', view])
    for (const overlay of [...overlays, ...shared]) sets.push(['pane', view, overlay])
  }
  return sets
})()

export const HOTKEY = /^[0-9a-z]$/

export type Collision = {
  readonly hotkey: string
  readonly actions: string[]
  readonly set: string
}

/**
 * Two Buttons with one hotkey in one site: "two clash, later wins". The
 * same action on two surfaces of a set is fine: the shell draws it once.
 */
export const collisions = (
  bindings: readonly Binding[] = BINDINGS,
  sets: readonly (readonly KeySurface[])[] = MOUNT_SETS,
): Collision[] =>
  sets.flatMap(set => {
    const byKey = new Map<string, Set<string>>()
    for (const binding of bindings) {
      if (binding.hotkey === undefined || !binding.on.some(surface => set.includes(surface)))
        continue
      byKey.set(binding.hotkey, (byKey.get(binding.hotkey) ?? new Set()).add(binding.action))
    }
    return [...byKey.entries()]
      .filter(([, actions]) => actions.size > 1)
      .map(([hotkey, actions]) => ({ hotkey, actions: [...actions].sort(), set: set.join('+') }))
  })

/** Bindings the engine refuses or misreads: a malformed hotkey, or a digit on the band. */
export const invalidHotkeys = (bindings: readonly Binding[] = BINDINGS): Binding[] =>
  bindings.filter(
    binding =>
      binding.hotkey !== undefined &&
      (!HOTKEY.test(binding.hotkey) || (binding.on.includes('band') && /\d/.test(binding.hotkey))),
  )

/** The hotkey for an action on a surface. */
export const hotkeyFor = (action: string, surface: KeySurface): string | undefined =>
  BINDINGS.find(binding => binding.action === action && binding.on.includes(surface))?.hotkey

/** Help rows for what is mounted (less `hidden` actions): engine keys first, then hotkeys, once per action. */
export const helpFor = (
  surfaces: readonly KeySurface[],
  hidden: ReadonlySet<string> = new Set(),
): { key: string; label: string }[] => {
  const seen = new Set<string>()
  const rows: { key: string; label: string; engine: boolean }[] = []
  for (const binding of BINDINGS) {
    if (
      seen.has(binding.action) ||
      hidden.has(binding.action) ||
      !binding.on.some(surface => surfaces.includes(surface))
    )
      continue
    seen.add(binding.action)
    rows.push({
      key: binding.hotkey ?? binding.key ?? '',
      label: binding.label,
      engine: binding.hotkey === undefined,
    })
  }
  return [...rows.filter(row => row.engine), ...rows.filter(row => !row.engine)].map(
    ({ key, label }) => ({
      key,
      label,
    }),
  )
}
