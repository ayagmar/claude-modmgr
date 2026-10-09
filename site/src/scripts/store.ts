// The page's search in the browser. The first page of results arrives
// prerendered, so nothing here runs until someone uses it: mods.json loads on
// the first sign of use after the page has loaded (or at once when the URL
// asks for a search), is parsed and indexed once, and every keystroke searches
// it in memory. Only one page of rows is ever in the DOM, and rows are built
// with DOM APIs and textContent: descriptions are untrusted text. On a wide
// screen the selected row's mod fills the datasheet beside the list. The URL
// keeps the search and the chosen mod (lib/state.ts), so a link shares both.
import {
  badgesOf,
  CHECK_SHORT,
  CHECK_TEXT,
  countText,
  dayText,
  FILTERS,
  findMod,
  flagParts,
  installNoteOf,
  isProjectMod,
  notablesOf,
  PAGE_SIZE,
  PAGE_SIZES,
  pinsOf,
  projectNoteOf,
  rangeText,
  reachesOf,
  sourceOf,
} from '../lib/present.ts'
import {
  type Data,
  type Index,
  indexOf,
  installLineOf,
  linkOf,
  type Mod,
  type Page,
  pageLinks,
  pageOf,
  type Query,
  search,
  shortCount,
  toMod,
  words,
} from '../lib/search.ts'
import { isSort, pageContaining, type State, searchOf, stateOf } from '../lib/state.ts'

const DATA_URL = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/mods.json`

const find = <T extends Element>(selector: string): T => {
  const found = document.querySelector<T>(selector)
  if (found === null) throw new Error(`the page has no ${selector}`)
  return found
}

const form = find<HTMLFormElement>('#search')
const input = find<HTMLInputElement>('#q')
const sortMenu = find<HTMLSelectElement>('#sort')
const perMenu = find<HTMLSelectElement>('#per')
const chips = [...document.querySelectorAll<HTMLInputElement>('input[name="f"]')]
const list = find<HTMLOListElement>('#results')
const count = find<HTMLElement>('#count')
const pager = find<HTMLElement>('#pager')
const status = find<HTMLElement>('#status')

const urlOf = (state: State): string => `${location.pathname}${searchOf(state)}`

const queryOf = (state: State): Query =>
  Object.assign(
    { text: state.q, sort: state.sort },
    ...FILTERS.filter(filter => state.filters.includes(filter.id)).map(filter => filter.query),
  )

const state = stateOf(location.search)
const isDefault = (): boolean => searchOf(state) === ''

/** The controls, set to the state. */
const showState = (): void => {
  input.value = state.q
  sortMenu.value = state.sort
  perMenu.value = String(state.per)
  for (const chip of chips) chip.checked = state.filters.includes(chip.value)
}

/** The URL, kept up with the selection: once it settles, as a pointer crosses rows. */
let urlTimer = 0
const writeUrl = (): void => {
  clearTimeout(urlTimer)
  urlTimer = window.setTimeout(() => history.replaceState(null, '', urlOf(state)), 150)
}

/** A link to a mod on this page, under the current search. */
const linkTo = (key: string): string =>
  new URL(urlOf({ ...state, page: 1, mod: key }), location.href).href

// --- Rows, as components/ModRow.astro writes them -------------------------

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className !== '') node.className = className
  if (text !== '') node.textContent = text
  return node
}

const SVG = 'http://www.w3.org/2000/svg'
const icon = (name: string): SVGSVGElement => {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('class', 'i')
  svg.setAttribute('aria-hidden', 'true')
  const use = document.createElementNS(SVG, 'use')
  use.setAttribute('href', `#i-${name}`)
  svg.append(use)
  return svg
}

/** The text, with what the search's words matched in <mark>. */
const marked = (text: string, terms: readonly string[]): Node[] => {
  const lower = text.toLowerCase()
  // A lowercase of another length (some scripts) can't map back: no marks.
  if (terms.length === 0 || lower.length !== text.length) return [document.createTextNode(text)]
  const hit = new Uint8Array(text.length)
  for (const term of terms) {
    for (let at = lower.indexOf(term); at >= 0; at = lower.indexOf(term, at + term.length)) {
      hit.fill(1, at, at + term.length)
    }
  }
  const nodes: Node[] = []
  let start = 0
  for (let i = 1; i <= text.length; i += 1) {
    if (i < text.length && hit[i] === hit[start]) continue
    const part = text.slice(start, i)
    nodes.push(hit[start] === 1 ? el('mark', '', part) : document.createTextNode(part))
    start = i
  }
  return nodes
}

const rowOf = (i: number, mod: Mod, terms: readonly string[]): HTMLLIElement => {
  const name = el('span', 'name')
  name.append(...marked(mod.name, terms))
  const repo = el('span', 'repo')
  repo.append(...marked(mod.repo, terms))
  const head = el('span', 'head')
  head.append(name, repo)
  const project = isProjectMod(mod)
  if (project) head.append(el('span', 'tag', 'Project mod'))
  if (mod.plugin === undefined) head.append(el('span', 'tag', 'Clone'))
  if (mod.check !== 0) head.append(el('span', 'tag', CHECK_SHORT[mod.check]))
  const badges = el('span', 'badges')
  for (const badge of badgesOf(mod)) {
    const node = el('span', 'badge', badge.short)
    node.title = badge.full
    badges.append(node)
  }
  const notables = notablesOf(mod)
  if (notables.length > 0) {
    const node = el('span', 'badge notable')
    node.append(icon('diamond'), `${notables.length} notable`)
    badges.append(node)
  }
  const stars = el('span', 'stars')
  stars.append(icon('star'), shortCount(mod.stars), el('span', 'vh', ' stars'))
  const meta = el('span', 'meta')
  meta.append(badges, stars)
  head.append(meta)

  const desc = el('span', 'desc')
  desc.append(...marked(mod.description, terms))
  const summary = el('summary')
  summary.append(head, desc)

  const what = el('div')
  what.append(el('p', 'label', 'What it can reach'))
  const reaches = reachesOf(mod)
  if (reaches.length > 0) {
    const ul = el('ul', 'reach')
    ul.append(...reaches.map(label => el('li', '', label)))
    what.append(ul)
  } else what.append(el('p', 'quiet', 'Nothing that validate reports.'))
  if (notables.length > 0) {
    const ul = el('ul', 'notables')
    for (const text of notables) {
      const li = el('li')
      li.append(icon('diamond'), text)
      ul.append(li)
    }
    what.append(el('p', 'label', 'Notable'), ul)
  }

  const how = el('div')
  const cmd = el('pre', 'cmd')
  const code = el('code', '', installLineOf(mod))
  code.dataset.copyText = ''
  cmd.append(code)
  const link = el('a', '', 'Open on GitHub')
  link.href = linkOf(mod)
  const facts = el('p', 'facts', `${CHECK_TEXT[mod.check]} · last push ${dayText(mod.pushed)} · `)
  facts.append(link)
  how.append(
    el('p', 'label', mod.plugin === undefined ? 'Load it from a clone' : 'Install'),
    cmd,
    el('p', 'quiet', installNoteOf(mod)),
  )
  if (project) how.append(el('p', 'quiet', projectNoteOf(mod)))
  const share = el('button', 'btn share js-only')
  share.type = 'button'
  share.dataset.copy = ''
  share.dataset.copyLink = ''
  share.setAttribute('aria-label', `Copy link to ${mod.name}`)
  share.append(icon('link'), el('span', '', 'Copy link'))
  how.append(facts, share)
  const detail = el('div', 'detail')
  detail.append(what, how)

  const details = el('details')
  details.setAttribute('name', 'mod')
  details.append(summary, detail)

  const copy = el('button', 'btn copy js-only')
  copy.type = 'button'
  copy.dataset.copy = ''
  copy.setAttribute('aria-label', `Copy the install line for ${mod.name}`)
  copy.append(icon('copy'), el('span', '', 'Copy'))
  const gh = el('a', 'btn gh')
  gh.href = linkOf(mod)
  gh.setAttribute('aria-label', `${mod.name} on GitHub`)
  gh.append(icon('github'))
  const acts = el('div', 'acts')
  acts.append(copy, gh)

  const li = el('li', 'mod')
  li.dataset.copyScope = ''
  li.dataset.i = String(i)
  li.dataset.key = sourceOf(mod)
  li.append(details, acts)
  return li
}

// --- Pages, as index.astro writes them --------------------------------------

const pageLink = (n: number, text: string, current = false): HTMLElement => {
  const link = el('a', 'pg', text)
  link.href = urlOf({ ...state, page: n })
  link.dataset.page = String(n)
  if (current) link.setAttribute('aria-current', 'page')
  return link
}

const step = (n: number, text: string, label: string, enabled: boolean): HTMLElement => {
  if (!enabled) {
    const node = el('span', 'pg', text)
    node.setAttribute('aria-disabled', 'true')
    return node
  }
  const link = pageLink(n, text)
  link.setAttribute('aria-label', label)
  return link
}

const renderPager = (page: Page): void => {
  const pages = find<HTMLElement>('#pager .pages')
  pages.replaceChildren(
    step(page.page - 1, 'Prev', 'Previous page', page.page > 1),
    ...pageLinks(page.page, page.pages).map(n =>
      n === 0 ? el('span', 'gap', '…') : pageLink(n, String(n), n === page.page),
    ),
    step(page.page + 1, 'Next', 'Next page', page.page < page.pages),
  )
  find<HTMLElement>('#pager .range').textContent = rangeText(page)
  pager.hidden = page.total === 0
}

const renderEmpty = (): HTMLLIElement => {
  const li = el('li', 'empty')
  li.append(
    el(
      'p',
      '',
      `No mods match${state.q.trim() === '' ? ' these filters' : ` “${state.q.trim()}”`}.`,
    ),
  )
  if (state.filters.length > 0) {
    const clear = el('button', 'btn', 'Clear the filters')
    clear.type = 'button'
    clear.addEventListener('click', () => {
      for (const chip of chips) chip.checked = false
      state.filters = []
      state.page = 1
      update()
    })
    li.append(clear)
  }
  return li
}

// --- The datasheet, as components/Datasheet.astro writes it -----------------

const wide = matchMedia('(min-width: 68.75rem)')
const sheet = document.getElementById('sheet')
const part = <T extends HTMLElement = HTMLElement>(id: string): T => find<T>(`#sheet-${id}`)
const sheetParts =
  sheet === null
    ? undefined
    : {
        name: part('name'),
        repo: part<HTMLAnchorElement>('repo'),
        desc: part('desc'),
        pins: part('pins'),
        notable: part('notable'),
        check: part('check'),
        stars: part('stars'),
        pushed: part('pushed'),
        from: part('from'),
        how: part('how'),
        install: part('install'),
        note: part('note'),
        project: part('project'),
        copy: part('copy'),
        gh: part<HTMLAnchorElement>('gh'),
        link: part('link'),
      }

const fillSheet = (mod: Mod): void => {
  if (sheetParts === undefined) return
  const parts = sheetParts
  parts.name.textContent = mod.name
  parts.repo.textContent = sourceOf(mod)
  parts.repo.href = linkOf(mod)
  parts.desc.textContent = mod.description
  pinsOf(mod).forEach((pin, n) => {
    const li = parts.pins.children[n]
    li?.classList.toggle('on', pin.on)
    if (li?.lastElementChild) li.lastElementChild.textContent = pin.on ? ': yes' : ': no'
  })
  const notables = notablesOf(mod)
  parts.notable.replaceChildren(
    ...(notables.length === 0
      ? [el('li', 'none', 'Nothing notable')]
      : notables.map(text => {
          const li = el('li')
          li.append(icon('diamond'), text)
          return li
        })),
  )
  parts.check.textContent = CHECK_SHORT[mod.check]
  parts.stars.textContent = countText(mod.stars)
  parts.pushed.textContent = dayText(mod.pushed)
  parts.from.textContent = mod.plugin === undefined ? 'From a clone' : 'From its marketplace'
  parts.how.textContent = mod.plugin === undefined ? 'Load it from a clone' : 'Install'
  parts.install.replaceChildren(
    ...flagParts(installLineOf(mod)).flatMap((part, n) => [
      ...(n === 0 ? [] : [' ']),
      el('span', 'keep', part),
    ]),
  )
  parts.note.textContent = installNoteOf(mod)
  parts.project.hidden = !isProjectMod(mod)
  parts.project.textContent = projectNoteOf(mod)
  parts.copy.setAttribute('aria-label', `Copy the install line for ${mod.name}`)
  parts.gh.href = linkOf(mod)
  parts.gh.setAttribute('aria-label', `${mod.name} on GitHub`)
  parts.link.setAttribute('aria-label', `Copy link to ${mod.name}`)
}

/** The row the datasheet shows: the first of a page until another is chosen.
 *  Selection follows focus, so it goes unannounced; the class is for the eye.
 *  The datasheet swaps at once, as a list's detail pane does. */
let selected = list.querySelector<HTMLLIElement>('li.mod.sel') ?? undefined
/** Settles true once the datasheet shows the selected row's mod. */
let shown = Promise.resolve(true)

/** Select a row; one a person `chose` is the mod the URL names. */
const select = (row: HTMLLIElement, chose: boolean): void => {
  if (chose && row.dataset.key !== undefined && row.dataset.key !== state.mod) {
    state.mod = row.dataset.key
    writeUrl()
  }
  if (row === selected) return
  selected?.classList.remove('sel')
  selected = row
  row.classList.add('sel')
  const i = Number(row.dataset.i)
  // Before the index has loaded, the prerendered page's rows wait for it.
  shown = (index === undefined ? load() : Promise.resolve(index)).then(
    ready => {
      const mod = ready.mods[i]
      if (selected !== row || mod === undefined) return false
      fillSheet(mod)
      return true
    },
    () => false,
  )
}

// --- Loading and searching ---------------------------------------------------

let index: Index | undefined
/** The last page of the results shown; unknown until a search has run here. */
let lastPage = Number.POSITIVE_INFINITY
let loading: Promise<Index> | undefined

const load = (): Promise<Index> => {
  loading ??= fetch(DATA_URL)
    .then(response => {
      if (!response.ok) throw new Error(`mods.json answered ${response.status}`)
      return response.json() as Promise<Data>
    })
    .then(data => {
      index = indexOf(data.rows.map(toMod))
      return index
    })
  loading.catch(() => {
    loading = undefined
  })
  return loading
}

const firstSummary = (): HTMLElement | null => list.querySelector('summary')

const rowByKey = (key: string): HTMLLIElement | null =>
  key === '' ? null : list.querySelector<HTMLLIElement>(`li.mod[data-key="${CSS.escape(key)}"]`)

/**
 * The page that holds the mod a `?mod=` link names. A mod the search or the
 * filters leave out clears them, so the link still shows it; one the index
 * doesn't have is ignored.
 */
const locate = (ready: Index): void => {
  const i = findMod(ready.mods, state.mod)
  if (i === undefined) {
    state.mod = ''
    return
  }
  state.mod = sourceOf(ready.mods[i] as Mod)
  let place = search(ready, queryOf(state)).indexOf(i)
  if (place < 0) {
    state.q = ''
    state.filters = []
    showState()
    place = search(ready, queryOf(state)).indexOf(i)
  }
  state.page = pageContaining(place, state.per)
}

type Show = {
  /** Focus the first row, as turning the page does. */
  focus?: boolean
  /** Find the mod the URL names first, and open it. */
  locate?: boolean
  /** Keep this mod's row where it was on screen, `top` pixels from the viewport's top. */
  keep?: { key: string; top: number }
}

/** Set while render moves focus, which selects a row nobody chose. */
let rendering = false

const render = (ready: Index, show: Show): void => {
  if (show.locate === true) locate(ready)
  const page = pageOf(search(ready, queryOf(state)), state.page, state.per)
  state.page = page.page
  lastPage = page.pages
  const terms = words(state.q)
  list.replaceChildren(
    ...(page.total === 0
      ? [renderEmpty()]
      : page.items.map(i => rowOf(i, ready.mods[i] as Mod, terms))),
  )
  selected = undefined
  if (sheet !== null) sheet.hidden = page.total === 0
  // The chosen mod stays selected while it is on the page; else the first is.
  const chosen = rowByKey(state.mod)
  if (chosen === null) state.mod = ''
  const top = chosen ?? list.querySelector<HTMLLIElement>('li.mod')
  if (top !== null) select(top, false)
  count.textContent = rangeText(page)
  renderPager(page)
  clearTimeout(urlTimer)
  history.replaceState(null, '', urlOf(state))
  const linked = show.locate === true ? rowByKey(state.mod) : null
  if (linked !== null) {
    // A narrow screen has no datasheet: the linked mod's row opens instead.
    const details = linked.querySelector('details')
    if (!wide.matches && details !== null) details.open = true
    linked.scrollIntoView({ block: 'nearest' })
    // The keys start from the linked mod, not the search at the top.
    rendering = true
    linked.querySelector('summary')?.focus({ preventScroll: true })
    rendering = false
  }
  const kept = rowByKey(show.keep?.key ?? '')
  if (kept !== null && show.keep !== undefined) {
    window.scrollBy(0, kept.getBoundingClientRect().top - show.keep.top)
  }
  if (show.focus !== true) return
  const head = find<HTMLElement>('#results-head')
  if (head.getBoundingClientRect().top < 0) head.scrollIntoView({ block: 'start' })
  rendering = true
  firstSummary()?.focus({ preventScroll: true })
  rendering = false
}

let queued: Show | undefined

/** Show the state: at once when the index is here, else once it arrives. */
const update = (show: Show = {}): void => {
  if (index !== undefined) {
    render(index, show)
    return
  }
  history.replaceState(null, '', urlOf(state))
  if (queued !== undefined) {
    const keep = show.keep ?? queued.keep
    queued = {
      focus: queued.focus === true || show.focus === true,
      locate: queued.locate === true || show.locate === true,
      ...(keep === undefined ? {} : { keep }),
    }
    return
  }
  queued = show
  count.textContent = 'Loading the index…'
  load().then(
    ready => {
      const wanted = queued ?? {}
      queued = undefined
      render(ready, wanted)
    },
    (error: Error) => {
      queued = undefined
      count.textContent = `The index didn't load (${error.message}). The most-starred mods are below; try again in a moment.`
    },
  )
}

// --- Controls ------------------------------------------------------------------

input.addEventListener('input', () => {
  state.q = input.value
  state.page = 1
  update()
})

sortMenu.addEventListener('change', () => {
  state.sort = isSort(sortMenu.value) ? sortMenu.value : 'relevance'
  state.page = 1
  update()
})

// A new page size goes to the page holding the first result in view, and keeps it there.
perMenu.addEventListener('change', () => {
  const per = PAGE_SIZES.find(size => String(size) === perMenu.value) ?? PAGE_SIZE
  const rows = [...list.querySelectorAll<HTMLLIElement>('li.mod')]
  const inView = rows.findIndex(row => row.getBoundingClientRect().bottom > 0)
  const at = inView < 0 ? rows.length - 1 : inView
  const anchor = rows[at]
  state.page = pageContaining((state.page - 1) * state.per + Math.max(0, at), per)
  state.per = per
  update(
    anchor?.dataset.key === undefined
      ? {}
      : { keep: { key: anchor.dataset.key, top: anchor.getBoundingClientRect().top } },
  )
})

for (const chip of chips) {
  chip.addEventListener('change', () => {
    state.filters = chips.filter(item => item.checked).map(item => item.value)
    state.page = 1
    update()
  })
}

const openFirst = (): void => {
  const summary = firstSummary()
  if (summary === null) return
  const details = summary.parentElement
  // A wide screen shows it in the datasheet, as focusing the row selects it.
  if (details instanceof HTMLDetailsElement && !wide.matches) details.open = true
  summary.focus()
}

// Enter in the search opens the first result.
form.addEventListener('submit', event => {
  event.preventDefault()
  if (index === undefined && !isDefault())
    load().then(
      () => setTimeout(openFirst),
      () => {},
    )
  else openFirst()
})

const goTo = (page: number): void => {
  if (page < 1 || page > lastPage || page === state.page) return
  state.page = page
  update({ focus: true })
}

pager.addEventListener('click', event => {
  const link = (event.target as Element).closest<HTMLAnchorElement>('a[data-page]')
  if (link === null) return
  event.preventDefault()
  goTo(Number(link.dataset.page))
})

// ↑ and ↓ move between results, and from the search into them.
const summaries = (): HTMLElement[] => [...list.querySelectorAll<HTMLElement>('summary')]

input.addEventListener('keydown', event => {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    firstSummary()?.focus()
  } else if (event.key === 'Escape' && input.value !== '') {
    event.preventDefault()
    input.value = ''
    state.q = ''
    state.page = 1
    update()
  }
})

list.addEventListener('keydown', event => {
  const target = event.target as Element
  if (event.key === 'PageDown' || event.key === 'PageUp') {
    event.preventDefault()
    goTo(state.page + (event.key === 'PageDown' ? 1 : -1))
    return
  }
  if (target.tagName !== 'SUMMARY') return
  // On a wide screen Enter copies the selected mod's install line, as the datasheet's Copy does.
  if (event.key === 'Enter' && wide.matches && sheetParts !== undefined) {
    event.preventDefault()
    const { copy } = sheetParts
    shown.then(ok => ok && copy.click())
    return
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  const all = summaries()
  const at = all.indexOf(target as HTMLElement) + (event.key === 'ArrowDown' ? 1 : -1)
  if (at < 0) input.focus()
  else all[at]?.focus()
})

const rowAt = (target: EventTarget | null): HTMLLIElement | null =>
  target instanceof Element ? target.closest<HTMLLIElement>('li.mod') : null

// Focus, a click or a tap selects a row. On a wide screen the datasheet shows
// it, so the row doesn't open as well.
list.addEventListener('focusin', event => {
  const row = rowAt(event.target)
  if (row !== null) select(row, !rendering)
})

list.addEventListener('click', event => {
  const row = rowAt(event.target)
  if (row === null) return
  if (wide.matches && (event.target as Element).closest('summary') !== null) event.preventDefault()
  select(row, true)
})

// A mouse on a row selects it at once. Only a pointer heading right, toward the
// datasheet, waits a moment, so crossing rows on the way there doesn't swap it.
// Only the pointer moving counts: rows scrolling under a still pointer change nothing.
let hovered: HTMLLIElement | null = null
let intent = 0
list.addEventListener('pointermove', event => {
  if (event.pointerType !== 'mouse' || !wide.matches) return
  const row = rowAt(event.target)
  if (row === hovered) return
  hovered = row
  clearTimeout(intent)
  if (row === null) return
  const towardSheet = event.movementX > 0 && event.movementX > 2 * Math.abs(event.movementY)
  // A pointer passing over previews a mod; only a click or the keys choose it for the URL.
  if (towardSheet) intent = window.setTimeout(() => select(row, false), 80)
  else select(row, false)
})
list.addEventListener('pointerleave', () => {
  hovered = null
  clearTimeout(intent)
})

// Escape in the datasheet goes back to the row it shows.
sheet?.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return
  event.preventDefault()
  selected?.querySelector('summary')?.focus()
})

// Widening the window hands an open row over to the datasheet.
wide.addEventListener('change', () => {
  if (!wide.matches) return
  for (const details of list.querySelectorAll('details[open]')) {
    if (details instanceof HTMLDetailsElement) details.open = false
  }
})

const typing = (target: EventTarget | null): boolean =>
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLInputElement && target.type !== 'checkbox' && target.type !== 'radio') ||
  (target instanceof HTMLElement && target.isContentEditable)

// "/" and ⌘K (Ctrl K) find the search; [ and ] turn the page.
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    input.focus()
    input.select()
    return
  }
  if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return
  if (event.key === '/') {
    event.preventDefault()
    input.focus()
    input.select()
  } else if (event.key === ']' || event.key === '[') {
    event.preventDefault()
    goTo(state.page + (event.key === ']' ? 1 : -1))
  }
})

// --- Copy -----------------------------------------------------------------------

const timers = new WeakMap<HTMLElement, number>()

document.addEventListener('click', async event => {
  const button = (event.target as Element).closest<HTMLButtonElement>('button[data-copy]')
  if (button === null) return
  // A link names the row it sits in, or the datasheet's mod.
  const linked = button.closest<HTMLLIElement>('li.mod') ?? selected
  const text =
    button.dataset.copyLink !== undefined
      ? linkTo(linked?.dataset.key ?? '')
      : button.dataset.copy ||
        button.closest('[data-copy-scope]')?.querySelector('[data-copy-text]')?.textContent ||
        ''
  const label = button.querySelector('span')
  if (label !== null) label.dataset.idle ??= label.textContent ?? ''
  let said = 'Copied'
  try {
    await navigator.clipboard.writeText(text)
    button.dataset.state = 'copied'
    status.textContent = `Copied: ${text}`
  } catch {
    said = 'Select it'
    status.textContent = "Couldn't copy: select the line and copy it."
  }
  if (label !== null) label.textContent = said
  clearTimeout(timers.get(button))
  timers.set(
    button,
    window.setTimeout(() => {
      delete button.dataset.state
      if (label !== null) label.textContent = label.dataset.idle ?? 'Copy'
    }, 1600),
  )
})

// The page names Ctrl K; a Mac's is ⌘K.
if (/Mac|iPhone|iPad/.test(navigator.platform)) find<HTMLElement>('#mod-k').textContent = '⌘K'

// --- Start ---------------------------------------------------------------------

if (!isDefault()) {
  // The URL asked for a search or a mod: show it in the controls, and run it.
  showState()
  update({ locate: state.mod !== '' })
} else if (
  input.value !== '' ||
  sortMenu.value !== 'relevance' ||
  perMenu.value !== String(PAGE_SIZE) ||
  chips.some(c => c.checked)
) {
  // Typed before this ran, or restored by the browser on the way back.
  state.q = input.value
  state.sort = isSort(sortMenu.value) ? sortMenu.value : 'relevance'
  state.per = PAGE_SIZES.find(size => String(size) === perMenu.value) ?? PAGE_SIZE
  state.filters = chips.filter(chip => chip.checked).map(chip => chip.value)
  update()
} else {
  // The data waits for a sign of use, after the page has loaded.
  const start = (): void => {
    for (const type of ['pointermove', 'pointerdown', 'keydown', 'focusin'] as const) {
      addEventListener(type, () => void load().catch(() => {}), { once: true, passive: true })
    }
  }
  if (document.readyState === 'complete') start()
  else addEventListener('load', start, { once: true })
}
