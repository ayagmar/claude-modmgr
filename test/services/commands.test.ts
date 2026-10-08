// `/mods` as text over fake ports and the fixture CLI: the
// parser, the read-only answers, and writes that wait for their jobs.
import { describe, expect, it } from 'vitest'
import { parseModsArgs, USAGE } from '../../plugin/hooks/domain/command-args.ts'
import { DEFAULT_CONFIG } from '../../plugin/hooks/domain/config.ts'
import { modsCommand } from '../../plugin/hooks/services/commands.ts'
import { createRuntime } from '../../plugin/hooks/services/runtime.ts'
import { runs } from '../domain/fixtures/cli-runs.ts'
import { fixtureCli } from './cli-world.ts'
import { out, type World, world } from './fakes.ts'

const SHA = '5e549c09f0d775042a59d57dd4fc222b2d9ad6babc928bf603998e1661f65695'

const setup = async (more: (w: World) => void = () => {}) => {
  const w = world()
  fixtureCli(w.process)
  more(w)
  const rt = createRuntime(w.ports, DEFAULT_CONFIG, 'own')
  w.state.values.queue = { owner: 'own', jobs: [] }
  await rt.store.load()
  const run = (args: string) => modsCommand(w.ports, rt, args)
  return { w, rt, run }
}

describe('the arguments', () => {
  it('reads every subcommand and its flags', () => {
    const value = (args: string) => {
      const parsed = parseModsArgs(args)
      return parsed.ok ? parsed.value : parsed.error.message
    }
    expect(value('')).toEqual({ kind: 'open' })
    expect(value('help')).toEqual({ kind: 'help' })
    expect(value('list')).toEqual({ kind: 'list' })
    expect(value('doctor --json')).toEqual({ kind: 'doctor', json: true })
    expect(value('export')).toEqual({ kind: 'export' })
    expect(value('info tb@m')).toEqual({ kind: 'info', id: 'tb@m' })
    expect(value(`install tb@m --scope project --accept-command ${SHA} --yes`)).toEqual({
      kind: 'install',
      id: 'tb@m',
      scope: 'project',
      yes: true,
      acceptSha: SHA,
    })
    expect(value('install tb@m')).toEqual({
      kind: 'install',
      id: 'tb@m',
      scope: 'user',
      yes: false,
    })
    expect(value('remove tb@m --wipe-data --yes')).toEqual({
      kind: 'remove',
      id: 'tb@m',
      yes: true,
      wipe: true,
    })
    expect(value('update')).toEqual({ kind: 'update', yes: false })
    expect(value('update tb@m --yes')).toEqual({ kind: 'update', id: 'tb@m', yes: true })
    expect(value('enable tb@m --yes')).toEqual({ kind: 'enable', id: 'tb@m', yes: true })
    expect(value('disable tb@m')).toEqual({ kind: 'disable', id: 'tb@m', yes: false })
    expect(value('apply mods.json --yes')).toEqual({ kind: 'apply', file: 'mods.json', yes: true })
  })

  it('refuses what it can’t read', () => {
    const error = (args: string) => {
      const parsed = parseModsArgs(args)
      return parsed.ok ? 'parsed' : parsed.error.message
    }
    expect(error('frobnicate')).toBe('unknown subcommand frobnicate')
    expect(error('list extra')).toBe('unexpected extra')
    expect(error('info')).toMatch(/which mod/)
    expect(error('info Not-An-Id')).toBe('not a plugin id: Not-An-Id')
    expect(error('install tb@m --scope managed')).toMatch(/user, project or local/)
    expect(error('install tb@m --accept-command abc')).toMatch(/sha256/)
    expect(error('install tb@m --scope')).toBe('--scope needs a value')
    expect(error('remove tb@m --force')).toBe('unknown option --force')
    // A flag a subcommand doesn't read is refused, never dropped.
    expect(error('enable tb@m --scope local')).toBe("--scope doesn't apply to enable")
    expect(error('remove tb@m --accept-command x')).toBe("--accept-command doesn't apply to remove")
    expect(error('install tb@m --wipe-data')).toBe("--wipe-data doesn't apply to install")
    expect(error('apply f.json --accept-command x --yes')).toBe(
      "--accept-command doesn't apply to apply",
    )
    expect(error('list --json')).toBe("--json doesn't apply to list")
    expect(error('apply')).toMatch(/which file/)
  })
})

describe('/mods as text', () => {
  it('opens the dialog bare, or lists where no pane is placed', async () => {
    const { w, run } = await setup()
    expect(await run('')).toEqual({})
    expect(w.ui.opens).toHaveLength(1)
    w.ui.placed = false
    const listed = await run('')
    expect(listed.text?.split('\n')[0]).toBe('5 mods (5 on)')
  })

  it('answers help, usage errors and an unstarted modmgr', async () => {
    const { w } = await setup()
    expect(await modsCommand(w.ports, undefined, 'help')).toEqual({ text: USAGE })
    expect(await modsCommand(w.ports, undefined, 'frob')).toEqual({
      text: `unknown subcommand frob\n\n${USAGE}`,
      exitCode: 2,
    })
    expect(await modsCommand(w.ports, undefined, 'list')).toEqual({
      text: 'modmgr is still starting; try again in a moment.',
      exitCode: 1,
    })
  })

  it('lists, details, exports and doctors', async () => {
    const { run } = await setup()
    expect((await run('list')).text).toContain('●  turn-band  0.3.1  user')
    const info = (await run('info turn-band@fixtures')).text ?? ''
    expect(info.split('\n').slice(0, 2)).toEqual([
      'turn-band 0.3.1',
      'turn-band@fixtures · user · on',
    ])
    expect(info).toContain('ui.render')
    expect(await run('info nosuch@x')).toEqual({
      text: 'nosuch@x is not an installed mod.',
      exitCode: 1,
    })
    const exported = JSON.parse((await run('export')).text ?? '') as { mods: { id: string }[] }
    expect(exported.mods.map(mod => mod.id)).toContain('turn-band@fixtures')
    const doctor = await run('doctor --json')
    const report = JSON.parse(doctor.text ?? '') as { problems: number; items: unknown[] }
    // The broken fixture's validate errors.
    expect(report.problems).toBeGreaterThan(0)
    expect(doctor.exitCode).toBe(1)
    expect((await run('doctor')).text).toMatch(/^\d+ problems?\n/)
  })

  it('says what a write would run without --yes, and runs it with', async () => {
    const { w, run } = await setup()
    const dry = await run('disable turn-band@fixtures')
    expect(dry).toEqual({
      text: 'This would run:\n  claude plugin disable turn-band@fixtures --scope user --json\nAdd --yes to run it.',
      exitCode: 1,
    })
    expect(w.state.values.queue.jobs).toEqual([])
    const done = await run('disable turn-band@fixtures --yes')
    expect(done.exitCode).toBeUndefined()
    expect(done.text).toBe(
      '✓ disable turn-band@fixtures: Successfully disabled plugin: turn-band@fixtures\nRun /reload-plugins (or restart Claude Code) to apply.',
    )
    // No reload from a command (it would reject there).
    expect(w.state.values.queue.jobs.some(job => job.kind === 'reload')).toBe(false)
    expect(w.state.values.attention.reloadPending).toBe(true)
  })

  it('says why a write can’t, and when there is nothing to do', async () => {
    const { run } = await setup()
    expect(await run('enable turn-band@fixtures --yes')).toEqual({
      text: 'turn-band is already on.',
    })
    expect(await run('remove nosuch@x --yes')).toEqual({
      text: 'nosuch@x is not an installed mod.',
      exitCode: 1,
    })
    // Folder-marketplace mods don't update through the CLI (they run from their folder).
    expect((await run('update turn-band@fixtures --yes')).text).toMatch(
      /runs from its marketplace folder/,
    )
    expect(await run('update --yes')).toEqual({
      text: 'None of these mods updates through the CLI.',
    })
  })

  it('removes keeping the data unless asked, and installs at a scope', async () => {
    const { w, run } = await setup()
    await run('remove quiet-bash@fixtures --yes')
    expect(
      w.process.calls.some(call =>
        call.argv.join(' ').includes('uninstall quiet-bash@fixtures --scope user --keep-data'),
      ),
    ).toBe(true)
    await run('install aws@official --scope project --yes')
    expect(
      w.process.calls.some(
        call => call.argv.join(' ') === 'claude plugin install aws@official --scope project --json',
      ),
    ).toBe(true)
  })

  it('shows a declared command whole, with how to accept it', async () => {
    const { w, run } = await setup(w => {
      w.process.when(['install'], out(runs['install-command-refused'].stdout, 1))
    })
    const answer = await run('install cmdmod@cmdmkt --yes')
    expect(answer.exitCode).toBe(1)
    expect(answer.text).toContain('It runs this command, shown as the marketplace declares it:')
    expect(answer.text).toContain(
      `To run it: /mods install cmdmod@cmdmkt --accept-command ${SHA} --yes`,
    )
    expect(w.state.values.queue.jobs.at(-1)?.shown?.sha256).toBe(SHA)
  })

  it('applies a file: installs what is missing, enables what is off', async () => {
    const { w, run } = await setup(w => {
      w.fs.files.set(
        '/repo/mods.json',
        JSON.stringify({
          mods: [
            { id: 'turn-band@fixtures', scope: 'user' },
            { id: 'aws@official', scope: 'user' },
          ],
        }),
      )
      w.fs.files.set('/repo/bad.json', '{"mods": [{ "id": "nope" }]}')
    })
    const dry = await run('apply /repo/mods.json')
    expect(dry.text).toBe(
      'This would run:\n  claude plugin install aws@official --scope user --json\nAdd --yes to run it.',
    )
    expect((await run('apply /repo/bad.json')).exitCode).toBe(1)
    expect((await run('apply /repo/missing.json')).text).toMatch(
      /^Couldn't read \/repo\/missing.json: ENOENT/,
    )
    await run('apply /repo/mods.json --yes')
    expect(
      w.process.calls.some(call =>
        call.argv.join(' ').startsWith('claude plugin install aws@official'),
      ),
    ).toBe(true)
  })

  it('needs the CLI to change anything', async () => {
    const { w, run } = await setup()
    w.state.values.degraded = {
      process: true,
      network: false,
      acceptCommand: false,
      reason: 'no claude CLI',
    }
    expect(await run('disable turn-band@fixtures --yes')).toEqual({
      text: 'no claude CLI\nChanging mods needs the claude CLI.',
      exitCode: 1,
    })
  })

  it('covers the rest of what it says', async () => {
    const { w, run } = await setup(w => {
      w.process.when(['list', '--json'], () => {
        const list = JSON.parse(runs.list.stdout) as unknown[]
        const inline = {
          id: 'qb@inline',
          version: '0.2.0',
          scope: 'session',
          enabled: true,
          installPath: '/dev/quiet-bash',
        }
        return out(JSON.stringify([...list, inline]))
      })
      w.fs.files.set('/repo/same.json', JSON.stringify({ mods: [{ id: 'turn-band@fixtures' }] }))
      w.fs.files.set('/repo/off.json', JSON.stringify({ mods: [{ id: 'redactor@fixtures' }] }))
    })
    // A launch-command mod: the CLI can't change it.
    expect((await run('disable qb@inline --yes')).text).toMatch(
      /^qb: loaded from CLAUDE_CODE_PLUGIN_DIRS/,
    )
    expect((await run('update nosuch@x --yes')).exitCode).toBe(1)
    expect((await run('update qb@inline --yes')).exitCode).toBe(1)
    expect(await run('apply /repo/same.json --yes')).toEqual({
      text: 'Nothing to do: 1 already so.',
    })
    // Already off: said, nothing queued.
    w.state.values.mods = w.state.values.mods.map(item =>
      item.id === 'redactor@fixtures' ? { ...item, enabled: false } : item,
    )
    expect(await run('disable redactor@fixtures --yes')).toEqual({
      text: 'redactor is already off.',
    })
    // Off: apply enables it at its own scope.
    expect((await run('apply /repo/off.json')).text).toContain(
      'claude plugin enable redactor@fixtures --scope project --json',
    )
    // An install that accepts a declared command passes its sha.
    await run(`install cmdmod@cmdmkt --accept-command ${SHA} --yes`)
    expect(
      w.process.calls.some(
        call => call.argv.includes('--accept-command') && call.argv.includes(SHA),
      ),
    ).toBe(true)
    // An update a check found shows in info.
    w.state.values.mods = w.state.values.mods.map(item =>
      item.id === 'turn-band@fixtures' ? { ...item, updateTo: '9.0.0' } : item,
    )
    expect((await run('info turn-band@fixtures')).text).toContain('↑ 9.0.0 is available')
  })

  it('says when the installed list can’t be read, and a doctor with nothing wrong exits 0', async () => {
    const failing = await setup(w => {
      w.process.when(['list', '--json'], out('', 1, 'settings unreadable'))
    })
    expect(await failing.run('list')).toEqual({
      text: "Couldn't read your plugins: settings unreadable",
      exitCode: 1,
    })
    const empty = await setup(w => {
      w.process.when(['list', '--json'], out('[]'))
    })
    const doctor = await empty.run('doctor')
    expect(doctor.exitCode).toBeUndefined()
    expect(doctor.text?.split('\n')[0]).toBe('✓ Nothing needs you.')
  })
})
