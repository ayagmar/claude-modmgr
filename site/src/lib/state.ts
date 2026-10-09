// What the page's URL keeps: the search, its sort and filters, the page and
// its size, and the mod a link names. Pure, so scripts/store.ts reads and
// writes it the same way the tests do. Every default is left out, so the
// page's own address is the default state.
import { FILTERS, PAGE_SIZE, PAGE_SIZES, type PageSize } from './present.ts'
import { SORTS, type Sort } from './search.ts'

export type State = {
  q: string
  sort: Sort
  /** 1-based; clamped to the results when they are shown. */
  page: number
  per: PageSize
  /** FILTERS ids. */
  filters: string[]
  /** The chosen mod's `owner/repo[/path]`, or '' when none was chosen. */
  mod: string
}

export const isSort = (value: string | null): value is Sort => SORTS.some(sort => sort === value)
const isFilter = (id: string): boolean => FILTERS.some(filter => filter.id === id)

/** The state a URL's query string asks for; what it can't use is left at the default. */
export const stateOf = (search: string): State => {
  const params = new URLSearchParams(search)
  const sort = params.get('sort')
  const per = PAGE_SIZES.find(size => String(size) === params.get('per'))
  return {
    q: params.get('q') ?? '',
    sort: isSort(sort) ? sort : 'relevance',
    page: Math.max(1, Math.floor(Number(params.get('page'))) || 1),
    per: per ?? PAGE_SIZE,
    filters: (params.get('f') ?? '').split(',').filter(isFilter),
    mod: params.get('mod') ?? '',
  }
}

/** The query string for a state, `?…`, or '' for the default one. */
export const searchOf = (state: State): string => {
  const params = new URLSearchParams()
  if (state.q.trim() !== '') params.set('q', state.q.trim())
  if (state.sort !== 'relevance') params.set('sort', state.sort)
  if (state.filters.length > 0) params.set('f', state.filters.join(','))
  if (state.per !== PAGE_SIZE) params.set('per', String(state.per))
  if (state.page > 1) params.set('page', String(state.page))
  if (state.mod !== '') params.set('mod', state.mod)
  // A slash is fine in a query, and `mod=owner/repo` reads as what it names.
  const search = params.toString().replace(/%2F/gi, '/')
  return search === '' ? '' : `?${search}`
}

/** The page of `size` results that holds the result at 0-based `place`. */
export const pageContaining = (place: number, size: number): number =>
  Math.floor(Math.max(0, place) / size) + 1
