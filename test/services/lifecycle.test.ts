import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../../plugin/hooks/domain/config.ts'
import { probeAndRecord, probeCapabilities } from '../../plugin/hooks/services/capability-probe.ts'
import { onSessionStart } from '../../plugin/hooks/services/lifecycle.ts'
import { createRuntime, newOwnerId } from '../../plugin/hooks/services/runtime.ts'
import { fixtureCli } from './cli-world.ts'
import { fakeEnv, out, world } from './fakes.ts'

const runtimeFor = (w: ReturnType<typeof world>, owner = 'own1') =>
  createRuntime(w.ports, DEFAULT_CONFIG, owner)

describe('onSessionStart', () => {
  it('registers /mods, takes the queue over and defers the rest', async () => {
    const w = world()
    fixtureCli(w.process)
    w.state.values.queue = {
      owner: 'old',
      jobs: [{ id: 'old-1', kind: 'disable', state: 'running', tail: [] }],
    }
    const rt = runtimeFor(w)
    await onSessionStart(rt)
    expect(w.command.registered).toBe(1)
    expect(w.state.values.queue.owner).toBe('own1')
    expect(w.state.values.queue.jobs[0]?.state).toBe('interrupted')
    // Nothing else ran on the blocking path.
    expect(w.process.calls).toEqual([])
    await w.clock.advance(0)
    expect(w.state.values.mods).toHaveLength(5)
  })

  it('is idempotent for the same module', async () => {
    const w = world()
    fixtureCli(w.process)
    const rt = runtimeFor(w)
    await onSessionStart(rt)
    w.state.values.queue = {
      owner: 'own1',
      jobs: [{ id: 'own1-1', kind: 'disable', state: 'running', tail: [] }],
    }
    await onSessionStart(rt)
    expect(w.state.values.queue.jobs[0]?.state).toBe('running')
    expect(w.command.registered).toBe(2)
  })

  it('applies stored preferences on a fresh session only', async () => {
    const stored = {
      prefs: { v: 1, data: { tab: 'health', sort: 'installs', firstRunDone: true } },
    }
    const w = world({ store: stored })
    fixtureCli(w.process)
    await onSessionStart(runtimeFor(w))
    await w.clock.advance(0)
    expect(w.state.values.view).toMatchObject({ tab: 'health', sort: 'installs' })

    // A reloaded module keeps the view it finds.
    const again = world({ store: stored })
    fixtureCli(again.process)
    again.state.values.queue = { owner: 'old', jobs: [] }
    await onSessionStart(runtimeFor(again))
    await again.clock.advance(0)
    expect(again.state.values.view.tab).toBe('installed')
  })

  it('stays read-only when the CLI can not run', async () => {
    const w = world()
    w.process.on(() => ({ throws: 'spawn claude ENOENT' }))
    await onSessionStart(runtimeFor(w))
    await w.clock.advance(0)
    expect(w.state.values.degraded.process).toBe(true)
    expect(w.process.calls.map(call => call.argv.join(' '))).toEqual(['claude --version'])
  })

  it('logs a start-up failure instead of throwing', async () => {
    const w = world()
    fixtureCli(w.process)
    const rt = runtimeFor(w)
    await onSessionStart(rt)
    w.state.failWrites = true
    await w.clock.advance(0)
    expect(w.ui.lines.some(line => line.startsWith('modmgr: start-up failed'))).toBe(true)
  })

  it('runs jobs left queued by an earlier module', async () => {
    const w = world()
    fixtureCli(w.process)
    w.state.values.queue = {
      owner: 'old',
      jobs: [
        { id: 'old-1', kind: 'disable', target: 'turn-band@fixtures', state: 'queued', tail: [] },
      ],
    }
    const rt = runtimeFor(w)
    await onSessionStart(rt)
    await w.clock.advance(0)
    await rt.runner.whenIdle()
    expect(w.state.values.queue.jobs[0]?.state).toBe('ok')
  })
})

describe('runtime', () => {
  it('makes job ids unique per module and owner ids from randomness', () => {
    const w = world()
    const rt = runtimeFor(w, 'abc')
    expect([rt.newJobId(), rt.newJobId()]).toEqual(['abc-1', 'abc-2'])
    expect(newOwnerId(() => 0)).toBe('00000000')
    expect(newOwnerId(() => 0.5)).toHaveLength(8)
    expect(newOwnerId()).toMatch(/^[0-9a-z]{8}$/)
  })

  it('refreshes the list before toggling when it was never listed', async () => {
    const w = world()
    fixtureCli(w.process)
    const rt = runtimeFor(w)
    w.state.values.queue = {
      owner: rt.owner,
      jobs: [{ id: 'x', kind: 'enable', target: 'nosuch@fixtures', state: 'queued', tail: [] }],
    }
    rt.runner.kick()
    await w.clock.advance(0)
    await rt.runner.whenIdle()
    expect(w.state.values.queue.jobs[0]?.error?.message).toBe('nosuch@fixtures is not installed')
    rt.dispose()
  })
})

describe('capability probe', () => {
  it('reports full access with a current CLI', async () => {
    const w = world()
    w.process.when(['--version'], out('2.1.300 (Claude Code)'))
    expect(await probeCapabilities(w.ports)).toEqual({
      process: false,
      network: false,
      cliVersion: '2.1.300',
    })
  })

  it('names an older CLI on PATH', async () => {
    const w = world()
    w.process.when(['--version'], out('2.1.200 (Claude Code)'))
    const probe = await probeCapabilities(w.ports)
    expect(probe.reason).toBe('the claude CLI on PATH is 2.1.200; modmgr needs 2.1.292 or newer')
  })

  it('turns network use off under CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', async () => {
    const w = world()
    w.ports.env = fakeEnv({ CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' })
    w.process.when(['--version'], out('2.1.292'))
    const probe = await probeAndRecord(w.ports)
    expect(probe.network).toBe(true)
    expect(w.state.values.degraded).toEqual({
      process: false,
      network: true,
      acceptCommand: false,
      reason: 'network use is off (CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC)',
    })
  })

  it('keeps acceptCommand and survives an env read that rejects', async () => {
    const w = world()
    w.ports.env = {
      ...w.ports.env,
      nonessentialTraffic: async () => {
        throw new Error('refused')
      },
    }
    w.state.values.degraded = { process: true, network: true, acceptCommand: true, reason: 'old' }
    w.process.when(['--version'], out('2.1.292'))
    await probeAndRecord(w.ports)
    expect(w.state.values.degraded).toEqual({ process: false, network: false, acceptCommand: true })
  })
})
