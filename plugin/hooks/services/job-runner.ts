// Drives the job queue in `$.state` (PLAN §2.8, C3). One runner per module,
// on the port set built at `session.start`; press handlers only enqueue and
// `kick()`. The rules:
// - one job at a time, claimed by compare-and-set, and only while this module
//   owns the queue (a newer module takes it over at its `session.start`, F39);
// - a batch's reload waits until nothing else is queued, and until 1.5 s after
//   the last CLI write (F38); it is written `running` before `/reload-plugins`
//   is asked, so a module replaced mid-reload finds it `interrupted` instead of
//   reloading twice (review M5);
// - every run starts from a clock timer, never inside a `command.run` hook (F29).

import { argvOf, commandOfJob } from '../domain/argv.ts'
import {
  appendTail,
  cancelQueued,
  claim,
  enqueueBatch,
  type Finish,
  finish,
  isClaimedBy,
  type Job,
  type JobQueue,
  type JobSpec,
  NEEDS_RELOAD,
  nextRunnable,
  prune,
  reloadIsUseful,
  reloadReadyAt,
} from '../domain/jobs.ts'
import type { ModmgrError } from '../domain/result.ts'
import { sanitize, tailLines } from '../domain/sanitize.ts'
import type { HistoryEntry } from '../domain/store-schema.ts'
import { parseValidateReport } from '../domain/validate-report.ts'
import { doneText, isWork } from '../domain/view.ts'
import type { Ports } from '../ports.ts'
import { type CliPorts, runCli, runOp } from './cli.ts'
import type { StoreService } from './store.ts'

export type RunnerPorts = CliPorts & Pick<Ports, 'state' | 'command' | 'ui'>

/** Streamed output reaches `$.state` at most this often (PLAN §2.8: ≤ 10 writes/s). */
export const TAIL_FLUSH_MS = 100

/** How long the band echoes a reload's answer. */
export const RELOAD_ECHO_MS = 8000

export type RunnerOptions = {
  /** This module's queue owner id. */
  readonly owner: string
  readonly store: Pick<StoreService, 'update'>
  /**
   * Whether `list --json` shows the plugin. `enable` of an id that isn't
   * installed reports success (C4), so toggles run only for listed ids.
   */
  readonly isInstalled?: (id: string) => Promise<boolean>
  /** After a drain in which a CLI write finished: refresh the installed list. */
  readonly onSettled?: () => Promise<unknown>
  /** After each job finishes, with its final state (a marketplace job reloads the catalogue). */
  readonly onFinished?: (job: Job) => void
  readonly debug?: (text: string) => void
}

export type Runner = {
  /** Schedules a drain on the runner's clock (never runs work in the caller's dispatch). */
  kick(): void
  /** Resolves once the current drain (if any) has finished. */
  whenIdle(): Promise<void>
  /** Cancels a queued job, or the running job when it is cancellable (a streamed test). */
  cancel(id: string): Promise<boolean>
  /** Stops scheduling; an in-flight job still finishes. */
  dispose(): void
}

type Outcome = { finish: Finish; tail: string[] }

const failed = (error: Pick<ModmgrError, 'kind' | 'message'>, tail: string[] = []): Outcome => ({
  finish: {
    ok: false,
    error: { kind: error.kind, message: sanitize(error.message, { max: 300 }) },
  },
  tail,
})
const succeeded = (tail: string[]): Outcome => ({ finish: { ok: true }, tail })

/** Queues a batch on the queue atom: what a press handler does before `kick()`. */
export const enqueue = async (
  ports: Pick<Ports, 'state'>,
  batch: { id: string; specs: readonly JobSpec[]; reload: boolean },
  newId: (index: number) => string,
  /**
   * Queues only while this holds, checked in the same versioned write: of two
   * presses that read one queue, the second finds it changed (review R-M3b-2).
   */
  when: (queue: JobQueue) => boolean = () => true,
): Promise<boolean> => {
  let queued = false
  await ports.state.update('queue', queue => {
    queued = when(queue)
    return queued ? { ...queue, jobs: prune(enqueueBatch(queue.jobs, batch, newId)) } : queue
  })
  return queued
}

export const createRunner = (ports: RunnerPorts, options: RunnerOptions): Runner => {
  const { owner, store } = options
  const debug = options.debug ?? (() => {})
  let draining: Promise<void> | undefined
  let scheduled: { cancel(): void } | undefined
  let wake: { cancel(): void } | undefined
  let again = false
  let disposed = false
  /** Stops the running job, when it can be stopped. */
  let stopCurrent: { id: string; stop: () => void } | undefined

  const writeQueue = (change: (jobs: Job[]) => Job[]) =>
    ports.state.update('queue', queue => ({ ...queue, jobs: change(queue.jobs) }))

  const record = (job: Job, endedAt: number, outcome: Outcome): void => {
    const entry: HistoryEntry = {
      id: job.id,
      kind: job.kind,
      state: 'cancelled' in outcome.finish ? 'cancelled' : outcome.finish.ok ? 'ok' : 'failed',
      endedAt,
      ...(job.target === undefined ? {} : { target: job.target }),
      ...('error' in outcome.finish ? { error: outcome.finish.error.message } : {}),
    }
    store.update('history', history => [...history, entry])
  }

  /** Says `line` in the band (and the pane's batch line) for a while (C8), then lets it go. */
  const echo = async (line: string): Promise<void> => {
    await ports.state.update('attention', attention => ({ ...attention, lastReload: line }))
    ports.clock.after(RELOAD_ECHO_MS, () => {
      void ports.state
        .update('attention', attention => {
          if (attention.lastReload !== line) return attention
          const { lastReload: _done, ...rest } = attention
          return rest
        })
        .catch(() => undefined)
    })
  }

  const reload = async (): Promise<Outcome> => {
    try {
      const text = await ports.command.reloadPlugins()
      // Always something to echo: the status line's "applied" shows while it does.
      const line = sanitize(text ?? 'Plugins reloaded', { max: 120 }) || 'Plugins reloaded'
      await ports.state.update('attention', attention => ({
        ...attention,
        reloadPending: false,
        lastReload: line,
      }))
      // The band echoes the CLI's line for a while (C8), then lets it go.
      ports.clock.after(RELOAD_ECHO_MS, () => {
        void ports.state
          .update('attention', attention => {
            if (attention.lastReload !== line) return attention
            const { lastReload: _done, ...rest } = attention
            return rest
          })
          .catch(() => undefined)
      })
      return succeeded([line])
    } catch (error) {
      // A reload that restarted modmgr rejects in the old module: the new one owns
      // the queue and has settled this reload (F54), so say nothing more.
      const queue = await ports.state.read('queue').catch(() => undefined)
      if (queue !== undefined && queue.owner !== owner) {
        return failed({ kind: 'unavailable', message: 'modmgr was reloaded' })
      }
      await ports.state.update('attention', attention => ({ ...attention, reloadPending: true }))
      return failed({ kind: 'rejected', message: String(error) }, [
        'Run /reload-plugins yourself, or restart Claude Code, to apply the changes.',
      ])
    }
  }

  /** `claude plugin test`, streamed: its tail reaches the job at most every TAIL_FLUSH_MS. */
  const test = async (job: Job, argv: string[]): Promise<Outcome> => {
    let cwd: string | undefined
    try {
      cwd = await ports.session.root()
    } catch {
      cwd = undefined
    }
    let pending: string[] = []
    let partial = ''
    let lastFlush = 0
    let stopped = false
    const flush = async (): Promise<void> => {
      if (pending.length === 0) return
      const lines = pending
      pending = []
      lastFlush = await ports.clock.now()
      await writeQueue(jobs => appendTail(jobs, job.id, lines))
    }
    // A child that can't start rejects the first pull, below.
    const stream = ports.process.spawn(argv, cwd === undefined ? {} : { cwd })
    stopCurrent = {
      id: job.id,
      stop: () => {
        stopped = true
        void stream.return({ code: null, signal: 'SIGTERM' })
      },
    }
    try {
      let step = await stream.next()
      while (step.done !== true) {
        const lines = (partial + step.value.text).split('\n')
        partial = lines.pop() ?? ''
        pending.push(...lines)
        if ((await ports.clock.now()) - lastFlush >= TAIL_FLUSH_MS) await flush()
        step = await stream.next()
      }
      if (partial !== '') pending.push(partial)
      await flush()
      if (stopped) return { finish: { cancelled: true }, tail: [] }
      const { code } = step.value
      return code === 0
        ? succeeded([])
        : failed({ kind: 'cli-failed', message: `tests failed (exit ${code ?? 'signal'})` })
    } catch (error) {
      await flush()
      if (stopped) return { finish: { cancelled: true }, tail: [] }
      return failed({ kind: 'unavailable', message: String(error) })
    } finally {
      stopCurrent = undefined
    }
  }

  const execute = async (job: Job): Promise<Outcome> => {
    if (job.kind === 'reload') return reload()
    const command = commandOfJob(job)
    if (!command.ok) return failed(command.error)
    const { op } = command.value
    if (
      (op === 'enable' || op === 'disable') &&
      options.isInstalled !== undefined &&
      !(await options.isInstalled(command.value.id))
    ) {
      return failed({ kind: 'invalid', message: `${command.value.id} is not installed` })
    }
    if (command.value.op === 'test') return test(job, argvOf(command.value))
    if (command.value.op === 'validate') {
      const run = await runCli(ports, command.value)
      if (!run.ok) return failed(run.error)
      const report = parseValidateReport(run.value)
      if (!report.ok) return failed(report.error)
      const { errors, warnings } = report.value
      const tail = tailLines(
        [
          `${errors.length} errors, ${warnings.length} warnings`,
          ...[...errors, ...warnings].map(issue => `${issue.path}: ${issue.message}`),
        ],
        20,
      )
      return report.value.success && errors.length === 0
        ? succeeded(tail)
        : failed({ kind: 'cli-failed', message: `${errors.length} validate errors` }, tail)
    }
    const result = await runOp(ports, command.value)
    if (!result.ok) {
      if (result.error.kind === 'rejected') {
        await ports.state.update('degraded', degraded => ({ ...degraded, acceptCommand: true }))
      }
      return failed(result.error)
    }
    if (result.value.status === 'needs-acceptance') {
      const { shown, changed } = result.value
      const stopped = failed(
        {
          kind: 'conflict',
          message: changed
            ? 'the declared command changed since it was reviewed'
            : `this ${job.kind} runs a declared command that needs review first`,
        },
        [sanitize(shown.command, { max: 300 })],
      )
      // Kept as the CLI showed it (capped); the review draws it sanitised and verbatim.
      const kept = { kind: shown.kind, command: shown.command.slice(0, 4000), sha256: shown.sha256 }
      return 'error' in stopped.finish
        ? { ...stopped, finish: { ...stopped.finish, shown: kept } }
        : stopped
    }
    const done = result.value
    // An update the CLI found current changed nothing, like an enable of an enabled mod.
    const current =
      done.update !== undefined &&
      (done.update.outcome === 'up_to_date' ||
        (done.update.from !== undefined && done.update.from === done.update.to))
    if (done.unchanged || current) {
      return { finish: { ok: true, unchanged: true }, tail: [`already so: ${done.message}`] }
    }
    const kept = done.keptData === undefined ? {} : { keptData: done.keptData }
    return { finish: { ok: true, ...kept }, tail: [done.message] }
  }

  /** Runs jobs until none is runnable now; true when a CLI write finished. */
  const drainOnce = async (): Promise<boolean> => {
    let wrote = false
    while (!disposed) {
      const queue = await ports.state.read('queue')
      if (queue.owner !== owner) return wrote // a newer module owns the queue now
      const next = nextRunnable(queue.jobs)
      if (next === undefined) return wrote
      const now = await ports.clock.now()
      if (next.kind === 'reload') {
        if (!reloadIsUseful(queue.jobs, next)) {
          await writeQueue(jobs => finish(jobs, next.id, now, { cancelled: true }))
          // A batch that changed nothing still says so (review R-M3b-1).
          const work = queue.jobs.filter(job => job.batch === next.batch && isWork(job))
          if (work.some(job => job.state === 'ok')) await echo(doneText(work))
          continue
        }
        const readyAt = reloadReadyAt(queue.jobs)
        if (now < readyAt) {
          wake?.cancel()
          wake = ports.clock.after(readyAt - now, () => {
            wake = undefined
            kick()
          })
          return wrote
        }
      }
      const claimed = await ports.state.update('queue', q => claim(q, owner, next.id, now))
      if (!isClaimedBy(claimed, owner, next.id)) continue
      let outcome: Outcome
      try {
        outcome = await execute(next)
      } catch (error) {
        outcome = failed({ kind: 'unavailable', message: String(error) })
      }
      const endedAt = await ports.clock.now()
      await writeQueue(jobs =>
        prune(finish(appendTail(jobs, next.id, outcome.tail), next.id, endedAt, outcome.finish)),
      )
      record(next, endedAt, outcome)
      const finished = (await ports.state.read('queue')).jobs.find(job => job.id === next.id)
      if (finished !== undefined) options.onFinished?.(finished)
      if (NEEDS_RELOAD.has(next.kind)) {
        wrote = true
        if ('ok' in outcome.finish && outcome.finish.ok && outcome.finish.unchanged !== true) {
          await ports.state.update('attention', attention => ({
            ...attention,
            reloadPending: true,
          }))
        }
      }
    }
    return wrote
  }

  const start = (): void => {
    draining = (async () => {
      let wrote = false
      do {
        again = false
        try {
          wrote = (await drainOnce()) || wrote
        } catch (error) {
          debug(`modmgr: job runner stopped: ${String(error)}`)
        }
      } while (again && !disposed)
      if (wrote && options.onSettled !== undefined) {
        try {
          await options.onSettled()
        } catch (error) {
          debug(`modmgr: refresh after jobs failed: ${String(error)}`)
        }
      }
    })().finally(() => {
      draining = undefined
    })
  }

  const kick = (): void => {
    if (disposed) return
    if (draining !== undefined) {
      again = true
      return
    }
    if (scheduled !== undefined) return
    scheduled = ports.clock.after(0, () => {
      scheduled = undefined
      if (!disposed && draining === undefined) start()
      else if (draining !== undefined) again = true
    })
  }

  return {
    kick,
    whenIdle: () => draining ?? Promise.resolve(),
    async cancel(id) {
      if (stopCurrent?.id === id) {
        stopCurrent.stop()
        return true
      }
      const now = await ports.clock.now()
      const queue = await writeQueue(jobs => cancelQueued(jobs, id, now))
      const job = queue.jobs.find(item => item.id === id)
      if (job?.state === 'cancelled') kick() // a reload may now be useless, or runnable
      return job?.state === 'cancelled'
    },
    dispose() {
      disposed = true
      scheduled?.cancel()
      wake?.cancel()
    },
  }
}
