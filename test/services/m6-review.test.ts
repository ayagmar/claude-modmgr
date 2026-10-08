// The Fable 5.1 review of M6 (docs/reviews/2026-10-08-fable-5.1-m6-review.md):
// one test per finding, each failing before its fix.
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../../plugin/hooks/domain/config.ts'
import { modsCommand } from '../../plugin/hooks/services/commands.ts'
import { background } from '../../plugin/hooks/services/lifecycle.ts'
import { createRuntime } from '../../plugin/hooks/services/runtime.ts'
import { runs } from '../domain/fixtures/cli-runs.ts'
import { fixtureCli } from './cli-world.ts'
import { FakeProcess, out, world } from './fakes.ts'

const SDK = 'agent-sdk-dev@claude-plugins-official'

const setup = async (store: Record<string, unknown> = {}) => {
  const w = world({ store })
  fixtureCli(w.process)
  const rt = createRuntime(w.ports, DEFAULT_CONFIG, 'own')
  w.state.values.queue = { owner: 'own', jobs: [] }
  await rt.store.load()
  return { w, rt }
}

describe('R-M6-1: a text write goes on the queue', () => {
  it('is refused beside a job queued or running, and a reload waiting', async () => {
    const { w, rt } = await setup()
    await rt.registry.refresh()
    for (const state of ['running', 'queued'] as const) {
      w.state.values.queue = {
        owner: 'own',
        jobs: [{ id: 'r', kind: state === 'running' ? 'enable' : 'reload', state, tail: [] }],
      }
      expect(await modsCommand(w.ports, rt, 'disable turn-band@fixtures --yes')).toEqual({
        text: 'A job is running (the job log, j in /mods, shows it); try again when it ends.',
        exitCode: 1,
      })
    }
    expect(w.process.calls.some(call => call.argv.includes('disable'))).toBe(false)
    w.state.values.queue = { owner: 'someone-else', jobs: [] }
    expect((await modsCommand(w.ports, rt, 'disable turn-band@fixtures --yes')).text).toMatch(
      /reloaded meanwhile/,
    )
  })

  it('is running on the queue while its CLI runs, on the hook’s own process port', async () => {
    const { w, rt } = await setup()
    await rt.registry.refresh()
    // The hook's own `$`: a second process port, apart from the runtime's.
    const hook = new FakeProcess(w.clock)
    fixtureCli(hook)
    let seen: string | undefined
    hook.when(['disable'], () => {
      seen = w.state.values.queue.jobs.at(-1)?.state
      return out(
        `${JSON.stringify({ command: 'disable', outcome: 'ok', plugin: 'turn-band@fixtures', pluginId: 'turn-band@fixtures', scope: 'user', message: 'disabled' })}\n`,
      )
    })
    const before = w.process.calls.length
    const answer = await modsCommand(
      { ...w.ports, process: hook },
      rt,
      'disable turn-band@fixtures --yes',
    )
    expect(answer.text).toContain('✓ disable turn-band@fixtures')
    expect(seen).toBe('running')
    expect(w.process.calls.slice(before).some(call => call.argv.includes('disable'))).toBe(false)
    expect(w.state.values.queue.jobs.at(-1)).toMatchObject({ kind: 'disable', state: 'ok' })
  })
})

describe('R-M6-2: a remembered tab costs nothing until the dialog shows it', () => {
  it('reads the catalogue when /mods opens on Discover, not at start', async () => {
    const { w, rt } = await setup({
      prefs: { v: 1, data: { tab: 'discover', sort: 'name', kind: 'mods', firstRunDone: true } },
    })
    w.process.when(['list', '--json', '--available'], out(runs['list-available'].stdout))
    w.process.when(['marketplace', 'list'], out(runs['marketplace-list'].stdout))
    const available = () => w.process.calls.filter(call => call.argv.includes('--available')).length
    await background(rt, { fresh: true })
    await w.clock.advance(10)
    expect(w.state.values.view.tab).toBe('discover')
    expect(available()).toBe(0)
    expect(await modsCommand(w.ports, rt, '')).toEqual({})
    await w.clock.advance(10)
    expect(available()).toBe(1)
  })
})

describe('R-M6-7: a text update of a repository-marketplace mod', () => {
  it('refreshes its marketplace first, then updates it', async () => {
    const { w, rt } = await setup()
    w.process
      .when(['list', '--json'], () => {
        const list = JSON.parse(runs.list.stdout) as unknown[]
        const sdk = {
          id: SDK,
          version: '1.0.0',
          scope: 'user',
          enabled: true,
          installPath: '/cache/sdk/turn-band',
        }
        return out(JSON.stringify([...list, sdk]))
      })
      .when(['marketplace', 'update'], argv =>
        out(
          `${JSON.stringify({ command: 'marketplace-update', outcome: 'ok', marketplace: argv[4], message: 'Updated' })}\n`,
        ),
      )
    await rt.registry.refresh()
    const answer = await modsCommand(w.ports, rt, `update ${SDK} --yes`)
    const writes = w.process.calls
      .map(call => call.argv.slice(2, 4).join(' '))
      .filter(argv => /update/.test(argv))
    expect(writes).toEqual(['marketplace update', `update ${SDK}`])
    expect(answer.text).toContain('✓ refresh marketplace claude-plugins-official')
    expect(answer.text).toContain(`✓ update ${SDK}`)
  })
})
