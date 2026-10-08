// Dev over fake ports: its sources (folder-marketplace, inline and
// skills-dir installs, this session's mods folder, `--plugin-dir` plugins
// found where the session runs or through a failure), validate and test as
// jobs, the failures the session reports, sharing, and the actions around them.
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../../plugin/hooks/domain/config.ts'
import { createActions } from '../../plugin/hooks/services/actions.ts'
import { FAILURES_KEPT } from '../../plugin/hooks/services/dev.ts'
import { background, onNotice } from '../../plugin/hooks/services/lifecycle.ts'
import { createRuntime } from '../../plugin/hooks/services/runtime.ts'
import { runs } from '../domain/fixtures/cli-runs.ts'
import { fixtureCli } from './cli-world.ts'
import { type FakeProcess, out, type SessionFacts, type World, world } from './fakes.ts'

const MKT = '/tmp/modmgr-fixtures/mkt'
const REPO = '/home/me/modmgr'
const SESSION = '/cfg/dev-mods/session-1'

/** The fixture list, plus a `CLAUDE_CODE_PLUGIN_DIRS` folder. */
const devCli = (process: FakeProcess): FakeProcess =>
  fixtureCli(process).when(['list', '--json'], () => {
    const list = JSON.parse(runs.list.stdout) as Array<Record<string, unknown>>
    const inline = {
      id: 'qb@inline',
      version: '0.2.0',
      scope: 'session',
      enabled: true,
      installPath: '/dev/qb',
    }
    return out(JSON.stringify([...list, inline]))
  })

const setup = async (
  more: (w: World) => void = () => {},
  session: SessionFacts = { root: REPO, cwd: REPO, id: 'session-1' },
) => {
  const w = world({ env: { CLAUDE_CONFIG_DIR: '/cfg' }, session })
  devCli(w.process)
  // modmgr runs from its repository with --plugin-dir; the repository is its marketplace.
  w.command.commands = [
    { name: 'mods', description: '', source: 'plugin', plugin: 'modmgr' },
    { name: 'diff', description: '', source: 'plugin', plugin: 'cc-plugin-diff' },
    { name: 'help', description: '', source: 'builtin' },
  ]
  w.fs.files.set(
    `${REPO}/.claude-plugin/marketplace.json`,
    JSON.stringify({ name: 'modmgr', plugins: [{ name: 'modmgr', source: './plugin' }] }),
  )
  w.fs.files.set(`${REPO}/plugin/.claude-plugin/plugin.json`, '{"name":"modmgr","version":"0.1.0"}')
  w.fs.dirs.set(SESSION, [
    { name: 'fresh', kind: 'dir' },
    { name: 'notes.md', kind: 'file' },
    { name: 'empty', kind: 'dir' },
  ])
  w.fs.files.set(`${SESSION}/fresh/.claude-plugin/plugin.json`, '{"name":"fresh"}')
  more(w)
  const rt = createRuntime(w.ports, DEFAULT_CONFIG, 'own')
  w.state.values.queue = { owner: 'own', jobs: [] }
  await rt.store.load()
  await rt.registry.refresh()
  await w.ui.open({ id: 'modmgr', title: 'mods', closeOnEscape: true })
  const act = createActions(w.ports, rt)
  const drain = async () => {
    await w.clock.advance(0)
    await rt.runner.whenIdle()
    await w.clock.advance(0)
    await rt.runner.whenIdle()
  }
  return { w, rt, act, drain }
}

const names = (w: World) => w.state.values.dev.rows.map(row => `${row.how} ${row.name}`)

describe('Dev’s sources', () => {
  it('lists folder installs, this session’s mods folder and a --plugin-dir found in its repository', async () => {
    const { w, act } = await setup()
    await act.tab('dev')
    expect(names(w)).toEqual([
      'session-folder fresh',
      'plugin-dir modmgr',
      'env-dir qb',
      // broken: validate couldn't read it, and Dev is where it shows.
      'folder-marketplace broken',
      'folder-marketplace quiet-bash',
      'folder-marketplace redactor',
      'folder-marketplace spawner',
      'folder-marketplace turn-band',
    ])
    const modmgr = w.state.values.dev.rows.find(row => row.name === 'modmgr')
    expect(modmgr).toMatchObject({ path: `${REPO}/plugin`, version: '0.1.0', enabled: true })
    expect(w.state.values.dev.rows.find(row => row.name === 'turn-band')?.path).toBe(
      `${MKT}/turn-band`,
    )
    expect(w.state.values.dev.loading).toBe(false)
    // A built-in plugin's command (cc-plugin-diff) has no folder here: no row.
    expect(names(w).some(name => name.includes('cc-plugin'))).toBe(false)
  })

  it('finds a --plugin-dir folder that is the session’s own, and no mods folder without a config dir', async () => {
    const { w, rt } = await setup(
      w => {
        w.ports.env = {
          ...w.ports.env,
          configDir: async () => undefined,
          home: async () => undefined,
        }
        w.fs.files.set('/work/tally/.claude-plugin/plugin.json', '{"name":"tally"}')
        w.command.commands = [{ name: 't', description: '', source: 'plugin', plugin: 'tally' }]
      },
      { root: '/work/tally', cwd: '/work/tally', id: 'session-1' },
    )
    await rt.dev.refresh()
    expect(names(w)).toContain('plugin-dir tally')
    expect(names(w)).not.toContain('session-folder fresh')
  })

  it('lists what it can when the environment and the session refuse to say', async () => {
    const reject = async (): Promise<never> => {
      throw new Error('refused')
    }
    const { w, rt } = await setup(w => {
      w.ports.env = { ...w.ports.env, configDir: reject, home: reject }
      w.ports.session = { ...w.ports.session, id: reject, cwd: reject, root: reject }
    })
    await rt.dev.refresh()
    expect(names(w)).toContain('env-dir qb')
    expect(names(w).some(name => name.startsWith('session-folder'))).toBe(false)
    expect(names(w).some(name => name.startsWith('plugin-dir'))).toBe(false)
  })

  it('reads the installed list first when it hasn’t been, and one refresh at a time', async () => {
    const w = world({ session: { root: REPO, id: 'session-1' } })
    devCli(w.process)
    const rt = createRuntime(w.ports, DEFAULT_CONFIG, 'own')
    await rt.store.load()
    await Promise.all([rt.dev.refresh(), rt.dev.refresh(), rt.dev.refresh()])
    expect(names(w)).toContain('env-dir qb')
    // One list for the registry, then one more refresh queued behind the first.
    expect(w.process.calls.filter(call => call.argv[2] === 'list')).toHaveLength(1)
  })

  it('stops loading when a refresh fails, and says so in the debug log', async () => {
    const { w, rt } = await setup()
    w.state.failWrites = false
    w.ports.command = {
      ...w.ports.command,
      list: async () => {
        throw new Error('no commands')
      },
    }
    // A state read that throws mid-refresh.
    const read = w.state.read
    w.state.read = async key => {
      if (key === 'dev') throw new Error('state gone')
      return read(key)
    }
    await rt.dev.refresh()
    expect(w.state.values.dev.loading).toBe(false)
    expect(w.ui.lines.some(line => line.includes('dev refresh failed'))).toBe(true)
  })
})

describe('validate and test (v, t)', () => {
  it('validates the selected folder strictly, as a job, and Installed reads it again', async () => {
    const { w, act, drain, rt } = await setup()
    await act.tab('dev')
    await act.focusDev(`${MKT}/turn-band`)
    const analysedBefore = Object.keys(rt.store.get('validate')).filter(key =>
      key.startsWith(`${MKT}/turn-band@`),
    )
    expect(analysedBefore).toHaveLength(1)
    await act.devRun('validate')
    // A second press while it runs queues nothing more.
    await act.devRun('validate')
    expect(w.state.values.view.notice).toMatch(/being validated already/)
    await drain()
    const job = w.state.values.queue.jobs.find(item => item.kind === 'validate')
    expect(job).toMatchObject({
      state: 'ok',
      target: 'turn-band@fixtures',
      args: { path: `${MKT}/turn-band` },
      report: { errors: 0, warnings: 0 },
    })
    expect(w.state.values.queue.jobs.filter(item => item.kind === 'validate')).toHaveLength(1)
    // No reload for a validate.
    expect(w.state.values.queue.jobs.some(item => item.kind === 'reload')).toBe(false)
    const strict = w.process.calls.filter(call => call.argv.includes('--strict'))
    expect(strict.map(call => call.argv.at(-1))).toEqual([`${MKT}/turn-band`])
    // The cached analysis was dropped and read again by the refresh that followed.
    await w.clock.advance(0)
    const validates = w.process.calls.filter(
      call =>
        call.argv[2] === 'validate' &&
        !call.argv.includes('--strict') &&
        call.argv.at(-1) === `${MKT}/turn-band`,
    )
    expect(validates.length).toBeGreaterThanOrEqual(2)
  })

  it('records a failed validate’s counts', async () => {
    const { w, act, drain } = await setup()
    await act.tab('dev')
    await act.devRun('validate', `${MKT}/broken`)
    await drain()
    const job = w.state.values.queue.jobs.find(item => item.kind === 'validate')
    expect(job?.state).toBe('failed')
    expect(job?.report?.errors).toBeGreaterThan(0)
    expect(job?.error?.message).toMatch(/1 validate error/)
  })

  it('tests a folder, streamed, and a second press waits for the first', async () => {
    const { w, act, drain } = await setup()
    w.process.spawnScript = {
      chunks: [
        { stream: 'stdout', text: '(pass) one\n' },
        { waitMs: 50 },
        { stream: 'stdout', text: '1 pass\n' },
      ],
      result: { code: 0, signal: null },
    }
    await act.tab('dev')
    await act.devRun('test', '/dev/qb')
    await act.devRun('test', '/dev/qb')
    expect(w.state.values.view.notice).toMatch(/its tests are already/)
    await w.clock.advance(100)
    await drain()
    expect(w.process.spawns.map(call => call.argv.join(' '))).toEqual([
      'claude plugin test /dev/qb',
    ])
    const job = w.state.values.queue.jobs.find(item => item.kind === 'test')
    expect(job).toMatchObject({ state: 'ok', target: 'qb@inline', tail: ['(pass) one', '1 pass'] })
  })

  it('does nothing for a key it doesn’t list', async () => {
    const { w, act } = await setup()
    await act.tab('dev')
    await act.devRun('test', '/nowhere')
    expect(w.state.values.queue.jobs).toEqual([])
  })
})

describe('failures the session reports', () => {
  const broken = '/dev/broken2'
  const notice = (text: string) => [{ type: 'text', text }]

  it('counts a failing plugin, and a --plugin-dir folder it names joins Dev', async () => {
    const { w, rt, act } = await setup(w => {
      w.fs.files.set(`${broken}/.claude-plugin/plugin.json`, '{"name":"broken2"}')
    })
    await act.tab('dev')
    onNotice(rt, notice(`broken2: hooks module did not load: ${broken}/hooks/register.ts, line 3`))
    await w.clock.advance(0)
    expect(w.state.values.dev.failures.broken2).toMatchObject({ count: 1, folder: broken })
    expect(names(w)).toContain('plugin-dir broken2')
    // Not failures: a reload's line, a non-text block.
    onNotice(rt, notice('modmgr: reloaded (8 hooks: session.start)'))
    onNotice(rt, [{ type: 'image' }])
    onNotice(undefined, notice('x: failed'))
    await w.clock.advance(0)
    expect(Object.keys(w.state.values.dev.failures)).toEqual(['broken2'])
  })

  it('keeps the selection when a failing folder joins above it (found live)', async () => {
    const { w, rt, act } = await setup(w => {
      w.fs.files.set(`${broken}/.claude-plugin/plugin.json`, '{"name":"aaa"}')
      // No mods folder: modmgr (--plugin-dir) is the first row.
      w.fs.dirs.clear()
    })
    await act.tab('dev')
    const shown = w.state.values.dev.rows[0]?.key
    expect(shown).toBe(`${REPO}/plugin`)
    expect(w.state.values.view.dev).toBe(shown)
    onNotice(rt, notice(`aaa: hooks module did not load: ${broken}/hooks/register.ts`))
    await w.clock.advance(0)
    expect(w.state.values.dev.rows[0]?.name).toBe('aaa')
    expect(w.state.values.view.dev).toBe(shown)
  })

  it('keeps the newest failing plugins only', async () => {
    const { w, rt } = await setup()
    for (let i = 0; i <= FAILURES_KEPT; i += 1) {
      await w.clock.advance(1)
      await rt.dev.notice(`p${i}: tool.call hook failed`)
    }
    const kept = Object.keys(w.state.values.dev.failures)
    expect(kept).toHaveLength(FAILURES_KEPT)
    expect(kept).not.toContain('p0')
  })
})

describe('sharing (p)', () => {
  it('names the repository and finds the marketplace file at its root', async () => {
    const { w, act } = await setup(() => {}, {
      root: REPO,
      cwd: REPO,
      id: 'session-1',
      repo: { root: REPO, remote: 'git@github.com:me/modmgr.git', internal: false, name: null },
    })
    await act.tab('dev')
    await act.share(`${REPO}/plugin`)
    expect(w.state.values.view.stack).toEqual(['share'])
    expect(w.state.values.dev.share).toEqual({
      key: `${REPO}/plugin`,
      name: 'modmgr',
      line: '/plugin install modmgr --marketplace me/modmgr',
      complete: true,
      notes: [],
    })
    expect(w.ui.focuses.at(-1)).toBe('modmgr:act:copy')
  })

  it('offers the marketplace file to write when nothing lists the mod', async () => {
    const { w, act } = await setup()
    await act.tab('dev')
    await act.share(`${SESSION}/fresh`)
    const share = w.state.values.dev.share
    expect(share?.complete).toBe(false)
    expect(share?.notes[0]).toMatch(/mods folder/)
    expect(share?.snippet).toContain('"source": "./"')
    // Esc pops it like any overlay.
    await act.back()
    expect(w.state.values.view.stack).toEqual([])
  })
})

describe('the pane on Dev', () => {
  it('moves the selection, opens a detail and refreshes', async () => {
    const { w, act } = await setup()
    await act.tab('dev')
    await act.edge('last')
    expect(w.state.values.view.dev).toBe(`${MKT}/turn-band`)
    expect(w.ui.focuses.at(-1)).toBe(`modmgr:dev:${MKT}/turn-band`)
    await act.edge('first')
    expect(w.state.values.view.dev).toBe(`${SESSION}/fresh`)
    await act.focusDev(`${SESSION}/fresh`)
    await act.openDev('/dev/qb')
    expect(w.state.values.view).toMatchObject({ dev: '/dev/qb', stack: ['detail'] })
    expect(w.ui.focuses.at(-1)).toBe('modmgr:act:validate')
    await act.back()
    expect(w.ui.focuses.at(-1)).toBe('modmgr:dev:/dev/qb')
    const lists = () => w.process.calls.filter(call => call.argv[2] === 'list').length
    const before = lists()
    await act.refresh()
    expect(lists()).toBe(before + 1)
  })

  it('reads Dev again when a reloaded modmgr starts with it showing', async () => {
    const { w, rt } = await setup()
    w.state.values.view = { ...w.state.values.view, tab: 'dev' }
    w.state.values.dev = { rows: [], failures: {}, loading: false }
    await background(rt, { fresh: false })
    expect(names(w)).toContain('env-dir qb')
  })

  it('without rows, edge does nothing', async () => {
    const w = world({ session: { root: '/nowhere', id: 'session-1' } })
    w.process.when(['list', '--json'], out('[]')).when(['--version'], out('2.1.292'))
    const rt = createRuntime(w.ports, DEFAULT_CONFIG, 'own')
    await rt.store.load()
    const act = createActions(w.ports, rt)
    await act.tab('dev')
    await act.edge('first')
    expect(w.state.values.dev.rows).toEqual([])
    expect(w.state.values.view.dev).toBeUndefined()
  })
})
