// What the page's URL keeps (site/src/lib/state.ts): the search, its page and
// page size, and the mod a link names, read and written by scripts/store.ts.
import { describe, expect, it } from 'vitest'
import { pageContaining, type State, searchOf, stateOf } from '../../site/src/lib/state.ts'

const DEFAULT: State = {
  q: '',
  sort: 'relevance',
  page: 1,
  per: 20,
  filters: [],
  mod: '',
}

describe('the URL state', () => {
  it('leaves every default out, so the page address is the default state', () => {
    // Catches `per=20` or `page=1` written on every visit, which makes the
    // plain address look like a search and loads the index at once.
    expect(searchOf(DEFAULT)).toBe('')
    expect(stateOf('')).toEqual(DEFAULT)
  })

  it('round-trips a search, its page size and a chosen mod', () => {
    // Catches a page size or mod lost on the way back from the URL, so a
    // shared link opens another page than the one copied.
    const state: State = {
      q: 'band',
      sort: 'stars',
      page: 3,
      per: 100,
      filters: ['no-network'],
      mod: 'kunchenguid/firstmate/.claude/mods/firstmate-calm',
    }
    const search = searchOf(state)
    expect(search).toBe(
      '?q=band&sort=stars&f=no-network&per=100&page=3&mod=kunchenguid/firstmate/.claude/mods/firstmate-calm',
    )
    expect(stateOf(search)).toEqual(state)
  })

  it('reads a page size it does not offer, or a bad page, as the default', () => {
    // Catches `per=100000` putting every mod in the DOM, and `page=-2` or
    // `page=x` reaching the pager as a page that doesn't exist.
    expect(stateOf('?per=100000').per).toBe(20)
    expect(stateOf('?per=40').per).toBe(40)
    expect(stateOf('?page=-2').page).toBe(1)
    expect(stateOf('?page=x').page).toBe(1)
    expect(stateOf('?sort=evil&f=no-network,nope').sort).toBe('relevance')
    expect(stateOf('?f=no-network,nope').filters).toEqual(['no-network'])
  })

  it('finds the page that holds a result, at any page size', () => {
    // Catches an off-by-one that moves the first result in view to the page
    // before or after when the page size changes.
    expect(pageContaining(0, 20)).toBe(1)
    expect(pageContaining(19, 20)).toBe(1)
    expect(pageContaining(20, 20)).toBe(2)
    expect(pageContaining(40, 40)).toBe(2)
    expect(pageContaining(45, 100)).toBe(1)
    expect(pageContaining(-1, 20)).toBe(1)
  })
})
