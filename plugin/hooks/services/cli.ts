// Runs `claude …` through the process port and hands back parsed results
// (PLAN §3, C4). Argv comes only from domain/argv.ts; parsing only from
// domain/cli-results.ts and domain/validate-report.ts. Nothing here throws:
// a child that can't start or overran its timeout is an `Err`.

import { argvOf, type CliCommand, TIMEOUTS } from '../domain/argv.ts'
import {
  type CliRun,
  type Details,
  type InstalledEntry,
  type OpOutcome,
  type Parsed,
  parseDetails,
  parseInstalledList,
  parseOpResult,
} from '../domain/cli-results.ts'
import type { AbsolutePath, PluginId } from '../domain/ids.ts'
import { fail, ok, type Result } from '../domain/result.ts'
import { sanitize } from '../domain/sanitize.ts'
import { parseValidateReport, type ValidateReport } from '../domain/validate-report.ts'
import type { Ports } from '../ports.ts'

export type CliPorts = Pick<Ports, 'process' | 'session' | 'clock'>

const TIMEOUT_WORDS = /time[sd]?[ -]?out|timed out|still running/i

/** The engine prefixes a rejected call with `<plugin>: $.<noun>.<method>: `; the person needs the rest. */
const CALL_PREFIX = /^(?:[\w.@-]+: )?\$\.[\w.]+: /

const messageOf = (error: unknown): string =>
  sanitize((error instanceof Error ? error.message : String(error)).replace(CALL_PREFIX, ''), {
    max: 300,
  })

/**
 * The working directory for every run: the session's project root, so
 * `project`/`local` scope and `projectEnabled` mean this repository (R22).
 */
const cwdOf = async (ports: Pick<Ports, 'session'>): Promise<string | undefined> => {
  try {
    return await ports.session.root()
  } catch {
    return undefined
  }
}

/** Runs one command to completion. A non-zero exit is still `ok`: the parsers read it. */
export const runCli = async (ports: CliPorts, command: CliCommand): Promise<Result<CliRun>> => {
  const timeoutMs = TIMEOUTS[command.op]
  const cwd = await cwdOf(ports)
  const startedAt = await ports.clock.now()
  try {
    const out = await ports.process.run(argvOf(command), {
      timeoutMs,
      ...(cwd === undefined ? {} : { cwd }),
    })
    if (out.isStdoutTruncated) {
      return fail('parse', 'the CLI printed more than modmgr reads (4 MiB)')
    }
    return ok({ exitCode: out.exitCode, stdout: out.stdout, stderr: out.stderr })
  } catch (error) {
    const elapsed = (await ports.clock.now()) - startedAt
    const message = messageOf(error)
    if (elapsed >= timeoutMs * 0.95 || TIMEOUT_WORDS.test(message)) {
      return fail('timeout', `claude ${command.op} ran past ${Math.round(timeoutMs / 1000)} s`)
    }
    return fail('unavailable', message || 'the claude CLI could not start')
  }
}

const then = async <T>(
  run: Promise<Result<CliRun>>,
  parse: (run: CliRun) => Result<T>,
): Promise<Result<T>> => {
  const result = await run
  return result.ok ? parse(result.value) : result
}

export const listInstalled = (
  ports: CliPorts,
  options: { dataSize?: boolean } = {},
): Promise<Result<Parsed<InstalledEntry>>> =>
  then(
    runCli(ports, options.dataSize === true ? { op: 'list', dataSize: true } : { op: 'list' }),
    parseInstalledList,
  )

export const validateRoot = (
  ports: CliPorts,
  path: AbsolutePath,
): Promise<Result<ValidateReport>> =>
  then(runCli(ports, { op: 'validate', path }), parseValidateReport)

export const detailsOf = (ports: CliPorts, id: PluginId): Promise<Result<Details>> =>
  then(runCli(ports, { op: 'details', id }), parseDetails)

/** install, update, uninstall, enable, disable, marketplace add/update. */
export const runOp = (ports: CliPorts, command: CliCommand): Promise<Result<OpOutcome>> =>
  then(runCli(ports, command), parseOpResult)

const VERSION = /(\d+\.\d+\.\d+)/

/** `claude --version` → `2.1.292`. */
export const cliVersion = (ports: CliPorts): Promise<Result<string>> =>
  then(runCli(ports, { op: 'version' }), run => {
    const found = VERSION.exec(run.stdout)?.[1]
    if (run.exitCode !== 0) return fail('cli-failed', `claude --version exited ${run.exitCode}`)
    return found === undefined ? fail('parse', 'claude --version printed no version') : ok(found)
  })
