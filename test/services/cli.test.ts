import { describe, expect, it } from 'vitest'
import type { AbsolutePath, PluginId } from '../../plugin/hooks/domain/ids.ts'
import {
  cliVersion,
  detailsOf,
  listInstalled,
  runCli,
  runOp,
  validateRoot,
} from '../../plugin/hooks/services/cli.ts'
import { runs } from '../domain/fixtures/cli-runs.ts'
import { fakeSession, out, world } from './fakes.ts'

describe('runCli', () => {
  it('runs argv with the session root as cwd and the op timeout', async () => {
    const w = world({ root: '/work/repo' })
    w.process.when(['list'], out('[]'))
    const result = await runCli(w.ports, { op: 'list' })
    expect(result).toEqual({ ok: true, value: { exitCode: 0, stdout: '[]', stderr: '' } })
    expect(w.process.calls[0]).toEqual({
      argv: ['claude', 'plugin', 'list', '--json'],
      init: { timeoutMs: 30_000, cwd: '/work/repo' },
    })
  })

  it('runs without a cwd when the root is unknown', async () => {
    const w = world()
    w.ports.session = fakeSession(async () => {
      throw new Error('no root')
    })
    w.process.when(['list'], out('[]'))
    await runCli(w.ports, { op: 'list' })
    expect(w.process.calls[0]?.init).toEqual({ timeoutMs: 30_000 })
  })

  it('keeps a non-zero exit as a run for the parsers', async () => {
    const w = world()
    w.process.when(['enable'], out('{}', 1, 'bad'))
    const result = await runCli(w.ports, {
      op: 'enable',
      id: 'a@b' as PluginId,
    })
    expect(result).toEqual({ ok: true, value: { exitCode: 1, stdout: '{}', stderr: 'bad' } })
  })

  it('maps a child killed at its timeout to timeout', async () => {
    const w = world()
    w.process.when(['list'], { hang: true })
    const pending = runCli(w.ports, { op: 'list' })
    await w.clock.advance(30_000)
    const result = await pending
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.error).toEqual({ kind: 'timeout', message: 'claude list ran past 30 s' })
  })

  it('maps a timeout by its wording even when it came early', async () => {
    const w = world()
    w.process.when(['list'], { throws: 'Command timed out' })
    const result = await runCli(w.ports, { op: 'list' })
    expect(!result.ok && result.error.kind).toBe('timeout')
  })

  it('maps a child that cannot start to unavailable', async () => {
    const w = world()
    w.process.when(['list'], { throws: 'spawn claude ENOENT' })
    const result = await runCli(w.ports, { op: 'list' })
    expect(result).toEqual({
      ok: false,
      error: { kind: 'unavailable', message: 'spawn claude ENOENT' },
    })
  })

  it('drops the engine prefix from a rejection', async () => {
    const w = world()
    w.process.when(['list'], { throws: 'modmgr: $.process.run: spawn claude ENOENT' })
    const result = await runCli(w.ports, { op: 'list' })
    expect(!result.ok && result.error.message).toBe('spawn claude ENOENT')
  })

  it('names a rejection that carries no message', async () => {
    const w = world()
    w.process.on(() => ({ throws: '' }))
    const result = await runCli(w.ports, { op: 'list' })
    expect(!result.ok && result.error.message).toBe('the claude CLI could not start')
  })

  it('refuses output cut at 4 MiB', async () => {
    const w = world()
    w.process.when(['list'], { stdout: '[', isStdoutTruncated: true })
    const result = await runCli(w.ports, { op: 'list' })
    expect(!result.ok && result.error.kind).toBe('parse')
  })
})

describe('typed runs', () => {
  it('lists installed plugins', async () => {
    const w = world()
    w.process.when(['list'], out(runs.list.stdout))
    const result = await listInstalled(w.ports)
    expect(result.ok && result.value.items.map(item => item.id)).toContain('turn-band@fixtures')
    await listInstalled(w.ports, { dataSize: true })
    expect(w.process.calls[1]?.argv).toContain('--data-size')
  })

  it('passes a failed run through every parser', async () => {
    const w = world()
    w.process.on(() => ({ throws: 'gone' }))
    expect((await listInstalled(w.ports)).ok).toBe(false)
    expect((await validateRoot(w.ports, '/x' as AbsolutePath)).ok).toBe(false)
    expect((await detailsOf(w.ports, 'a@b' as PluginId)).ok).toBe(false)
    expect((await runOp(w.ports, { op: 'enable', id: 'a@b' as PluginId })).ok).toBe(false)
  })

  it('validates a root and reads details', async () => {
    const w = world()
    w.process
      .when(['validate'], out(runs['validate-turn-band'].stdout))
      .when(['details'], out(runs['details-turn-band'].stdout))
    const report = await validateRoot(w.ports, '/m/turn-band' as AbsolutePath)
    expect(report.ok && report.value.hasModule).toBe(true)
    const details = await detailsOf(w.ports, 'turn-band@fixtures' as PluginId)
    expect(details.ok && details.value.skills).toBe(0)
  })

  it('runs an op and parses its line', async () => {
    const w = world()
    w.process.when(['update'], out(runs['update-bumped'].stdout))
    const result = await runOp(w.ports, { op: 'update', id: 'quiet-bash@fixtures' as PluginId })
    expect(result.ok && result.value.status).toBe('done')
  })

  it('reads the CLI version', async () => {
    const w = world()
    w.process.when(['--version'], out('2.1.292 (Claude Code)\n'))
    expect(await cliVersion(w.ports)).toEqual({ ok: true, value: '2.1.292' })
  })

  it('reports an unreadable or failed version', async () => {
    const w = world()
    w.process.when(['--version'], out('Claude Code\n'))
    expect(!(await cliVersion(w.ports)).ok).toBe(true)
    w.process.when(['--version'], out('', 3))
    const failed = await cliVersion(w.ports)
    expect(!failed.ok && failed.error.kind).toBe('cli-failed')
  })
})
