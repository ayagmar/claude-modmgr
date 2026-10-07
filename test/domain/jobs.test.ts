import { describe, expect, it } from 'vitest'
import {
  appendTail,
  cancelQueued,
  enqueueBatch,
  finish,
  interruptRunning,
  inverseOf,
  JOBS_CAP,
  type Job,
  nextRunnable,
  prune,
  reloadIsUseful,
  retry,
  start,
  summarize,
  TAIL_LINES,
  undoNeedsReview,
  undoPlan,
} from '../../plugin/hooks/domain/jobs.ts'

const ids = (prefix: string) => (index: number) => `${prefix}${index}`
const kinds = (jobs: readonly Job[]) => jobs.map(job => `${job.kind}:${job.state}`)

const toggleBatch = (jobs: Job[] = []) =>
  enqueueBatch(
    jobs,
    {
      id: 'b1',
      specs: [
        { kind: 'disable', target: 'a@m', args: { scope: 'user' } },
        { kind: 'enable', target: 'b@m' },
      ],
      reload: true,
    },
    ids('j'),
  )

describe('enqueueBatch', () => {
  it('ends a batch with one reload', () => {
    const jobs = toggleBatch()
    expect(kinds(jobs)).toEqual(['disable:queued', 'enable:queued', 'reload:queued'])
    expect(jobs.map(job => job.batch)).toEqual(['b1', 'b1', 'b1'])
    expect(jobs[0]).toMatchObject({ id: 'j0', target: 'a@m', args: { scope: 'user' }, tail: [] })
  })

  it('moves a pending reload behind new jobs instead of adding another', () => {
    const jobs = enqueueBatch(
      toggleBatch(),
      { id: 'b2', specs: [{ kind: 'update', target: 'c@m' }], reload: true },
      ids('k'),
    )
    expect(kinds(jobs)).toEqual([
      'disable:queued',
      'enable:queued',
      'update:queued',
      'reload:queued',
    ])
  })

  it('adds no reload for jobs that change nothing loaded, or when asked not to', () => {
    expect(
      kinds(
        enqueueBatch(
          [],
          { id: 'v', specs: [{ kind: 'validate', target: 'x@m' }], reload: true },
          ids('v'),
        ),
      ),
    ).toEqual(['validate:queued'])
    expect(
      kinds(
        enqueueBatch(
          [],
          { id: 'h', specs: [{ kind: 'enable', target: 'x@m' }], reload: false },
          ids('h'),
        ),
      ),
    ).toEqual(['enable:queued'])
    expect(
      enqueueBatch(toggleBatch(), { id: 'e', specs: [], reload: true }, ids('e')),
    ).toHaveLength(3)
  })
})

describe('running', () => {
  it('runs one at a time and the reload last', () => {
    let jobs = toggleBatch()
    expect(nextRunnable(jobs)?.id).toBe('j0')
    jobs = start(jobs, 'j0', 10)
    expect(nextRunnable(jobs)).toBeUndefined()
    jobs = finish(jobs, 'j0', 20, { ok: true })
    expect(nextRunnable(jobs)?.id).toBe('j1')
    jobs = finish(start(jobs, 'j1', 30), 'j1', 40, {
      ok: false,
      error: { kind: 'cli-failed', message: 'no' },
    })
    expect(nextRunnable(jobs)?.kind).toBe('reload')
    expect(jobs[0]).toMatchObject({ state: 'ok', startedAt: 10, endedAt: 20 })
    expect(jobs[1]).toMatchObject({ state: 'failed', error: { kind: 'cli-failed' } })
  })

  it('ignores start and finish on the wrong state', () => {
    let jobs = toggleBatch()
    jobs = finish(start(jobs, 'j0', 1), 'j0', 2, { ok: true })
    expect(start(jobs, 'j0', 3)[0]).toMatchObject({ state: 'ok', startedAt: 1 })
    expect(finish(jobs, 'j0', 9, { ok: false, error: { kind: 'x', message: 'y' } })[0]?.state).toBe(
      'ok',
    )
  })

  it('decides whether a reload is worth running', () => {
    let jobs = toggleBatch()
    const reload = jobs[2] as Job
    jobs = finish(start(jobs, 'j0', 1), 'j0', 2, { ok: false, error: { kind: 'x', message: 'y' } })
    jobs = cancelQueued(jobs, 'j1', 3)
    expect(reloadIsUseful(jobs, reload)).toBe(false)
    jobs = toggleBatch()
    jobs = finish(start(jobs, 'j0', 1), 'j0', 2, { ok: true })
    expect(reloadIsUseful(jobs, reload)).toBe(true)
    expect(reloadIsUseful([], { id: 'r', kind: 'reload', state: 'queued', tail: [] })).toBe(true)
  })

  it('appends sanitised tails, keeping the last lines', () => {
    let jobs = toggleBatch()
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}\u001b[0m`)
    jobs = appendTail(jobs, 'j0', lines)
    expect(jobs[0]?.tail).toHaveLength(TAIL_LINES)
    expect(jobs[0]?.tail.at(-1)).toBe('line 29')
  })

  it('cancels queued and running jobs', () => {
    let jobs = toggleBatch()
    jobs = cancelQueued(jobs, 'j1', 5)
    expect(jobs[1]).toMatchObject({ state: 'cancelled', endedAt: 5 })
    jobs = start(jobs, 'j0', 6)
    expect(cancelQueued(jobs, 'j0', 7)[0]?.state).toBe('running')
    expect(finish(jobs, 'j0', 8, { cancelled: true })[0]).toMatchObject({
      state: 'cancelled',
      endedAt: 8,
    })
  })
})

describe('reload of modmgr itself (F31)', () => {
  it('marks a running job interrupted and lets it be retried', () => {
    let jobs = start(toggleBatch(), 'j0', 1)
    jobs = interruptRunning(jobs, 2)
    expect(jobs[0]).toMatchObject({ state: 'interrupted', endedAt: 2 })
    jobs = retry(jobs, 'j0', 'r0')
    expect(jobs.at(-1)).toMatchObject({
      id: 'r0',
      kind: 'disable',
      state: 'queued',
      target: 'a@m',
      batch: 'b1',
    })
    expect(nextRunnable(jobs)?.id).toBe('j1')
  })

  it('retries a reload and refuses to retry ok or active jobs', () => {
    let jobs = toggleBatch()
    jobs = cancelQueued(jobs, 'j2', 1)
    expect(retry(jobs, 'j2', 'r').at(-1)).toMatchObject({ kind: 'reload', state: 'queued' })
    expect(retry(jobs, 'j0', 'r')).toHaveLength(jobs.length)
    expect(retry(jobs, 'missing', 'r')).toHaveLength(jobs.length)
    jobs = finish(start(jobs, 'j0', 1), 'j0', 2, { ok: true })
    expect(retry(jobs, 'j0', 'r')).toHaveLength(jobs.length)
  })
})

describe('prune', () => {
  it('keeps the newest finished jobs and every active one', () => {
    const finished: Job[] = Array.from({ length: JOBS_CAP + 10 }, (_, i) => ({
      id: `f${i}`,
      kind: 'validate',
      state: 'ok',
      tail: [],
    }))
    const active: Job = { id: 'live', kind: 'test', state: 'running', tail: [] }
    const kept = prune([active, ...finished])
    expect(kept).toHaveLength(JOBS_CAP + 1)
    expect(kept[0]?.id).toBe('live')
    expect(kept[1]?.id).toBe('f10')
  })
})

describe('undo', () => {
  const done = (job: Partial<Job>): Job => ({
    id: 'x',
    kind: 'enable',
    state: 'ok',
    tail: [],
    target: 'a@m',
    ...job,
  })

  it('inverts toggles and installs', () => {
    expect(inverseOf(done({ kind: 'enable' }))).toEqual({ kind: 'disable', target: 'a@m' })
    expect(inverseOf(done({ kind: 'disable', args: { scope: 'project' } }))).toEqual({
      kind: 'enable',
      target: 'a@m',
      args: { scope: 'project' },
    })
    expect(inverseOf(done({ kind: 'install' }))).toMatchObject({ kind: 'remove' })
    expect(inverseOf(done({ kind: 'remove' }))).toMatchObject({ kind: 'install' })
    expect(inverseOf(done({ kind: 'update' }))).toBeUndefined()
    expect(inverseOf(done({ state: 'failed' }))).toBeUndefined()
    const { target: _target, ...noTarget } = done({})
    expect(inverseOf(noTarget)).toBeUndefined()
  })

  it('undoes the newest finished batch, newest job first', () => {
    let jobs = toggleBatch()
    jobs = finish(start(jobs, 'j0', 1), 'j0', 2, { ok: true })
    expect(undoPlan(jobs)).toEqual({ kind: 'none', reason: 'The last batch is still running' })
    jobs = finish(start(jobs, 'j1', 3), 'j1', 4, { ok: true })
    jobs = finish(start(jobs, 'j2', 5), 'j2', 6, { ok: true })
    const plan = undoPlan(jobs)
    expect(plan.kind === 'ready' ? plan.steps.map(step => step.spec) : plan).toEqual([
      { kind: 'disable', target: 'b@m' },
      { kind: 'enable', target: 'a@m', args: { scope: 'user' } },
    ])
    expect(undoNeedsReview(plan)).toBe(false)
    expect(undoPlan([])).toEqual({ kind: 'none', reason: 'Nothing to undo' })
    expect(undoPlan([{ id: 'v', kind: 'validate', state: 'ok', tail: [], batch: 'b' }])).toEqual({
      kind: 'none',
      reason: 'The last batch changed nothing to undo',
    })
  })

  it('skips a batch of reloads alone and says an update has no undo', () => {
    const toggled: Job = { ...done({ kind: 'disable' }), batch: 'b1' }
    const reload: Job = { id: 'r', kind: 'reload', state: 'ok', tail: [], batch: 'b2' }
    expect(undoPlan([toggled, reload])).toMatchObject({ kind: 'ready', batch: 'b1' })
    const updated: Job = { ...done({ kind: 'update' }), batch: 'b3' }
    expect(undoPlan([toggled, updated])).toEqual({
      kind: 'none',
      reason: "An update can't be undone: the CLI can't install an older version",
    })
  })

  it('leaves alone what was already so, and reviews a reinstall', () => {
    expect(inverseOf({ ...done({ kind: 'disable' }), unchanged: true })).toBeUndefined()
    const removed: Job = { ...done({ kind: 'remove', args: { keepData: true } }), batch: 'b1' }
    const plan = undoPlan([removed])
    expect(plan).toMatchObject({
      kind: 'ready',
      steps: [{ spec: { kind: 'install', target: 'a@m' }, undoes: { id: removed.id } }],
    })
    expect(undoNeedsReview(plan)).toBe(true)
    expect(inverseOf(done({ kind: 'install', args: { scope: 'local' } }))).toEqual({
      kind: 'remove',
      target: 'a@m',
      args: { scope: 'local', keepData: true },
    })
  })
})

describe('summarize', () => {
  it('counts what the band and title need', () => {
    let jobs = start(toggleBatch(), 'j0', 1)
    expect(summarize(jobs)).toMatchObject({
      queued: 2,
      reloadPending: true,
      failed: 0,
      running: { id: 'j0' },
    })
    jobs = finish(jobs, 'j0', 2, { ok: false, error: { kind: 'x', message: 'y' } })
    expect(summarize(jobs)).toEqual({ queued: 2, reloadPending: true, failed: 1 })
  })
})
