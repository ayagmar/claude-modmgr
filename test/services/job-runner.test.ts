import { describe, expect, it } from 'vitest'
import type { Job } from '../../plugin/hooks/domain/jobs.ts'
import { RELOAD_SETTLE_MS, takeOver } from '../../plugin/hooks/domain/jobs.ts'
import { createRunner, enqueue, TAIL_FLUSH_MS } from '../../plugin/hooks/services/job-runner.ts'
import { createStore } from '../../plugin/hooks/services/store.ts'
import { runs } from '../domain/fixtures/cli-runs.ts'
import { fixtureCli } from './cli-world.ts'
import { out, world } from './fakes.ts'

const OWNER = 'own1'

const setup = (options: { installed?: string[] } = {}) => {
  const w = world()
  fixtureCli(w.process)
  w.state.values.queue = { owner: OWNER, jobs: [] }
  const store = createStore(w.ports)
  let settled = 0
  const runner = createRunner(w.ports, {
    owner: OWNER,
    store,
    ...(options.installed === undefined
      ? {}
      : { isInstalled: async (id: string) => options.installed?.includes(id) ?? false }),
    onSettled: async () => {
      settled += 1
    },
    debug: text => w.ui.debug(text),
  })
  let n = 0
  const ids = (index: number) => {
    n += 1
    return `j${n}-${index}`
  }
  return { w, store, runner, ids, settled: () => settled }
}

const jobs = (w: ReturnType<typeof world>): Job[] => w.state.values.queue.jobs
const states = (w: ReturnType<typeof world>) => jobs(w).map(job => `${job.kind}:${job.state}`)

/** Runs the queue to rest: drains, the reload's settle wait, and the reload. */
const runAll = async (w: ReturnType<typeof world>, runner: ReturnType<typeof setup>['runner']) => {
  runner.kick()
  await w.clock.advance(0)
  await runner.whenIdle()
  await w.clock.advance(RELOAD_SETTLE_MS)
  await runner.whenIdle()
}

describe('a toggle batch', () => {
  it('runs serially, then reloads once, 1.5 s after the last write', async () => {
    const { w, runner, ids, settled } = setup()
    await enqueue(
      w.ports,
      {
        id: 'b1',
        specs: [
          { kind: 'disable', target: 'turn-band@fixtures', args: { scope: 'user' } },
          { kind: 'enable', target: 'redactor@fixtures', args: { scope: 'project' } },
        ],
        reload: true,
      },
      ids,
    )
    runner.kick()
    await w.clock.advance(0)
    await runner.whenIdle()
    expect(states(w)).toEqual(['disable:ok', 'enable:ok', 'reload:queued'])
    expect(w.command.reloads).toBe(0)
    expect(w.state.values.attention.reloadPending).toBe(true)
    const lastWrite = jobs(w)[1]?.endedAt ?? 0

    await w.clock.advance(RELOAD_SETTLE_MS - 1)
    expect(w.command.reloads).toBe(0)
    await w.clock.advance(1)
    await runner.whenIdle()
    expect(w.command.reloads).toBe(1)
    expect(jobs(w)[2]?.startedAt).toBeGreaterThanOrEqual(lastWrite + RELOAD_SETTLE_MS)
    expect(states(w)).toEqual(['disable:ok', 'enable:ok', 'reload:ok'])
    expect(jobs(w)[2]?.tail).toEqual(['Reloaded: 1 plugin'])
    expect(w.state.values.attention.reloadPending).toBe(false)
    // One refresh, after the writes: a reload doesn't change what list --json says.
    expect(settled()).toBe(1)

    const argv = w.process.calls.map(call => call.argv.join(' '))
    expect(argv).toEqual([
      'claude plugin disable turn-band@fixtures --scope user --json',
      'claude plugin enable redactor@fixtures --scope project --json',
    ])
    expect(w.process.calls.every(call => call.init?.cwd === '/repo')).toBe(true)
  })

  it('writes the reload job running before asking for the reload', async () => {
    const { w, runner, ids } = setup()
    let seen: string | undefined
    w.command.reloadAnswer = async () => {
      seen = jobs(w).find(job => job.kind === 'reload')?.state
      return 'Reloaded'
    }
    await enqueue(
      w.ports,
      { id: 'b', specs: [{ kind: 'disable', target: 'turn-band@fixtures' }], reload: true },
      ids,
    )
    await runAll(w, runner)
    expect(seen).toBe('running')
  })

  it('reports a refused reload and keeps the reload pending', async () => {
    const { w, runner, ids } = setup()
    w.command.reloadAnswer = async () => {
      throw new Error('called from a command.run hook')
    }
    await enqueue(
      w.ports,
      { id: 'b', specs: [{ kind: 'disable', target: 'turn-band@fixtures' }], reload: true },
      ids,
    )
    await runAll(w, runner)
    const reload = jobs(w)[1]
    expect(reload?.state).toBe('failed')
    expect(reload?.error?.kind).toBe('rejected')
    expect(reload?.tail.at(-1)).toMatch(/reload-plugins/)
    expect(w.state.values.attention.reloadPending).toBe(true)
  })

  it('a reload the desktop app answers with a refusal fails, asks the person to reload, and stays pending', async () => {
    const { w, runner, ids } = setup()
    w.command.reloadAnswer = async () =>
      "/reload-plugins isn't available over a remote connection in this session."
    await enqueue(
      w.ports,
      { id: 'b', specs: [{ kind: 'disable', target: 'turn-band@fixtures' }], reload: true },
      ids,
    )
    await runAll(w, runner)
    const reload = jobs(w)[1]
    expect(reload?.state).toBe('failed')
    expect(reload?.error?.message).toMatch(/^Run \/reload-plugins/)
    expect(reload?.tail.at(-1)).toMatch(/^Run \/reload-plugins/)
    expect(w.state.values.attention.reloadPending).toBe(true)
  })

  it('cancels a reload whose batch changed nothing', async () => {
    const { w, runner, ids, settled } = setup()
    w.process.when(['disable'], out('', 1, 'nope'))
    await enqueue(
      w.ports,
      { id: 'b', specs: [{ kind: 'disable', target: 'turn-band@fixtures' }], reload: true },
      ids,
    )
    await runAll(w, runner)
    expect(states(w)).toEqual(['disable:failed', 'reload:cancelled'])
    expect(w.command.reloads).toBe(0)
    expect(w.state.values.attention.reloadPending).toBe(false)
    expect(settled()).toBe(1)
  })

  it('keeps one reload behind a second batch queued meanwhile', async () => {
    const { w, runner, ids } = setup()
    await enqueue(
      w.ports,
      { id: 'b1', specs: [{ kind: 'disable', target: 'turn-band@fixtures' }], reload: true },
      ids,
    )
    runner.kick()
    await w.clock.advance(0)
    await runner.whenIdle()
    await enqueue(
      w.ports,
      { id: 'b2', specs: [{ kind: 'enable', target: 'turn-band@fixtures' }], reload: true },
      ids,
    )
    await runAll(w, runner)
    expect(states(w)).toEqual(['disable:ok', 'enable:ok', 'reload:ok'])
    expect(w.command.reloads).toBe(1)
  })

  it('reloads once when any batch it covers changed something, whichever failed', async () => {
    const FAILS = out('', 1, 'nope')
    const ALREADY = out(runs['enable-again'].stdout, 1)
    // Two batches queued before the reload runs: what each CLI write answers.
    const twoBatches = async (first: ReturnType<typeof out> | undefined, second: typeof first) => {
      const { w, runner, ids } = setup()
      if (first !== undefined) w.process.when(['disable'], first)
      if (second !== undefined) w.process.when(['enable'], second)
      for (const [id, kind] of [
        ['a', 'disable'],
        ['b', 'enable'],
      ] as const) {
        await enqueue(
          w.ports,
          { id, specs: [{ kind, target: 'turn-band@fixtures' }], reload: true },
          ids,
        )
      }
      await runAll(w, runner)
      return { reloads: w.command.reloads, states: states(w) }
    }
    expect(await twoBatches(FAILS, undefined)).toEqual({
      reloads: 1,
      states: ['disable:failed', 'enable:ok', 'reload:ok'],
    })
    expect(await twoBatches(undefined, FAILS)).toEqual({
      reloads: 1,
      states: ['disable:ok', 'enable:failed', 'reload:ok'],
    })
    expect((await twoBatches(FAILS, ALREADY)).reloads).toBe(0)
  })

  it('a batch after a reload that ran is judged on its own', async () => {
    const { w, runner, ids } = setup()
    const batch = async (id: string) =>
      enqueue(
        w.ports,
        { id, specs: [{ kind: 'disable', target: 'turn-band@fixtures' }], reload: true },
        ids,
      )
    await batch('a')
    await runAll(w, runner)
    w.process.when(['disable'], out('', 1, 'nope'))
    await batch('b')
    await runAll(w, runner)
    expect(states(w)).toEqual(['disable:ok', 'reload:ok', 'disable:failed', 'reload:cancelled'])
    expect(w.command.reloads).toBe(1)
  })

  it('records finished jobs in the history, without output', async () => {
    const { w, runner, ids, store } = setup()
    await enqueue(
      w.ports,
      { id: 'b', specs: [{ kind: 'disable', target: 'turn-band@fixtures' }], reload: false },
      ids,
    )
    await runAll(w, runner)
    expect(store.get('history')).toEqual([
      expect.objectContaining({ kind: 'disable', state: 'ok', target: 'turn-band@fixtures' }),
    ])
  })
})

describe('job outcomes', () => {
  const one = async (spec: Parameters<typeof enqueue>[1]['specs'][number], options = {}) => {
    const s = setup(options)
    await enqueue(s.w.ports, { id: 'b', specs: [spec], reload: false }, s.ids)
    await runAll(s.w, s.runner)
    return { ...s, job: jobs(s.w)[0] }
  }

  it('fails a job whose target is not a plugin id, before any process runs', async () => {
    const { w, job } = await one({ kind: 'enable', target: '--evil' })
    expect(job?.state).toBe('failed')
    expect(job?.error?.kind).toBe('invalid')
    expect(w.process.calls).toEqual([])
  })

  it('refuses to toggle a plugin list --json does not show', async () => {
    const { w, job } = await one(
      { kind: 'enable', target: 'nosuch@fixtures' },
      { installed: ['turn-band@fixtures'] },
    )
    expect(job?.error).toEqual({ kind: 'invalid', message: 'nosuch@fixtures is not installed' })
    expect(w.process.calls).toEqual([])
  })

  it('says when the CLI found it already so', async () => {
    const s = setup()
    s.w.process.when(['enable'], out(runs['enable-again'].stdout, 1))
    await enqueue(
      s.w.ports,
      { id: 'b', specs: [{ kind: 'enable', target: 'turn-band@fixtures' }], reload: false },
      s.ids,
    )
    await runAll(s.w, s.runner)
    expect(jobs(s.w)[0]?.state).toBe('ok')
    expect(jobs(s.w)[0]?.tail[0]).toMatch(/^already so: /)
  })

  it('turns a declared command into a conflict that needs review', async () => {
    const s = setup()
    s.w.process.when(['install'], out(runs['install-command-refused'].stdout, 1))
    await enqueue(
      s.w.ports,
      { id: 'b', specs: [{ kind: 'install', target: 'cmdmod@cmdmkt' }], reload: false },
      s.ids,
    )
    await runAll(s.w, s.runner)
    const job = jobs(s.w)[0]
    expect(job?.error).toEqual({
      kind: 'conflict',
      message: 'this install runs a declared command that needs review first',
    })
    expect(job?.tail[0]).toBe('/tmp/modmgr-fixtures/emit.sh')
    expect(s.w.process.calls[0]?.argv).toEqual([
      'claude',
      'plugin',
      'install',
      'cmdmod@cmdmkt',
      '--scope',
      'user',
      '--json',
    ])
  })

  it('says when a reviewed declared command changed', async () => {
    const s = setup()
    s.w.process.when(['install'], out(runs['install-command-wrong-sha'].stdout, 1))
    const sha = '0'.repeat(64)
    await enqueue(
      s.w.ports,
      {
        id: 'b',
        specs: [{ kind: 'install', target: 'cmdmod@cmdmkt', args: { acceptSha: sha } }],
        reload: false,
      },
      s.ids,
    )
    await runAll(s.w, s.runner)
    expect(jobs(s.w)[0]?.error?.message).toBe('the declared command changed since it was reviewed')
    expect(s.w.process.calls[0]?.argv).toContain('--accept-command')
    expect(s.w.process.calls[0]?.argv).not.toContain('-y')
  })

  it('marks acceptance degraded when Claude Code refuses it from here', async () => {
    const s = setup()
    s.w.process.when(['install'], {
      stdout: '{"command":"install","outcome":"failed","message":"x"}\n',
      stderr: '--accept-command is ignored inside a Claude Code session',
      exitCode: 1,
    })
    await enqueue(
      s.w.ports,
      { id: 'b', specs: [{ kind: 'install', target: 'cmdmod@cmdmkt' }], reload: false },
      s.ids,
    )
    await runAll(s.w, s.runner)
    expect(jobs(s.w)[0]?.error?.kind).toBe('rejected')
    expect(s.w.state.values.degraded.acceptCommand).toBe(true)
  })

  it('builds remove, update and marketplace jobs from checked values only', async () => {
    const s = setup()
    s.w.process.when(
      ['marketplace'],
      out('{"command":"marketplace add","outcome":"ok","message":"ok"}\n'),
    )
    await enqueue(
      s.w.ports,
      {
        id: 'b',
        specs: [
          {
            kind: 'remove',
            target: 'quiet-bash@fixtures',
            args: { scope: 'user', keepData: true },
          },
          { kind: 'update', target: 'quiet-bash@fixtures' },
          { kind: 'marketplace-add', args: { source: 'ayagmar/modmgr' } },
          { kind: 'marketplace-update', target: 'fixtures' },
          { kind: 'marketplace-add', args: { source: '-rf /' } },
        ],
        reload: false,
      },
      s.ids,
    )
    await runAll(s.w, s.runner)
    expect(s.w.process.calls.map(call => call.argv.slice(2).join(' '))).toEqual([
      'uninstall quiet-bash@fixtures --scope user --keep-data --json',
      'update quiet-bash@fixtures --json',
      'marketplace add ayagmar/modmgr --json',
      'marketplace update fixtures --json',
    ])
    expect(states(s.w).at(-1)).toBe('marketplace-add:failed')
  })

  it('validates a dev folder and keeps the issues in the tail', async () => {
    const s = setup()
    s.w.process.when(['validate'], out(runs['validate-strict-broken'].stdout, 1))
    await enqueue(
      s.w.ports,
      { id: 'b', specs: [{ kind: 'validate', args: { path: '/dev/broken' } }], reload: false },
      s.ids,
    )
    await runAll(s.w, s.runner)
    const job = jobs(s.w)[0]
    expect(job?.state).toBe('failed')
    expect(job?.tail[0]).toMatch(/^\d+ errors, \d+ warnings$/)
    expect(s.w.process.calls[0]?.argv).toEqual([
      'claude',
      'plugin',
      'validate',
      '--json',
      '--strict',
      '/dev/broken',
    ])
  })

  it('passes a clean validate', async () => {
    const s = setup()
    s.w.process.when(['validate'], out(runs['validate-strict-turn-band'].stdout))
    await enqueue(
      s.w.ports,
      { id: 'b', specs: [{ kind: 'validate', args: { path: '/dev/tb' } }], reload: false },
      s.ids,
    )
    await runAll(s.w, s.runner)
    expect(jobs(s.w)[0]?.state).toBe('ok')
  })

  it('fails a validate whose report is unreadable or whose run failed', async () => {
    const s = setup()
    s.w.process.when(['validate'], out('not json', 1))
    await enqueue(
      s.w.ports,
      { id: 'b', specs: [{ kind: 'validate', args: { path: '/dev/x' } }], reload: false },
      s.ids,
    )
    await runAll(s.w, s.runner)
    expect(jobs(s.w)[0]?.error?.kind).toBe('parse')
    s.w.process.when(['validate'], { throws: 'gone' })
    await enqueue(
      s.w.ports,
      { id: 'c', specs: [{ kind: 'validate', args: { path: '/dev/x' } }], reload: false },
      s.ids,
    )
    await runAll(s.w, s.runner)
    expect(jobs(s.w)[1]?.error?.kind).toBe('unavailable')
  })
})

describe('streamed test jobs', () => {
  const testJob = async (script: Parameters<typeof setup>[0] = {}) => {
    const s = setup(script)
    await enqueue(
      s.w.ports,
      { id: 'b', specs: [{ kind: 'test', args: { path: '/dev/tb' } }], reload: false },
      s.ids,
    )
    return s
  }

  it('streams the tail, throttled, and passes on exit 0', async () => {
    const s = await testJob()
    s.w.process.spawnScript = {
      chunks: [
        { stream: 'stdout', text: 'a\nb' },
        { stream: 'stdout', text: '\nc\n' },
        { waitMs: TAIL_FLUSH_MS },
        { stream: 'stderr', text: 'd' },
      ],
      result: { code: 0, signal: null },
    }
    s.runner.kick()
    await s.w.clock.advance(TAIL_FLUSH_MS)
    await s.runner.whenIdle()
    const job = jobs(s.w)[0]
    expect(job?.state).toBe('ok')
    expect(job?.tail).toEqual(['a', 'b', 'c', 'd'])
    expect(s.w.process.spawns[0]).toEqual({
      argv: ['claude', 'plugin', 'test', '/dev/tb'],
      init: { cwd: '/repo' },
    })
    const tailWrites = s.w.state.writes.filter(key => key === 'queue').length
    expect(tailWrites).toBeLessThanOrEqual(6)
  })

  it('fails on a non-zero exit or a spawn that can not start', async () => {
    const s = await testJob()
    s.w.process.spawnScript = {
      chunks: [{ stream: 'stdout', text: 'x' }],
      result: { code: 1, signal: null },
    }
    await runAll(s.w, s.runner)
    expect(jobs(s.w)[0]?.error?.message).toBe('tests failed (exit 1)')

    const t = await testJob()
    t.w.process.spawnScript = { chunks: [], throws: 'no claude' }
    await runAll(t.w, t.runner)
    expect(jobs(t.w)[0]?.error?.kind).toBe('unavailable')
  })

  it('cancels a running test by killing the child', async () => {
    const s = await testJob()
    s.w.process.spawnScript = {
      chunks: [
        { stream: 'stdout', text: 'started\n' },
        { waitMs: 60_000 },
        { stream: 'stdout', text: 'never\n' },
      ],
    }
    s.runner.kick()
    await s.w.clock.advance(0)
    const id = jobs(s.w)[0]?.id ?? ''
    expect(await s.runner.cancel(id)).toBe(true)
    await s.w.clock.advance(60_000)
    await s.runner.whenIdle()
    expect(jobs(s.w)[0]?.state).toBe('cancelled')
    expect(s.w.process.killed).toBe(1)
  })
})

describe('cancelling and ownership', () => {
  it('cancels a queued job, and not an uncancellable running one', async () => {
    const { w, runner, ids } = setup()
    w.process.when(['disable'], { throws: 'slow', afterMs: 100 })
    await enqueue(
      w.ports,
      {
        id: 'b',
        specs: [
          { kind: 'disable', target: 'turn-band@fixtures' },
          { kind: 'enable', target: 'redactor@fixtures' },
        ],
        reload: true,
      },
      ids,
    )
    runner.kick()
    await w.clock.advance(0)
    const [first, second] = jobs(w)
    expect(first?.state).toBe('running')
    expect(await runner.cancel(first?.id ?? '')).toBe(false)
    expect(await runner.cancel(second?.id ?? '')).toBe(true)
    await w.clock.advance(100)
    await runner.whenIdle()
    await w.clock.advance(RELOAD_SETTLE_MS)
    await runner.whenIdle()
    expect(states(w)).toEqual(['disable:failed', 'enable:cancelled', 'reload:cancelled'])
  })

  it('stops claiming once a newer module took the queue over', async () => {
    const { w, runner, ids } = setup()
    w.process.when(['disable'], { throws: 'slow', afterMs: 100 })
    await enqueue(
      w.ports,
      {
        id: 'b',
        specs: [
          { kind: 'disable', target: 'turn-band@fixtures' },
          { kind: 'enable', target: 'redactor@fixtures' },
        ],
        reload: true,
      },
      ids,
    )
    runner.kick()
    await w.clock.advance(0)
    // The new module's session.start takes over while the first job runs.
    w.state.values.queue = takeOver(w.state.values.queue, 'own2', w.clock.time)
    await w.clock.advance(100)
    await runner.whenIdle()
    expect(states(w)).toEqual(['disable:interrupted', 'enable:queued', 'reload:queued'])
    expect(w.process.calls.map(call => call.argv[2])).toEqual(['disable'])
  })

  it('does nothing after dispose', async () => {
    const { w, runner, ids } = setup()
    await enqueue(
      w.ports,
      { id: 'b', specs: [{ kind: 'disable', target: 'turn-band@fixtures' }], reload: false },
      ids,
    )
    runner.kick()
    runner.dispose()
    await w.clock.advance(10)
    expect(states(w)).toEqual(['disable:queued'])
    runner.kick()
    expect(w.clock.pending).toBe(0)
  })

  it('keeps going after a host error, and logs it', async () => {
    const { w, runner, ids } = setup()
    await enqueue(
      w.ports,
      { id: 'b', specs: [{ kind: 'disable', target: 'turn-band@fixtures' }], reload: false },
      ids,
    )
    w.state.failWrites = true
    runner.kick()
    await w.clock.advance(0)
    await runner.whenIdle()
    expect(w.ui.lines.some(line => line.startsWith('modmgr: job runner stopped'))).toBe(true)
    w.state.failWrites = false
    await runAll(w, runner)
    expect(states(w)).toEqual(['disable:ok'])
  })

  it('logs a failed refresh after the jobs', async () => {
    const w = world()
    fixtureCli(w.process)
    w.state.values.queue = { owner: OWNER, jobs: [] }
    const runner = createRunner(w.ports, {
      owner: OWNER,
      store: createStore(w.ports),
      onSettled: async () => {
        throw new Error('list failed')
      },
      debug: text => w.ui.debug(text),
    })
    await enqueue(
      w.ports,
      { id: 'b', specs: [{ kind: 'disable', target: 'turn-band@fixtures' }], reload: false },
      id => `x${id}`,
    )
    await runAll(w, runner)
    expect(w.ui.lines).toContain('modmgr: refresh after jobs failed: Error: list failed')
  })

  it('folds a kick during a drain into the same drain', async () => {
    const { w, runner, ids } = setup()
    w.process.when(['disable'], { throws: 'slow', afterMs: 50 })
    await enqueue(
      w.ports,
      { id: 'b', specs: [{ kind: 'disable', target: 'turn-band@fixtures' }], reload: false },
      ids,
    )
    runner.kick()
    runner.kick()
    await w.clock.advance(0)
    await enqueue(
      w.ports,
      { id: 'c', specs: [{ kind: 'enable', target: 'turn-band@fixtures' }], reload: false },
      ids,
    )
    runner.kick()
    await w.clock.advance(50)
    await runner.whenIdle()
    expect(states(w)).toEqual(['disable:failed', 'enable:ok'])
  })
})
