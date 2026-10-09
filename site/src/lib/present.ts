// What a result says about a mod, in words. Shared by the build's first page
// (components/ModRow.astro) and the browser's rows (scripts/store.ts), so a
// prerendered row and a searched one say the same thing. The words come from
// the plugin's capabilities.ts, as /mods shows them.
import { notableText, REACH_LABEL, REACH_ORDER } from '../../../plugin/hooks/domain/capabilities.ts'
import {
  type Mod,
  NOTABLE_BITS,
  type NotableName,
  type Page,
  type Query,
  REACH_BITS,
  type ReachName,
} from './search.ts'

/** What installs modmgr, typed at the Claude Code prompt. */
export const INSTALL = '/plugin install modmgr --marketplace ayagmar/claude-mods'

/** Results on a page, at build and in the browser. */
export const PAGE_SIZE = 40

/** The filter chips: the id the URL carries, the label, and what it asks of a search. */
export const FILTERS = [
  { id: 'no-network', label: 'No network', query: { without: REACH_BITS.network } },
  {
    id: 'no-programs',
    label: "Doesn't run programs",
    query: { withoutNotable: NOTABLE_BITS['runs-programs'] },
  },
  { id: 'marketplace', label: 'Installs from a marketplace', query: { installable: true } },
  { id: 'validates', label: 'Passes validation', query: { working: true } },
] as const satisfies readonly {
  id: string
  label: string
  query: Omit<Query, 'text' | 'sort'>
}[]

/** The sort menu's words for search.ts's SORTS. */
export const SORT_LABEL = {
  relevance: 'Best match',
  popular: 'Popular',
  stars: 'Most stars',
  recent: 'Recently pushed',
  name: 'Name',
} as const

/** A command split before each flag, so a flag can stay with its value when the line wraps. */
export const flagParts = (line: string): string[] =>
  line.split(' --').map((part, n) => (n === 0 ? part : `--${part}`))

/** What the install line does, in a sentence. */
export const installNoteOf = (mod: Pick<Mod, 'repo' | 'plugin'>): string =>
  mod.plugin === undefined
    ? `${mod.repo} has no marketplace at its root: clone it and load the folder with --plugin-dir.`
    : `Adds the marketplace in ${mod.repo} to your user settings, then installs ${mod.plugin}.`

/** Where in its repository a mod lives: `owner/repo`, or `owner/repo/path`. */
export const sourceOf = (mod: Pick<Mod, 'repo' | 'path'>): string =>
  mod.path === '' ? mod.repo : `${mod.repo}/${mod.path}`

const DAY = 24 * 60 * 60 * 1000

/** What it reaches, in capabilities.ts's words and order. */
export const reachesOf = (mod: Pick<Mod, 'reach'>): string[] =>
  REACH_ORDER.filter(reach => (mod.reach & REACH_BITS[reach]) !== 0).map(
    reach => REACH_LABEL[reach],
  )

/** All seven reaches, in order, and whether it has each: the datasheet's pins. */
export const pinsOf = (mod: Pick<Mod, 'reach'>): { label: string; on: boolean }[] =>
  REACH_ORDER.map(reach => ({
    label: REACH_LABEL[reach],
    on: (mod.reach & REACH_BITS[reach]) !== 0,
  }))

/** REACH_LABEL, short enough for a badge on a row. */
const BADGE: Readonly<Record<ReachName, string>> = {
  machine: 'Machine',
  network: 'Network',
  session: 'Session',
  model: 'Model input',
  tools: 'Tools',
  plugins: 'Plugins',
  display: 'Display only',
}

export type Badge = { readonly short: string; readonly full: string }

/** A row's badges: what it reaches past the display, or "Display only" when that is all. */
export const badgesOf = (mod: Pick<Mod, 'reach'>): Badge[] => {
  const reaches = REACH_ORDER.filter(reach => (mod.reach & REACH_BITS[reach]) !== 0)
  const past = reaches.filter(reach => reach !== 'display')
  return (past.length > 0 ? past : reaches).map(reach => ({
    short: BADGE[reach],
    full: REACH_LABEL[reach],
  }))
}

/** The notable combinations it has, most serious first, in plain words. */
export const notablesOf = (mod: Pick<Mod, 'notable'>): string[] =>
  (Object.keys(NOTABLE_BITS) as NotableName[])
    .filter(name => (mod.notable & NOTABLE_BITS[name]) !== 0)
    .map(notableText)

/** What `claude plugin validate` said, short for the row and whole for the detail. */
export const CHECK_SHORT = ['Validates', 'Validates with warnings', 'Fails validate'] as const
export const CHECK_TEXT = [
  'Passes claude plugin validate',
  'Passes claude plugin validate, with warnings',
  'Fails claude plugin validate',
] as const

/** A day since the epoch as a date, the same wherever the page is read. */
export const dayText = (days: number): string =>
  new Date(days * DAY).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })

export const countText = (n: number): string => n.toLocaleString('en-US')

/** `41–80 of 2,692 mods`, or that nothing matched. */
export const rangeText = (page: Page): string =>
  page.total === 0
    ? 'No mods match'
    : `${countText(page.from)}–${countText(page.from + page.items.length - 1)} of ${countText(page.total)} ${page.total === 1 ? 'mod' : 'mods'}`
