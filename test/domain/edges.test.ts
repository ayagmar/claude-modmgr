// Fallback branches the main suites don't reach.
import { describe, expect, it } from 'vitest'
import { reachOfCall } from '../../plugin/hooks/domain/capabilities.ts'
import {
  parseAvailable,
  parseMarketplaces,
  parseOpResult,
} from '../../plugin/hooks/domain/cli-results.ts'
import { retry } from '../../plugin/hooks/domain/jobs.ts'
import { helpFor } from '../../plugin/hooks/domain/keymap.ts'

const run = (stdout: string, exitCode = 0) => ({ stdout, exitCode, stderr: '' })

describe('edges', () => {
  it('reaches display for a call with no noun', () => {
    expect(reachOfCall('')).toBe('display')
  })

  it('passes CLI failures through every list parser', () => {
    expect(parseAvailable(run('x', 2)).ok).toBe(false)
    expect(parseMarketplaces(run('x', 2)).ok).toBe(false)
  })

  it('names a rejected acceptance with no message', () => {
    const line = JSON.stringify({
      command: 'install',
      outcome: 'failed',
      shownCommand: {
        kind: 'command_source',
        pluginId: 'a@b',
        command: 'c',
        catalogRevision: 'r',
        sha256: 'a'.repeat(64),
        acceptCommandMatched: true,
      },
    })
    expect(parseOpResult(run(line, 1))).toMatchObject({
      ok: false,
      error: { kind: 'rejected', message: 'the declared command was not accepted' },
    })
  })

  it('retries a bare job without target or args', () => {
    const jobs = retry(
      [{ id: 'a', kind: 'marketplace-update', state: 'failed', tail: [] }],
      'a',
      'b',
    )
    expect(jobs[1]).toEqual({ id: 'b', kind: 'marketplace-update', state: 'queued', tail: [] })
  })

  it('returns no help for an unknown surface set', () => {
    expect(helpFor([])).toEqual([])
  })
})
