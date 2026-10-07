import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../../plugin/hooks/domain/config.ts'
import { probeAndRecord, probeCapabilities } from '../../plugin/hooks/services/capability-probe.ts'
import { modsCommand, USAGE } from '../../plugin/hooks/services/commands.ts'
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
      prefs: { v: 1, data: { tab: 'health', sort: 'installs', kind: 'all', firstRunDone: true } },
    }
    const w = world({ store: stored })
    fixtureCli(w.process)
    await onSessionStart(runtimeFor(w))
    await w.clock.advance(0)
    expect(w.state.values.view).toMatchObject({ tab: 'health', sort: 'installs', kind: 'all' })

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
      pluginDirs: async () => undefined,
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

describe('/mods (text)', () => {
  it('lists mods with their state', async () => {
    const w = world()
    w.state.values.mods = [
      {
        id: 'a@m',
        name: 'a',
        version: '1.0.0',
        origin: 'marketplace',
        scope: 'user',
        enabled: true,
        toggleable: true,
        notableCount: 2,
        problems: 1,
        mixed: false,
      },
      {
        id: 'b@inline',
        name: 'b',
        origin: 'env-dir',
        enabled: false,
        projectEnabled: false,
        toggleable: false,
        notableCount: 0,
        problems: 0,
        mixed: false,
      },
    ]
    w.state.values.sync = { refreshing: true, skipped: 2 }
    w.state.values.degraded = {
      process: true,
      network: false,
      acceptCommand: false,
      reason: 'no CLI',
    }
    const answer = await modsCommand(w.ports, ' list ')
    expect(answer.text?.split('\n')).toEqual([
      'no CLI',
      '2 mods (1 on) ↻',
      '●  a  1.0.0  user  ▲1  ◆2',
      '○  b  env-dir  off',
      '2 plugins could not be read.',
    ])
  })

  it('says when it is still reading, or when there are none', async () => {
    const w = world()
    expect((await modsCommand(w.ports, 'list')).text).toBe(
      'modmgr is reading your plugins; try again in a moment.',
    )
    w.state.values.sync = { refreshing: false, at: 1, skipped: 0 }
    expect((await modsCommand(w.ports, 'list')).text).toBe('No mods installed.')
  })

  it('bare /mods opens the dialog with focus, Esc and held toasts, and answers nothing', async () => {
    const w = world()
    expect(await modsCommand(w.ports, '')).toEqual({})
    expect(w.ui.opens).toEqual([
      { id: 'modmgr', title: 'mods', closeOnEscape: true, rows: 8, focus: true, holdToasts: true },
    ])
  })

  it('opens without holding toasts while jobs run (C8)', async () => {
    const w = world()
    w.state.values.queue = {
      owner: 'o',
      jobs: [{ id: 'j', kind: 'disable', state: 'running', tail: [] }],
    }
    await modsCommand(w.ports, '')
    expect(w.ui.opens[0]?.holdToasts).toBeUndefined()
  })

  it('answers as text where no pane can be placed, or opening fails', async () => {
    const w = world()
    w.state.values.sync = { refreshing: false, at: 1, skipped: 0 }
    w.ui.placed = false
    expect((await modsCommand(w.ports, '')).text).toBe('No mods installed.')
    w.ui.open = async () => {
      throw new Error('no ui')
    }
    expect((await modsCommand(w.ports, '')).text).toBe('No mods installed.')
  })

  it('refuses an unknown subcommand with a usage line', async () => {
    const w = world()
    expect(await modsCommand(w.ports, 'frobnicate now')).toEqual({
      text: `${USAGE}\nUnknown subcommand: frobnicate`,
      exitCode: 2,
    })
  })
})
