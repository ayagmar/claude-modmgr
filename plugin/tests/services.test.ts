// Wiring and host-only behaviour (PLAN §9, C3): what fake ports can't show.
import { expect, test } from 'claude-code/testing'
import { host, MODS, START } from './harness.ts'

type Job = {
  id: string
  kind: string
  state: string
  target?: string
  tail: string[]
  error?: { kind: string }
}
type Queue = { owner: string; jobs: Job[] }

const queued = (id: string, kind: string, target?: string): Job =>
  ({
    id,
    kind,
    state: 'queued',
    tail: [],
    batch: 'b1',
    ...(target === undefined ? {} : { target }),
  }) as Job

test('resumes a queue an earlier module left: interrupts its running job, runs the rest, reloads 1.5 s after the last write', async ($, on) => {
  const h = host(on, {
    state: {
      queue: {
        owner: 'old-module',
        jobs: [
          { ...queued('old-1', 'enable', 'quiet-bash@fixtures'), state: 'running' },
          queued('old-2', 'disable', 'turn-band@fixtures'),
          queued('old-3', 'reload'),
        ],
      },
    },
  })
  await $.session.start(START)
  const taken = h.read('queue') as Queue
  expect(taken.owner).not.toBe('old-module')
  expect(taken.jobs.map(job => job.state)).toEqual(['interrupted', 'queued', 'queued'])

  await h.clock.advance(1)
  const afterWrite = h.read('queue') as Queue
  expect(afterWrite.jobs.map(job => job.state)).toEqual(['interrupted', 'ok', 'queued'])
  expect(h.argvs).toContain('plugin disable turn-band@fixtures --json')
  expect(h.reloads()).toBe(0)

  // The write ended at the start time; one ms has passed since.
  await h.clock.advance(1498)
  expect(h.reloads()).toBe(0)
  await h.clock.advance(1)
  expect(h.reloads()).toBe(1)
  const done = h.read('queue') as Queue
  expect(done.jobs.map(job => job.state)).toEqual(['interrupted', 'ok', 'ok'])
  expect((h.read('attention') as { reloadPending: boolean }).reloadPending).toBe(false)
})

test('a refused reload fails its job and leaves the reload pending (F29)', async ($, on) => {
  const h = host(on, {
    reload: () => {
      throw new Error('called from a command.run hook')
    },
    state: {
      queue: {
        owner: 'old-module',
        jobs: [queued('old-1', 'disable', 'turn-band@fixtures'), queued('old-2', 'reload')],
      },
    },
  })
  await $.session.start(START)
  await h.clock.advance(1)
  await h.clock.advance(1500)
  const queue = h.read('queue') as Queue
  expect(queue.jobs.map(job => `${job.kind}:${job.state}`)).toEqual(['disable:ok', 'reload:failed'])
  expect(queue.jobs[1]?.error?.kind).toBe('rejected')
  expect((h.read('attention') as { reloadPending: boolean }).reloadPending).toBe(true)
})

test('/mods never runs the CLI or a job from inside its command.run hook', async ($, on) => {
  const h = host(on, {
    state: {
      queue: { owner: 'old-module', jobs: [queued('old-1', 'disable', 'turn-band@fixtures')] },
    },
  })
  const ran = await $.command.run(MODS)
  expect(ran.text).toBe('modmgr is reading your plugins; try again in a moment.')
  expect(h.argvs).toEqual([])
  expect(h.reloads()).toBe(0)
})

test('a list that times out, prints malformed JSON or exits non-zero is recorded, not thrown', async ($, on) => {
  let answer: { throws: string } | { stdout: string; exitCode?: number; stderr?: string } = {
    throws: 'process.run: the command timed out',
  }
  const h = host(on, { cli: args => (args[1] === 'list' ? answer : undefined) })
  await $.session.start(START)
  await h.clock.advance(1)
  expect(h.read('sync')).toEqual({
    refreshing: false,
    error: { kind: 'timeout', message: 'claude list ran past 30 s' },
    skipped: 0,
  })

  answer = { stdout: '[{"id": ' }
  await $.session.start(START)
  await h.clock.advance(1)
  expect((h.read('sync') as { error: { kind: string } }).error.kind).toBe('parse')

  answer = { stdout: '', exitCode: 1, stderr: 'settings unreadable' }
  await $.session.start(START)
  await h.clock.advance(1)
  expect((h.read('sync') as { error: { message: string } }).error.message).toBe(
    'settings unreadable',
  )
  const ran = await $.command.run(MODS)
  expect(ran.text).toBe('modmgr is reading your plugins; try again in a moment.')
})

test('without a claude CLI on PATH, modmgr stays read-only and says why', async ($, on) => {
  const h = host(on, { cli: () => ({ throws: 'spawn claude ENOENT' }) })
  await $.session.start(START)
  await h.clock.advance(1)
  expect(h.read('degraded')).toEqual({
    process: true,
    network: false,
    acceptCommand: false,
    reason:
      "modmgr can't run the claude CLI here (spawn claude ENOENT); mods can be viewed, not changed",
  })
  expect(h.argvs).toEqual(['--version'])
})

test('network use is off under CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', async ($, on) => {
  const h = host(on, { env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' } })
  await $.session.start(START)
  await h.clock.advance(1)
  expect((h.read('degraded') as { network: boolean }).network).toBe(true)
})

test('a store over the budget gives up its oldest cache entries when it next writes', async ($, on) => {
  // ~6,000 detector entries of ~260 bytes each: about 1.5 MiB, past the 1 MiB budget.
  const detect: Record<string, [string, string]> = {}
  for (let i = 0; i < 6000; i += 1) detect[`p${i}-${'x'.repeat(200)}@m`] = ['a'.repeat(40), 'plain']
  const h = host(on, {
    store: { detect: { v: 1, data: detect } },
    state: {
      queue: { owner: 'old-module', jobs: [queued('old-1', 'disable', 'turn-band@fixtures')] },
    },
  })
  await $.session.start(START)
  await h.clock.advance(1)
  await h.clock.advance(2000) // the batched write
  const stored = h.stored('detect') as { v: number; data: Record<string, unknown> }
  const kept = Object.keys(stored.data)
  expect(kept.length).toBeLessThan(6000)
  expect(kept.at(-1)).toBe(`p5999-${'x'.repeat(200)}@m`)
  const history = h.stored('history') as { data: Array<{ kind: string }> }
  expect(history.data.map(entry => entry.kind)).toEqual(['disable'])
})

test('a failing session.start hook is passed through by its .catch (review M2)', async ($, on) => {
  host(on, { refuseRegister: true })
  const started = await $.session.start(START)
  expect(started).toEqual({ cwd: '/repo' })
})

test(
  'a userConfig change reloads the module: it resumes like any other (C3)',
  { options: { updateCheckHours: 0, detectRemote: false } },
  async ($, on) => {
    const h = host(on, {
      state: {
        queue: {
          owner: 'before-config-change',
          jobs: [{ ...queued('o-1', 'disable', 'turn-band@fixtures'), state: 'running' }],
        },
      },
    })
    await $.session.start(START)
    expect((h.read('queue') as Queue).jobs[0]?.state).toBe('interrupted')
  },
)
