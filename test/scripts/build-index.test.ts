// The index build (scripts/build-index.ts) on the captured catalogue, its
// network faked: what it publishes, what it refuses, and its retries. CI runs
// it here on every push; the scheduled workflow runs it for real.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseIndex } from '../../plugin/hooks/domain/catalog-index.ts'
import { parseAvailable } from '../../plugin/hooks/domain/cli-results.ts'
import { type FetchedFile, MAX_BODY, planProbe } from '../../plugin/hooks/domain/detector.ts'
import { type BuildDeps, buildIndex, fetchFile, MARKETPLACES } from '../../scripts/build-index.ts'
import { runs } from '../domain/fixtures/cli-runs.ts'

const AWS = 'aws-serverless@claude-plugins-official'

const catalogue = (() => {
  const parsed = parseAvailable(runs['list-available'])
  if (!parsed.ok) throw new Error(parsed.error.message)
  return parsed.value.available.items
})()

const remote = catalogue.filter(entry => planProbe(entry).kind === 'remote')
const baseOf = (id: string): string => {
  const plan = planProbe(
    catalogue.find(entry => entry.id === id) ?? { source: { kind: 'other', type: '' } },
  )
  if (plan.kind !== 'remote') throw new Error(`${id} isn't remote`)
  return plan.base
}

/** Every remote entry plain (no hooks.json, a manifest without hooks), AWS a mod. */
const plainWorld = (url: string): FetchedFile => {
  if (url === `${baseOf(AWS)}hooks/hooks.json`)
    return { status: 200, text: '{"modules":["./r.ts"]}' }
  if (url.endsWith('hooks/hooks.json')) return { status: 404 }
  return { status: 200, text: '{"name":"x"}' }
}

const deps = (fetch: (url: string) => FetchedFile, more: Partial<BuildDeps> = {}) => {
  const calls: string[][] = []
  const sleeps: number[] = []
  const built: BuildDeps = {
    cli: args => {
      calls.push([...args])
      if (args[1] === 'marketplace' && args[2] === 'add')
        return { exitCode: 0, stdout: '', stderr: '' }
      if (args.join(' ') === 'plugin list --json --available') return runs['list-available']
      return { exitCode: 1, stdout: '', stderr: 'unexpected' }
    },
    fetch: async url => fetch(url),
    now: () => 1_000,
    sleep: async ms => {
      sleeps.push(ms)
    },
    log: () => {},
    ...more,
  }
  return { built, calls, sleeps }
}

describe('the index build', () => {
  it('adds the official marketplace and publishes every remote entry, as clients read it', async () => {
    const { built, calls } = deps(plainWorld)
    const result = await buildIndex(built)
    expect(calls[0]).toEqual(['plugin', 'marketplace', 'add', ...MARKETPLACES])
    if (!('text' in result)) throw new Error(result.refused)
    const index = parseIndex(result.text)
    if (!index.ok) throw new Error(index.error.message)
    expect(index.value.entries[AWS]?.[1]).toBe('mod')
    // Remote entries only: a local one is read by each client from its clone.
    const ids = Object.keys(index.value.entries)
    expect(ids.length).toBe(remote.length)
    expect(ids.every(id => remote.some(entry => entry.id === id))).toBe(true)
    expect(
      Object.values(index.value.entries).every(([, kind]) => kind === 'plain' || kind === 'mod'),
    ).toBe(true)
  })

  it('refuses to publish when too much is left unclassified (unknown counts)', async () => {
    const { built } = deps(() => ({ status: 200, text: 'not json' }))
    expect(await buildIndex(built)).toEqual({
      refused: expect.stringMatching(/^too much left unclassified/),
    })
  })

  it('waits after a 429 and asks again', async () => {
    let limited = true
    const { built, sleeps } = deps(url => {
      if (limited && url.endsWith('hooks/hooks.json')) {
        limited = false
        return { status: 429 }
      }
      return plainWorld(url)
    })
    const result = await buildIndex(built)
    expect('text' in result).toBe(true)
    expect(sleeps.length).toBeGreaterThan(0)
  })

  it('stops when the CLI can’t add the marketplace', async () => {
    const { built } = deps(plainWorld, {
      cli: () => ({ exitCode: 1, stdout: '', stderr: 'no network' }),
    })
    await expect(buildIndex(built)).rejects.toThrow('no network')
  })
})

describe('a catalogue file’s GET', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const answering = (status: number, text: string) => {
    const seen: RequestInit[] = []
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      seen.push(init)
      return new Response(status === 416 ? 'range not satisfiable' : text, { status })
    })
    return seen
  }

  it('asks for a byte range and reads a 206 as found', async () => {
    const seen = answering(206, '{"modules":[]}')
    expect(await fetchFile('https://raw.githubusercontent.com/x')).toEqual({
      status: 200,
      text: '{"modules":[]}',
    })
    expect(new Headers(seen[0]?.headers).get('Range')).toBe(`bytes=0-${MAX_BODY}`)
  })

  it('reads an empty file (416), drops a body past the cap, and says 503 when the fetch fails', async () => {
    answering(416, '')
    expect(await fetchFile('https://x/empty')).toEqual({ status: 200, text: '' })
    answering(200, 'x'.repeat(MAX_BODY + 1))
    expect(await fetchFile('https://x/long')).toEqual({ status: 200 })
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline')
    })
    expect(await fetchFile('https://x/down')).toEqual({ status: 503 })
  })
})
