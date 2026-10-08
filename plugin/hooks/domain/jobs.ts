// The job queue as a pure reducer (PLAN §2.8, C3). The queue itself lives in
// `$.state` (it survives a reload of modmgr, F31); services/job-runner.ts drives
// these functions. Jobs run one at a time; a batch ends with one reload, which
// runs only when nothing else is queued or running.

import type { Job, JobKind, JobQueue, JobState, Scope } from '../../types/index.d.ts'
import { tailLines } from './sanitize.ts'

export type { Job, JobKind, JobQueue, JobState }

export const JOBS_CAP = 50
/** The longest declared command modmgr keeps to show; a longer one is accepted in a terminal. */
export const SHOWN_MAX = 4000
export const TAIL_LINES = 20
/**
 * How long after a batch's last CLI settings write its reload may start: a
 * `/reload-plugins` under ~1 s after one reads stale settings (F38).
 */
export const RELOAD_SETTLE_MS = 1500

export type JobSpec = {
  readonly kind: Exclude<JobKind, 'reload'>
  readonly target?: string
  readonly args?: Job['args']
}

const ACTIVE: ReadonlySet<JobState> = new Set(['queued', 'running'])
export const isActive = (job: Job): boolean => ACTIVE.has(job.state)

const withJob = (jobs: readonly Job[], id: string, fn: (job: Job) => Job): Job[] =>
  jobs.map(job => (job.id === id ? fn(job) : job))

const build = (id: string, spec: JobSpec | { kind: 'reload' }, batch: string | undefined): Job => {
  const job: Job = { id, kind: spec.kind, state: 'queued', tail: [] }
  return {
    ...job,
    ...(batch === undefined ? {} : { batch }),
    ...('target' in spec && spec.target !== undefined ? { target: spec.target } : {}),
    ...('args' in spec && spec.args !== undefined ? { args: spec.args } : {}),
  }
}

/** Kinds whose success changes what a session loads, so they need a reload. */
export const NEEDS_RELOAD: ReadonlySet<JobKind> = new Set([
  'install',
  'update',
  'remove',
  'enable',
  'disable',
])

/**
 * Queues a batch. When `reload` is set and any spec needs one, the batch ends
 * with a reload job; a reload already queued moves behind the new jobs, so
 * there is never more than one.
 */
export const enqueueBatch = (
  jobs: readonly Job[],
  batch: { readonly id: string; readonly specs: readonly JobSpec[]; readonly reload: boolean },
  newId: (index: number) => string,
): Job[] => {
  const added = batch.specs.map((spec, index) => build(newId(index), spec, batch.id))
  if (added.length === 0) return [...jobs]
  const wantsReload = batch.reload && batch.specs.some(spec => NEEDS_RELOAD.has(spec.kind))
  const pendingReload = jobs.find(job => job.kind === 'reload' && job.state === 'queued')
  const rest = pendingReload === undefined ? [...jobs] : jobs.filter(job => job !== pendingReload)
  const reload =
    pendingReload ??
    (wantsReload ? build(newId(added.length), { kind: 'reload' }, batch.id) : undefined)
  return reload === undefined ? [...rest, ...added] : [...rest, ...added, reload]
}

/**
 * Queues a reload on its own (the band's `[l reload]`, after a refused one).
 * A reload already queued or running is enough: nothing is added.
 */
export const enqueueReload = (jobs: readonly Job[], id: string, batch: string): Job[] =>
  jobs.some(job => job.kind === 'reload' && isActive(job))
    ? [...jobs]
    : [...jobs, build(id, { kind: 'reload' }, batch)]

/**
 * The job the runner should start now: nothing while one runs; otherwise the
 * oldest queued non-reload job; a queued reload only once it is alone.
 */
export const nextRunnable = (jobs: readonly Job[]): Job | undefined => {
  if (jobs.some(job => job.state === 'running')) return undefined
  const queued = jobs.filter(job => job.state === 'queued')
  return queued.find(job => job.kind !== 'reload') ?? queued[0]
}

/**
 * A queued reload whose batch changed nothing (every job failed, was
 * cancelled or found it already so) is pointless; the runner cancels it instead of running it.
 */
export const reloadIsUseful = (jobs: readonly Job[], reload: Job): boolean => {
  const others = jobs.filter(job => job.kind !== 'reload' && NEEDS_RELOAD.has(job.kind))
  const sameBatch =
    reload.batch === undefined ? others : others.filter(job => job.batch === reload.batch)
  const relevant = sameBatch.length > 0 ? sameBatch : others
  return relevant.some(job => job.state === 'ok' && job.unchanged !== true) || relevant.length === 0
}

export const start = (jobs: readonly Job[], id: string, now: number): Job[] =>
  withJob(jobs, id, job =>
    job.state === 'queued' ? { ...job, state: 'running', startedAt: now } : job,
  )

export type Finish =
  | { readonly ok: true; readonly unchanged?: boolean; readonly keptData?: boolean }
  | {
      readonly ok: false
      readonly error: { readonly kind: string; readonly message: string }
      /** What a declared command the job stopped on showed (F25), for the review that accepts it. */
      readonly shown?: Job['shown']
    }
  | { readonly cancelled: true }

export const finish = (jobs: readonly Job[], id: string, now: number, how: Finish): Job[] =>
  withJob(jobs, id, job => {
    if (!isActive(job)) return job
    if ('cancelled' in how) return { ...job, state: 'cancelled', endedAt: now }
    if (how.ok) {
      return {
        ...job,
        state: 'ok',
        endedAt: now,
        ...(how.unchanged === true ? { unchanged: true } : {}),
        ...(how.keptData === undefined ? {} : { keptData: how.keptData }),
      }
    }
    const failed: Job = { ...job, state: 'failed', endedAt: now, error: how.error }
    return how.shown === undefined ? failed : { ...failed, shown: how.shown }
  })

/** Appends streamed output, sanitised, keeping the last TAIL_LINES lines. */
export const appendTail = (jobs: readonly Job[], id: string, lines: readonly string[]): Job[] =>
  withJob(jobs, id, job => ({ ...job, tail: tailLines([...job.tail, ...lines], TAIL_LINES) }))

/** Cancels a queued job at once; a running one is cancelled by the runner, which then finishes it. */
export const cancelQueued = (jobs: readonly Job[], id: string, now: number): Job[] =>
  withJob(jobs, id, job =>
    job.state === 'queued' ? { ...job, state: 'cancelled', endedAt: now } : job,
  )

/** On `register`: a job a previous module left running can't be finished by this one (F31). */
export const interruptRunning = (jobs: readonly Job[], now: number): Job[] =>
  jobs.map(job => (job.state === 'running' ? { ...job, state: 'interrupted', endedAt: now } : job))

export const retry = (jobs: readonly Job[], id: string, newId: string): Job[] => {
  const old = jobs.find(job => job.id === id)
  if (old === undefined || isActive(old) || old.state === 'ok') return [...jobs]
  const spec: JobSpec | { kind: 'reload' } =
    old.kind === 'reload'
      ? { kind: 'reload' }
      : {
          kind: old.kind,
          ...(old.target === undefined ? {} : { target: old.target }),
          ...(old.args === undefined ? {} : { args: old.args }),
        }
  return [...jobs, build(newId, spec, old.batch)]
}

/** Keeps the newest `cap` finished jobs and every active one. */
export const prune = (jobs: readonly Job[], cap = JOBS_CAP): Job[] => {
  const finished = jobs.filter(job => !isActive(job))
  const drop = new Set(finished.slice(0, Math.max(0, finished.length - cap)))
  return jobs.filter(job => !drop.has(job))
}

/**
 * The CLI call that undoes a job, where one exists (`z`, PLAN §2.1). A job
 * that changed nothing (already so) has nothing to undo; an update has no
 * inverse (the CLI can't install an older version). Undoing an install keeps
 * the data the mod made since.
 */
export const inverseOf = (job: Job): JobSpec | undefined => {
  if (job.state !== 'ok' || job.unchanged === true || job.target === undefined) return undefined
  const scope: Scope | undefined = job.args?.scope
  const scoped = scope === undefined ? {} : { scope }
  const spec = (kind: JobSpec['kind'], args: Job['args']): JobSpec =>
    args === undefined || Object.keys(args).length === 0
      ? { kind, target: job.target as string }
      : { kind, target: job.target as string, args }
  switch (job.kind) {
    case 'enable':
      return spec('disable', scoped)
    case 'disable':
      return spec('enable', scoped)
    case 'install':
      return spec('remove', { ...scoped, keepData: true })
    case 'remove':
      return spec('install', scoped)
    default:
      return undefined
  }
}

/** One step of an undo: the spec to queue and the job it undoes. */
export type UndoStep = { readonly spec: JobSpec; readonly undoes: Job }

export type UndoPlan =
  | { readonly kind: 'ready'; readonly batch: string; readonly steps: UndoStep[] }
  | { readonly kind: 'none'; readonly reason: string }

/**
 * What `z` would do: invert the newest batch that did something, newest job
 * first. A batch of reloads alone is skipped (it changed no setting).
 */
export const undoPlan = (jobs: readonly Job[]): UndoPlan => {
  const seen = new Set<string>()
  for (let i = jobs.length - 1; i >= 0; i -= 1) {
    const batch = jobs[i]?.batch
    if (batch === undefined || seen.has(batch)) continue
    seen.add(batch)
    const members = jobs.filter(job => job.batch === batch && job.kind !== 'reload')
    if (members.length === 0) continue
    if (members.some(isActive)) return { kind: 'none', reason: 'The last batch is still running' }
    const steps = members.flatMap(job => {
      const spec = inverseOf(job)
      return spec === undefined ? [] : [{ spec, undoes: job }]
    })
    if (steps.length > 0) return { kind: 'ready', batch, steps: steps.reverse() }
    return members.some(job => job.kind === 'update' && job.state === 'ok' && !job.unchanged)
      ? {
          kind: 'none',
          reason: "An update can't be undone: the CLI can't install an older version",
        }
      : { kind: 'none', reason: 'The last batch changed nothing to undo' }
  }
  return { kind: 'none', reason: 'Nothing to undo' }
}

/** Whether `batch` is still the one `z` would undo: what an undo queues is checked against it. */
export const stillUndoes = (jobs: readonly Job[], batch: string): boolean => {
  const plan = undoPlan(jobs)
  return plan.kind === 'ready' && plan.batch === batch
}

/** An undo that reinstalls runs a mod's code again: it goes through the review (R-M3a §3). */
export const undoNeedsReview = (plan: UndoPlan): boolean =>
  plan.kind === 'ready' && plan.steps.some(step => step.spec.kind === 'install')

export type QueueSummary = {
  readonly running?: Job
  readonly queued: number
  readonly reloadPending: boolean
  readonly failed: number
}

export const summarize = (jobs: readonly Job[]): QueueSummary => {
  const running = jobs.find(job => job.state === 'running')
  const summary = {
    queued: jobs.filter(job => job.state === 'queued').length,
    reloadPending: jobs.some(job => job.kind === 'reload' && isActive(job)),
    failed: jobs.filter(job => job.state === 'failed' || job.state === 'interrupted').length,
  }
  return running === undefined ? summary : { ...summary, running }
}

/** The latest a CLI write finished (any outcome: a failed run may still have written), or undefined. */
export const lastWriteAt = (jobs: readonly Job[]): number | undefined => {
  let latest: number | undefined
  for (const job of jobs) {
    if (job.kind === 'reload' || !NEEDS_RELOAD.has(job.kind) || job.endedAt === undefined) continue
    latest = latest === undefined ? job.endedAt : Math.max(latest, job.endedAt)
  }
  return latest
}

/** When a queued reload may start (F38): at once when nothing was written. */
export const reloadReadyAt = (jobs: readonly Job[]): number => {
  const last = lastWriteAt(jobs)
  return last === undefined ? 0 : last + RELOAD_SETTLE_MS
}

/** What a reload job says when the reload restarted modmgr with it (F54). */
export const RELOADED_WITH_MODMGR = 'Plugins reloaded, modmgr with them'

/**
 * A module takes the queue over at `session.start`: a job another module left
 * running can't be finished by this one (F31), so it becomes `interrupted`;
 * but a reload left running is what restarted this module (a reload re-runs
 * modmgr when its files changed or a plugin that hooks `plugin.register`
 * joined, F19, F54), so it is done. The same owner taking over again changes
 * nothing.
 */
export const takeOver = (queue: JobQueue, owner: string, now: number): JobQueue =>
  queue.owner === owner
    ? queue
    : {
        owner,
        jobs: interruptRunning(
          queue.jobs.map(job =>
            job.kind === 'reload' && job.state === 'running'
              ? { ...job, state: 'ok', endedAt: now, tail: [...job.tail, RELOADED_WITH_MODMGR] }
              : job,
          ),
          now,
        ),
      }

/** Whether taking over completed a reload the previous module had running. */
export const tookOverReload = (before: JobQueue, after: JobQueue): boolean =>
  before.jobs.some(
    job =>
      job.kind === 'reload' &&
      job.state === 'running' &&
      after.jobs.some(next => next.id === job.id && next.state === 'ok'),
  )

/**
 * Starts job `id` for `owner` if it still owns the queue and the job is still
 * the next runnable one; otherwise the queue is unchanged (the runner reads
 * the result to learn whether it won).
 */
export const claim = (queue: JobQueue, owner: string, id: string, now: number): JobQueue => {
  if (queue.owner !== owner || nextRunnable(queue.jobs)?.id !== id) return queue
  return { ...queue, jobs: start(queue.jobs, id, now) }
}

export const isClaimedBy = (queue: JobQueue, owner: string, id: string): boolean =>
  queue.owner === owner && queue.jobs.some(job => job.id === id && job.state === 'running')
