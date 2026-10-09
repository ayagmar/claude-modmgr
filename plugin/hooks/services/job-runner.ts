// Drives the job queue in `$.state`. One runner per module,
// on the port set built at `session.start`; press handlers only enqueue and
// `kick()`. The rules:
// - one job at a time, claimed by compare-and-set, and only while this module
//   owns the queue (a newer module takes it over at its `session.start`, while
//   an old module's in-flight handlers may still finish);
// - a batch's reload waits until nothing else is queued, and until 1.5 s after
//   the last CLI write (a reload sooner reads stale settings); it is written
//   `running` before `/reload-plugins` is asked, so a module replaced
//   mid-reload finds it `interrupted` instead of reloading twice;
// - every run starts from a clock timer, never inside a `command.run` hook
//   (`/reload-plugins` rejects there: it would wait on the turn the hook holds).

import { argvOf, commandOfJob } from '../domain/argv.ts'
import {
  appendTail,
  cancelQueued,
  claim,
  coveredBy,
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
  SHOWN_MAX,
} from '../domain/jobs.ts'
import type { ModmgrError } from '../domain/result.ts'
import { sanitize, tailLines } from '../domain/sanitize.ts'
import type { HistoryEntry } from '../domain/store-schema.ts'
import { parseValidateReport } from '../domain/validate-report.ts'
import { doneText, isWork, PANE_ID } from '../domain/view.ts'
import type { Ports } from '../ports.ts'
import { type CliPorts, runCli, runOp } from './cli.ts'
import type { StoreService } from './store.ts'

export type RunnerPorts = CliPorts & Pick<Ports, 'state' | 'command' | 'ui'>

/** Streamed output reaches `$.state` at most this often (≤ 10 writes/s). */
export const TAIL_FLUSH_MS = 100

/** How long the band echoes a reload's answer. */
export const RELOAD_ECHO_MS = 8000

/** How the engine words a reload it refuses (seen on 2.1.293 under the desktop app). */
const RELOAD_REFUSED = /isn['’]t available/i

export type RunnerOptions = {
  /** This module's queue owner id. */
  readonly owner: string
  readonly store: Pick<StoreService, 'update'>
  /**
   * Whether `list --json` shows the plugin. `enable` of an id that isn't
   * installed reports success, so toggles run only for listed ids.
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

export type Outcome = { finish: Finish; tail: string[] }

/** A job whose module lost the queue mid-run: nothing about it is written. */
const ABANDONED: Outcome = { finish: { cancelled: true }, tail: [] }

const failed = (error: Pick<ModmgrError, 'kind' | 'message'>, tail: string[] = []): Outcome => ({
  finish: {
    ok: false,
    error: { kind: error.kind, message: sanitize(error.message, { max: 300 }) },
  },
  tail,
})
const succeeded = (tail: string[]): Outcome => ({ finish: { ok: true }, tail })

/** What the store's history keeps of a finished job: no output. */
export const historyOf = (job: Job, endedAt: number, outcome: Outcome): HistoryEntry => ({
  id: job.id,
  kind: job.kind,
  state: 'cancelled' in outcome.finish ? 'cancelled' : outcome.finish.ok ? 'ok' : 'failed',
  endedAt,
  ...(job.target === undefined ? {} : { target: job.target }),
  ...('error' in outcome.finish ? { error: outcome.finish.error.message } : {}),
})

/**
 * Runs one CLI job (not a reload, not a streamed test) on `ports` and says how
 * it ended: the runner's for the dialog, and `/mods`'s text writes on their own
 * hook's ports (a hook's 10 s budget doesn't run down while it awaits its own
 * `$` calls). `isInstalled` keeps an enable or disable to ids `list --json` shows.
 */
export const runJob = async (
  ports: CliPorts & Pick<Ports, 'state'>,
  job: Job,
  isInstalled?: (id: string) => Promise<boolean>,
): Promise<Outcome> => {
  const command = commandOfJob(job)
  if (!command.ok) return failed(command.error)
  const { op } = command.value
  if (
    (op === 'enable' || op === 'disable') &&
    isInstalled !== undefined &&
    !(await isInstalled(command.value.id))
  ) {
    return failed({ kind: 'invalid', message: `${command.value.id} is not installed` })
  }
  if (command.value.op === 'test')
    return failed({ kind: 'invalid', message: 'a test streams: the runner runs it' })
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
    const counts = { errors: errors.length, warnings: warnings.length }
    if (report.value.success && errors.length === 0) {
      return { finish: { ok: true, report: counts }, tail }
    }
    const message =
      errors.length === 0
        ? 'validate did not pass'
        : `${errors.length} validate ${errors.length === 1 ? 'error' : 'errors'}`
    const stopped = failed({ kind: 'cli-failed', message }, tail)
    return 'error' in stopped.finish
      ? { ...stopped, finish: { ...stopped.finish, report: counts } }
      : stopped
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
    const cut = shown.command.length > SHOWN_MAX
    const kept = {
      kind: shown.kind,
      command: shown.command.slice(0, SHOWN_MAX),
      sha256: shown.sha256,
      ...(cut ? { truncated: true } : {}),
    }
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

/**
 * Says `line` in the band (and the pane's batch line) for RELOAD_ECHO_MS, then
 * lets it go, unless another line replaced it meanwhile.
 */
export const echoLine = async (
  ports: Pick<Ports, 'state' | 'clock'>,
  line: string,
): Promise<void> => {
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

/** Queues a batch on the queue atom: what a press handler does before `kick()`. */
export const enqueue = async (
  ports: Pick<Ports, 'state'>,
  batch: { id: string; specs: readonly JobSpec[]; reload: boolean },
  newId: (index: number) => string,
  /**
   * Queues only while this holds, checked in the same versioned write: of two
   * presses that read one queue, the second finds it changed.
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
    store.update('history', history => [...history, historyOf(job, endedAt, outcome)])
  }

  const echo = (line: string): Promise<void> => echoLine(ports, line)

  const reload = async (): Promise<Outcome> => {
    try {
      // A reload takes the keys from the pane: the module it starts gives them back.
      const held = (await ports.ui.panes()).some(pane => pane.id === PANE_ID && pane.isFocused)
      if (held) await ports.state.update('view', view => ({ ...view, keysAfterReload: true }))
      const text = await ports.command.reloadPlugins()
      // A session the desktop app drives refuses a plugin's reload in words
      // alone ("/reload-plugins isn't available over a remote connection"),
      // though the person's own /reload-plugins works: nothing was applied.
      if (text !== undefined && RELOAD_REFUSED.test(text)) {
        await ports.state.update('attention', attention => ({
          ...attention,
          reloadPending: true,
          reloadByHand: true,
        }))
        const ask = 'Run /reload-plugins to apply the changes: this session lets only you reload.'
        return failed({ kind: 'rejected', message: ask }, [sanitize(text, { max: 200 }), ask])
      }
      // Always something to echo: the status line's "applied" shows while it does.
      const line = sanitize(text ?? 'Plugins reloaded', { max: 120 }) || 'Plugins reloaded'
      await ports.state.update('attention', attention => ({ ...attention, reloadPending: false }))
      await echo(line)
      return succeeded([line])
    } catch (error) {
      // A reload that restarted modmgr rejects in the old module: the new one owns
      // the queue and has settled this reload, so say nothing more.
      const queue = await ports.state.read('queue').catch(() => undefined)
      if (queue !== undefined && queue.owner !== owner) return ABANDONED
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
    if (job.kind === 'test') {
      const command = commandOfJob(job)
      return command.ok ? test(job, argvOf(command.value)) : failed(command.error)
    }
    return runJob(ports, job, options.isInstalled)
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
          // Batches that changed nothing still say so.
          const work = coveredBy(queue.jobs, next).filter(isWork)
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
      if (outcome === ABANDONED) return wrote
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
