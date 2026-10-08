// `/mods` (PLAN §2.7, C16): the bare command opens the dialog (PLAN §5.2); the
// subcommands answer as text, for a script, a `-p` run or a session that
// places no panes. A write asks for `--yes`, then runs its jobs here, on this
// hook's own ports, through the runner's own `runJob` (the same checks and
// declared-command handling), and records them on the queue and in the history.
// It never reloads (F29: a reload asked from a command hook rejects); it ends
// with how to apply what changed.

import type { Job, ModRow } from '../../types/index.d.ts'
import { parseModsArgs, USAGE } from '../domain/command-args.ts'
import {
  type ApplyStep,
  applyPlan,
  doctorText,
  exportOf,
  infoText,
  jobsText,
  listText,
  whyNot,
} from '../domain/command-text.ts'
import { healthItemsOf } from '../domain/health.ts'
import { appendTail, finish, isActive, type JobSpec, NEEDS_RELOAD, prune } from '../domain/jobs.ts'
import { sanitize } from '../domain/sanitize.ts'
import {
  commandLine,
  paneOpen,
  removeReview,
  specsOf,
  summaryOf,
  titleOf,
  toggleReview,
  updateReview,
} from '../domain/view.ts'
import type { Ports } from '../ports.ts'
import { historyOf, runJob } from './job-runner.ts'
import type { Runtime } from './runtime.ts'

export type CommandAnswer = { text?: string; exitCode?: number }

export type CommandPorts = Pick<Ports, 'state' | 'ui' | 'fs' | 'clock' | 'process' | 'session'>

/** The parts of the runtime a subcommand reaches; absent before the first `session.start`. */
export type CommandRuntime = Pick<
  Runtime,
  'registry' | 'newJobId' | 'health' | 'dev' | 'chrome' | 'store' | 'jobFinished'
>

export { USAGE }

export const modsCommand = async (
  ports: CommandPorts,
  rt: CommandRuntime | undefined,
  args: string,
): Promise<CommandAnswer> => {
  const parsed = parseModsArgs(args)
  if (!parsed.ok) return { text: `${parsed.error.message}\n\n${USAGE}`, exitCode: 2 }
  const command = parsed.value
  if (command.kind === 'help') return { text: USAGE }
  if (command.kind === 'open' && (await openDialog(ports))) return {}
  if (rt === undefined)
    return { text: 'modmgr is still starting; try again in a moment.', exitCode: 1 }
  // Read on the runtime's ports (never this hook's), when start-up hasn't yet.
  if (!rt.registry.isLoaded()) await rt.registry.refresh()
  const [mods, sync, degraded] = await Promise.all([
    ports.state.read('mods'),
    ports.state.read('sync'),
    ports.state.read('degraded'),
  ])
  // Said first only when it matters to every answer: the CLI is missing (not the network note).
  const said =
    degraded.process && degraded.reason !== undefined
      ? [sanitize(degraded.reason, { max: 300 })]
      : []
  const answer = (text: string, exitCode = 0): CommandAnswer =>
    exitCode === 0
      ? { text: [...said, text].join('\n') }
      : { text: [...said, text].join('\n'), exitCode }
  const rowOf = (id: string): ModRow | undefined => mods.find(row => row.id === id)
  if (!rt.registry.isLoaded()) {
    const why = sync.error?.message ?? 'the claude CLI did not answer'
    return answer(`Couldn't read your plugins: ${sanitize(why, { max: 300 })}`, 1)
  }

  switch (command.kind) {
    case 'open':
    case 'list':
      return answer(listText(mods, { skipped: sync.skipped }))
    case 'info': {
      const detail = rt.registry.detail(command.id)
      if (detail === undefined) return answer(`${command.id} is not an installed mod.`, 1)
      const row = rowOf(command.id)
      return answer(
        infoText(row?.updateTo === undefined ? detail : { ...detail, updateTo: row.updateTo }),
      )
    }
    case 'doctor': {
      await rt.dev.refresh()
      await rt.health.refresh()
      const [dev, attention, detect, queue, facts] = await Promise.all([
        ports.state.read('dev'),
        ports.state.read('attention'),
        ports.state.read('detect'),
        ports.state.read('queue'),
        ports.state.read('health'),
      ])
      const items = healthItemsOf({ mods, dev, attention, degraded, sync, detect, queue, facts })
      const problems = items.some(item => item.tone === 'bad')
      return { text: doctorText(items, command.json), ...(problems ? { exitCode: 1 } : {}) }
    }
    case 'export':
      return { text: JSON.stringify(exportOf(mods), null, 2) }
  }

  // The rest change something: they need the CLI, and `--yes`.
  if (degraded.process) return answer('Changing mods needs the claude CLI.', 1)
  let specs: JobSpec[]
  switch (command.kind) {
    case 'install':
      specs = [
        {
          kind: 'install',
          target: command.id,
          args: {
            scope: command.scope,
            ...(command.acceptSha === undefined ? {} : { acceptSha: command.acceptSha }),
          },
        },
      ]
      break
    case 'remove':
    case 'enable':
    case 'disable': {
      const row = rowOf(command.id)
      if (row === undefined) return answer(`${command.id} is not an installed mod.`, 1)
      const why = whyNot(command.kind, row)
      if (why !== undefined) return answer(`${sanitize(row.name, { max: 40 })}: ${why}`, 1)
      if (command.kind === 'remove') {
        const review = removeReview(row, rt.registry.facts(row.id))
        specs = specsOf({ ...review, keepData: !command.wipe })
        break
      }
      const enable = command.kind === 'enable'
      if (row.enabled === enable)
        return answer(`${sanitize(row.name, { max: 40 })} is already ${enable ? 'on' : 'off'}.`)
      specs = specsOf(toggleReview([{ row, enable }], id => rt.registry.facts(id)))
      break
    }
    case 'update': {
      const rows =
        command.id === undefined ? mods.filter(row => whyNot('update', row) === undefined) : []
      if (command.id !== undefined) {
        const row = rowOf(command.id)
        if (row === undefined) return answer(`${command.id} is not an installed mod.`, 1)
        const why = whyNot('update', row)
        if (why !== undefined) return answer(`${sanitize(row.name, { max: 40 })}: ${why}`, 1)
        rows.push(row)
      }
      if (rows.length === 0) return answer('None of these mods updates through the CLI.')
      specs = specsOf(updateReview(rows))
      break
    }
    case 'apply': {
      const text = await ports.fs.read(command.file).catch((error: unknown) => {
        return { error: error instanceof Error ? error.message : String(error) }
      })
      if (typeof text !== 'string') {
        return answer(
          `Couldn't read ${sanitize(command.file, { max: 200 })}: ${sanitize(text.error, { max: 200 })}`,
          1,
        )
      }
      const plan = applyPlan(text, mods)
      if (plan.errors.length > 0) return answer(plan.errors.join('\n'), 2)
      if (plan.steps.length === 0) return answer(`Nothing to do: ${plan.already} already so.`)
      specs = plan.steps.map(stepSpec)
      break
    }
  }
  if (!command.yes) {
    const lines = specs.map(spec => `  ${commandLine(spec) ?? `${spec.kind} ${spec.target ?? ''}`}`)
    return answer(['This would run:', ...lines, 'Add --yes to run it.'].join('\n'), 1)
  }
  const jobs = await runWrites(ports, rt, specs)
  const outcome = jobsText(jobs)
  return answer(outcome.text, outcome.failed ? 1 : 0)
}

const stepSpec = (step: ApplyStep): JobSpec =>
  step.kind === 'install'
    ? { kind: 'install', target: step.id, args: { scope: step.scope } }
    : step.scope === undefined
      ? { kind: 'enable', target: step.id }
      : { kind: 'enable', target: step.id, args: { scope: step.scope } }

/**
 * Runs `specs` in order on this command hook's own ports and records them on
 * the queue as one finished batch, with no reload (F29). The hook waits on its
 * `$.process` calls, which its 10 s budget doesn't run through; waiting on the
 * runtime's queue would (found live in a `-p` run, C16).
 */
const runWrites = async (
  ports: CommandPorts,
  rt: CommandRuntime,
  specs: readonly JobSpec[],
): Promise<Job[]> => {
  const batch = rt.newJobId()
  const jobs: Job[] = []
  for (const spec of specs) {
    const startedAt = await ports.clock.now()
    const job: Job = {
      id: rt.newJobId(),
      batch,
      kind: spec.kind,
      state: 'running',
      tail: [],
      startedAt,
      ...(spec.target === undefined ? {} : { target: spec.target }),
      ...(spec.args === undefined ? {} : { args: spec.args }),
    }
    const outcome = await runJob(ports, job, async id => rt.registry.entry(id) !== undefined)
    const endedAt = await ports.clock.now()
    const [done] = finish(appendTail([job], job.id, outcome.tail), job.id, endedAt, outcome.finish)
    if (done === undefined) continue
    jobs.push(done)
    rt.store.update('history', history => [...history, historyOf(job, endedAt, outcome)])
  }
  await ports.state.update('queue', queue => ({ ...queue, jobs: prune([...queue.jobs, ...jobs]) }))
  if (
    jobs.some(job => NEEDS_RELOAD.has(job.kind) && job.state === 'ok' && job.unchanged !== true)
  ) {
    await ports.state.update('attention', attention => ({ ...attention, reloadPending: true }))
  }
  for (const job of jobs) rt.jobFinished(job)
  rt.chrome.schedule()
  void rt.registry.refresh()
  return jobs
}

/** Opens the dialog; false when this session places no panes (a `-p` run, an older host). */
const openDialog = async (ports: Pick<Ports, 'state' | 'ui'>): Promise<boolean> => {
  try {
    const [mods, queue, attention] = await Promise.all([
      ports.state.read('mods'),
      ports.state.read('queue'),
      ports.state.read('attention'),
    ])
    const busy = queue.jobs.some(isActive)
    const title = titleOf(summaryOf({ attention, queue, mods }))
    const opened = await ports.ui.open(
      paneOpen({ focus: true, hold: !busy, mods: mods.length, title }),
    )
    return opened.isPlaced
  } catch {
    return false
  }
}
