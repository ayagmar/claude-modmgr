// The page's search in the browser. The first page of results arrives
// prerendered, so nothing here runs until someone uses it: mods.json loads on
// the first sign of use after the page has loaded (or at once when the URL
// asks for a search), is parsed and indexed once, and every keystroke searches
// it in memory. Only one page of rows is ever in the DOM, and rows are built
// with DOM APIs and textContent: descriptions are untrusted text. On a wide
// screen the selected row's mod fills the datasheet beside the list.
import {
  badgesOf,
  CHECK_SHORT,
  CHECK_TEXT,
  countText,
  dayText,
  FILTERS,
  flagParts,
  installNoteOf,
  notablesOf,
  PAGE_SIZE,
  pinsOf,
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
  SORTS,
  type Sort,
  search,
  shortCount,
  toMod,
  words,
} from '../lib/search.ts'

const DATA_URL = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/mods.json`

const find = <T extends Element>(selector: string): T => {
  const found = document.querySelector<T>(selector)
  if (found === null) throw new Error(`the page has no ${selector}`)
  return found
}

const form = find<HTMLFormElement>('#search')
const input = find<HTMLInputElement>('#q')
const sortMenu = find<HTMLSelectElement>('#sort')
const chips = [...document.querySelectorAll<HTMLInputElement>('input[name="f"]')]
const list = find<HTMLOListElement>('#results')
const count = find<HTMLElement>('#count')
const pager = find<HTMLElement>('#pager')
const status = find<HTMLElement>('#status')

type State = { q: string; sort: Sort; page: number; filters: string[] }

const isSort = (value: string | null): value is Sort => SORTS.some(sort => sort === value)
const isFilter = (id: string): boolean => FILTERS.some(filter => filter.id === id)

const fromUrl = (): State => {
  const params = new URLSearchParams(location.search)
  const sort = params.get('sort')
  return {
    q: params.get('q') ?? '',
    sort: isSort(sort) ? sort : 'relevance',
    page: Number(params.get('page')) || 1,
    filters: (params.get('f') ?? '').split(',').filter(isFilter),
  }
}

const urlOf = (state: State): string => {
  const params = new URLSearchParams()
  if (state.q.trim() !== '') params.set('q', state.q.trim())
  if (state.sort !== 'relevance') params.set('sort', state.sort)
  if (state.filters.length > 0) params.set('f', state.filters.join(','))
  if (state.page > 1) params.set('page', String(state.page))
  const search = params.toString()
  return search === '' ? location.pathname : `${location.pathname}?${search}`
}

const queryOf = (state: State): Query =>
  Object.assign(
    { text: state.q, sort: state.sort },
    ...FILTERS.filter(filter => state.filters.includes(filter.id)).map(filter => filter.query),
  )

const state = fromUrl()
const isDefault = (): boolean => urlOf(state) === location.pathname

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
    facts,
  )
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
        copy: part('copy'),
        gh: part<HTMLAnchorElement>('gh'),
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
  parts.copy.setAttribute('aria-label', `Copy the install line for ${mod.name}`)
  parts.gh.href = linkOf(mod)
}

/** The row the datasheet shows: the first of a page until another is chosen.
 *  Selection follows focus, so it goes unannounced; the class is for the eye.
 *  The datasheet swaps at once, as a list's detail pane does. */
let selected = list.querySelector<HTMLLIElement>('li.mod.sel') ?? undefined
/** Settles true once the datasheet shows the selected row's mod. */
let shown = Promise.resolve(true)

const select = (row: HTMLLIElement): void => {
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

const render = (ready: Index, focus: boolean): void => {
  const page = pageOf(search(ready, queryOf(state)), state.page, PAGE_SIZE)
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
  const top = list.querySelector<HTMLLIElement>('li.mod')
  if (top !== null) select(top)
  count.textContent = rangeText(page)
  renderPager(page)
  history.replaceState(null, '', urlOf(state))
  if (!focus) return
  const head = find<HTMLElement>('#results-head')
  if (head.getBoundingClientRect().top < 0) head.scrollIntoView({ block: 'start' })
  firstSummary()?.focus({ preventScroll: true })
}

let queued: { focus: boolean } | undefined

/** Show the state: at once when the index is here, else once it arrives. */
const update = (focus = false): void => {
  if (index !== undefined) {
    render(index, focus)
    return
  }
  history.replaceState(null, '', urlOf(state))
  if (queued !== undefined) {
    queued.focus ||= focus
    return
  }
  queued = { focus }
  count.textContent = 'Loading the index…'
  load().then(
    ready => {
      const wanted = queued ?? { focus: false }
      queued = undefined
      render(ready, wanted.focus)
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
  update(true)
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
  if (row !== null) select(row)
})

list.addEventListener('click', event => {
  const row = rowAt(event.target)
  if (row === null) return
  if (wide.matches && (event.target as Element).closest('summary') !== null) event.preventDefault()
  select(row)
})

// A mouse resting on a row selects it after a moment, so sweeping across the
// list to the datasheet doesn't flick through every row on the way. Only the
// pointer moving counts: rows scrolling under a still pointer change nothing.
let hovered: HTMLLIElement | null = null
let intent = 0
list.addEventListener('pointermove', event => {
  if (event.pointerType !== 'mouse' || !wide.matches) return
  const row = rowAt(event.target)
  if (row === hovered) return
  hovered = row
  clearTimeout(intent)
  if (row !== null) intent = window.setTimeout(() => select(row), 120)
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
  const text =
    button.dataset.copy ||
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
  // The URL asked for a search: show it in the controls, and run it.
  input.value = state.q
  sortMenu.value = state.sort
  for (const chip of chips) chip.checked = state.filters.includes(chip.value)
  update()
} else if (input.value !== '' || sortMenu.value !== 'relevance' || chips.some(c => c.checked)) {
  // Typed before this ran, or restored by the browser on the way back.
  state.q = input.value
  state.sort = isSort(sortMenu.value) ? sortMenu.value : 'relevance'
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
