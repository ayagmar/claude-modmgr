// M4 over fake ports: the catalogue in module memory with a window in
// `$.state`, the detector's budget, idle rule, backoff and cache, and the
// install, declared-command and marketplace flows through the review.
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../../plugin/hooks/domain/config.ts'
import { createActions } from '../../plugin/hooks/services/actions.ts'
import { createCatalog } from '../../plugin/hooks/services/catalog.ts'
import { createDetector } from '../../plugin/hooks/services/detector.ts'
import { createRuntime } from '../../plugin/hooks/services/runtime.ts'
import { createStore } from '../../plugin/hooks/services/store.ts'
import { runs } from '../domain/fixtures/cli-runs.ts'
import { fixtureCli } from './cli-world.ts'
import { type FakeProcess, out, type World, world } from './fakes.ts'

const AWS = 'aws-serverless@claude-plugins-official'
const AWS_BASE =
  'https://raw.githubusercontent.com/awslabs/agent-plugins/097fe8ad56d8a1d5e2c81d7880adf145553cf244/plugins/aws-serverless/'
const SDK = 'agent-sdk-dev@claude-plugins-official'
const OFFICIAL = '/tmp/modmgr-fixtures/config/plugins/marketplaces/claude-plugins-official'
const CMD = 'cmdmod@cmdmkt'
const MODS_JSON = '{"modules":["./register.ts"]}'

/** The catalogue a session reads: `list --available` and `marketplace list`. */
const catalogCli = (process: FakeProcess): FakeProcess =>
  fixtureCli(process)
    .when(['list', '--json', '--available'], out(runs['list-available'].stdout))
    .when(['marketplace', 'list'], out(runs['marketplace-list'].stdout))

const setup = async (more: (w: World) => void = () => {}, env: Record<string, string> = {}) => {
  const w = world({ env })
  catalogCli(w.process)
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
    await w.clock.advance(2000)
    await rt.runner.whenIdle()
    await w.clock.advance(0)
  }
  const argvs = () => w.process.calls.map(call => call.argv.slice(2).join(' '))
  return { w, rt, act, drain, argvs }
}

describe('the catalogue', () => {
  it('opens Discover by reading it once, keeping only a window in $.state', async () => {
    const { w, act, rt } = await setup()
    await act.tab('discover')
    await act.cycleKind() // hooks
    await act.cycleKind() // all
    const page = w.state.values.catalogPage
    expect(page.total).toBe(201)
    expect(page.matched).toBe(201)
    expect(page.rows.length).toBeLessThanOrEqual(50)
    expect(page.loading).toBe(false)
    // The first visit read it; a second visit within hours does not.
    await act.tab('installed')
    await act.tab('discover')
    expect(w.process.calls.filter(call => call.argv.includes('--available'))).toHaveLength(1)
    expect(rt.catalog.rootOf('claude-plugins-official')).toBe(OFFICIAL)
    expect(rt.catalog.folderOf(SDK)).toBe(`${OFFICIAL}/plugins/agent-sdk-dev/`)
    expect(rt.catalog.folderOf(AWS)).toBeUndefined()
    expect(rt.catalog.folderOf('nosuch@x')).toBeUndefined()
  })

  it('searches, sorts and moves its window with the selection', async () => {
    const { w, act } = await setup()
    await act.tab('discover')
    await act.cycleKind()
    await act.cycleKind()
    await act.filter('aws')
    expect(w.state.values.view.search).toBe('aws')
    expect(w.state.values.catalogPage.rows.map(row => row.id)).toContain(AWS)
    await act.filter('')
    await act.cycleSort() // name → marketplace
    expect(w.state.values.view.sort).toBe('marketplace')
    await act.edge('last')
    const page = w.state.values.catalogPage
    expect(page.offset).toBe(page.matched - page.rows.length)
    expect(w.state.values.view.found).toBe(page.rows.at(-1)?.id)
    expect(w.ui.focuses.at(-1)).toBe(`modmgr:found:${page.rows.at(-1)?.id}`)
    const middle = page.rows[3]?.id ?? ''
    await act.focusFound(middle)
    expect(w.state.values.view.found).toBe(middle)
    // The detector writes its progress meanwhile; the selection isn't written again.
    const views = () => w.state.writes.filter(key => key === 'view').length
    const before = views()
    await act.focusFound(middle)
    expect(views()).toBe(before)
  })

  it('says what failed, and r reads it again', async () => {
    const { w, act } = await setup(world =>
      world.process.when(['list', '--json', '--available'], out('', 1, 'boom')),
    )
    await act.tab('discover')
    expect(w.state.values.catalogPage).toMatchObject({ loading: false, error: 'boom' })
    w.process.when(['list', '--json', '--available'], out(runs['list-available'].stdout))
    await act.refresh()
    expect(w.state.values.catalogPage.error).toBeUndefined()
    expect(w.state.values.catalogPage.total).toBe(201)
  })

  it('a local entry is read before installing: the detail and the review say what it can do', async () => {
    const { w, act, rt } = await setup(world =>
      world.process.when(['validate'], argv =>
        argv.at(-1) === `${OFFICIAL}/plugins/agent-sdk-dev`
          ? out(runs['validate-spawner'].stdout)
          : undefined,
      ),
    )
    await act.tab('discover')
    await act.cycleKind()
    await act.cycleKind()
    await act.openFound(SDK)
    expect(w.state.values.view.stack).toEqual(['detail'])
    // Read in the background (R-M4-1): the detail redraws when it lands.
    await rt.catalog.inspect(SDK)
    expect(w.state.values.catalogPage.rows.find(row => row.id === SDK)?.notable).toContain(
      'starts-model-calls',
    )
    await act.install()
    expect(w.state.values.review?.action).toBe('install')
    expect(w.state.values.review?.notable).toContain(
      'agent-sdk-dev: Starts model calls (costs tokens)',
    )
    expect(w.state.values.review?.uninspected).toBeUndefined()
    // Read once per version.
    await rt.catalog.inspect(SDK)
    expect(w.process.calls.filter(call => call.argv.includes('validate')).length).toBeLessThan(10)
    expect(await rt.catalog.inspect('nosuch@x')).toBeUndefined()
  })
})

describe('the detector', () => {
  const detectorWorld = async (budget?: number, remote = true) => {
    const w = world()
    catalogCli(w.process)
    const store = createStore(w.ports)
    await store.load()
    const catalog = createCatalog(w.ports, store)
    await catalog.load()
    const detector = createDetector(w.ports, {
      store,
      catalog,
      remoteAllowed: async () => remote,
      ...(budget === undefined ? {} : { budget }),
    })
    const run = async () => {
      detector.start()
      for (let i = 0; i < 10; i += 1) await w.clock.advance(0)
      await detector.whenIdle()
    }
    return { w, store, catalog, detector, run }
  }

  it('finds a mod at its pinned commit, caches it, and counts it', async () => {
    const { w, store, catalog, run } = await detectorWorld()
    w.http.answers.set(`${AWS_BASE}hooks/hooks.json`, { status: 200, text: MODS_JSON })
    w.fs.files.set(`${OFFICIAL}/plugins/agent-sdk-dev/hooks/hooks.json`, MODS_JSON)
    await run()
    expect(catalog.kindOf(AWS)).toBe('mod')
    expect(catalog.kindOf(SDK)).toBe('mod')
    expect(store.get('detect')[AWS]?.[0]).toBe('097fe8ad56d8a1d5e2c81d7880adf145553cf244')
    // A command source can never be checked: it isn't counted (R-M4-6).
    expect(w.state.values.detect).toMatchObject({ found: 2, running: false, total: 200 })
    // A 404 hooks.json falls back to the manifest.
    expect(w.http.gets).toContain(
      'https://raw.githubusercontent.com/42Crunch-AI/claude-plugins/faf5305385de8afed9468904e8639be737aff39e/plugins/api-security-testing/.claude-plugin/plugin.json',
    )
    // Known kinds aren't probed again.
    const gets = w.http.gets.length
    await run()
    expect(w.http.gets.length).toBe(gets)
  })

  it('stops at its budget', async () => {
    const { w, run, detector } = await detectorWorld(5)
    await run()
    expect(w.http.gets.length).toBeLessThanOrEqual(5 + 6)
    expect(detector.spent()).toBe(w.http.gets.length)
  })

  it('waits while a turn runs', async () => {
    const { w, detector } = await detectorWorld(20)
    detector.setBusy(true)
    detector.start()
    for (let i = 0; i < 5; i += 1) await w.clock.advance(0)
    expect(w.http.gets).toEqual([])
    detector.setBusy(false)
    for (let i = 0; i < 10; i += 1) await w.clock.advance(0)
    await detector.whenIdle()
    expect(w.http.gets.length).toBeGreaterThan(0)
  })

  it('backs off when asked to slow down, then retries', async () => {
    const { w, catalog, detector } = await detectorWorld()
    let asked = 0
    w.http.get = async url => {
      w.http.gets.push(url)
      if (url === `${AWS_BASE}hooks/hooks.json`) {
        asked += 1
        return asked === 1 ? { status: 429, text: '' } : { status: 200, text: MODS_JSON }
      }
      return { status: 404, text: '' }
    }
    detector.start()
    for (let i = 0; i < 10; i += 1) await w.clock.advance(0)
    await w.clock.advance(10_000)
    await detector.whenIdle()
    expect(asked).toBe(2)
    expect(catalog.kindOf(AWS)).toBe('mod')
  })

  it('stays off the network when told to, and still reads local catalogues', async () => {
    const { w, catalog, run } = await detectorWorld(undefined, false)
    w.fs.files.set(`${OFFICIAL}/plugins/agent-sdk-dev/hooks/hooks.json`, '{"hooks":{}}')
    await run()
    expect(w.http.gets).toEqual([])
    expect(catalog.kindOf(SDK)).toBe('hooks')
  })

  it('a failing network read is a server error, retried later', async () => {
    const { w, detector } = await detectorWorld(12)
    w.http.get = async url => {
      w.http.gets.push(url)
      throw new Error('offline')
    }
    detector.start()
    for (let i = 0; i < 10; i += 1) await w.clock.advance(0)
    await w.clock.advance(60_000)
    await detector.whenIdle()
    expect(w.state.values.detect.running).toBe(false)
    detector.dispose()
    detector.start()
  })
})

describe('installing', () => {
  it('reviews, picks a scope, installs, reloads and can be undone', async () => {
    const { w, act, drain, argvs } = await setup()
    await act.tab('discover')
    await act.cycleKind()
    await act.cycleKind()
    await act.install(AWS)
    expect(w.state.values.review).toMatchObject({
      action: 'install',
      targets: [{ id: AWS, op: 'install', scope: 'user' }],
      uninspected: true,
    })
    await act.scope('project')
    await act.scope('nonsense')
    expect(w.state.values.review).toMatchObject({
      targets: [{ scope: 'project' }],
      changesRepoFile: true,
    })
    await act.confirm()
    await drain()
    expect(argvs()).toContain(`install ${AWS} --scope project --json`)
    expect(w.command.reloads).toBe(1)
    // The catalogue is read again: what is installed leaves it.
    expect(w.process.calls.filter(call => call.argv.includes('--available'))).toHaveLength(2)
    await act.undo()
    expect(w.state.values.view.notice).toBe('Undoing the last batch (1)')
  })

  it('a declared command stops the install; v shows it verbatim; y accepts that very command', async () => {
    const { w, act, drain, argvs } = await setup(world =>
      world.process.when(['install', CMD], argv =>
        argv.includes('--accept-command')
          ? out(runs['install-ok-user'].stdout.replaceAll('turn-band@fixtures', CMD))
          : out(runs['install-command-refused'].stdout, 1),
      ),
    )
    await act.tab('discover')
    await act.cycleKind()
    await act.cycleKind()
    await act.install(CMD)
    await act.confirm()
    await drain()
    const stopped = w.state.values.queue.jobs.find(job => job.kind === 'install')
    expect(stopped).toMatchObject({
      state: 'failed',
      error: { kind: 'conflict' },
      shown: { kind: 'command_source', command: '/tmp/modmgr-fixtures/emit.sh' },
    })
    expect(w.command.reloads).toBe(0)
    await act.acceptShown()
    expect(w.state.values.review).toMatchObject({
      action: 'install',
      declaredCommand: { text: '/tmp/modmgr-fixtures/emit.sh' },
    })
    await act.confirm()
    await drain()
    expect(argvs()).toContain(
      `install ${CMD} --scope user --accept-command 5e549c09f0d775042a59d57dd4fc222b2d9ad6babc928bf603998e1661f65695 --json`,
    )
    expect(w.command.reloads).toBe(1)
    await act.acceptShown()
    expect(w.state.values.view.notice).toBe('Nothing waits for a command to be reviewed')
  })

  it('an acceptance Claude Code refuses from here marks the session', async () => {
    const { w, act, drain } = await setup(world =>
      world.process.when(['install', CMD], argv =>
        argv.includes('--accept-command')
          ? out('--accept-command is ignored inside a Claude Code session\n', 1)
          : out(runs['install-command-refused'].stdout, 1),
      ),
    )
    await act.tab('discover')
    await act.install(CMD)
    await act.confirm()
    await drain()
    await act.acceptShown()
    await act.confirm()
    await drain()
    expect(w.state.values.degraded.acceptCommand).toBe(true)
  })
})

describe('adding a marketplace', () => {
  it('asks for a source, reviews it, adds it, and reads the catalogue again', async () => {
    const { w, act, drain, argvs } = await setup(world =>
      world.process.when(['marketplace', 'add'], out(runs['marketplace-add-ok'].stdout)),
    )
    await act.tab('discover')
    await act.addMarketplace()
    expect(w.state.values.view.stack).toEqual(['marketplace'])
    expect(w.ui.focuses.at(-1)).toBe('modmgr:marketplace-source')
    await act.submitMarketplace('--no')
    expect(w.state.values.view.notice).toMatch(/not a marketplace source/)
    await act.submitMarketplace('anthropics/claude-plugins-official')
    expect(w.state.values.view.stack).toEqual(['review'])
    expect(w.state.values.review).toMatchObject({
      action: 'marketplace',
      source: 'anthropics/claude-plugins-official',
    })
    await act.confirm()
    await drain()
    expect(argvs()).toContain('marketplace add anthropics/claude-plugins-official --json')
    expect(w.command.reloads).toBe(0)
    expect(w.process.calls.filter(call => call.argv.includes('--available'))).toHaveLength(2)
  })
})

describe('a local fixture mod, end to end (M4 done criterion)', () => {
  it('is found on disk, read before installing, installed and loaded', async () => {
    const MKT = '/tmp/modmgr-fixtures/mkt'
    const SPAWNER = 'spawner@fixtures'
    const { w, act, drain, argvs } = await setup(world => {
      world.process.when(['list', '--json', '--available'], () => {
        const listed = JSON.parse(runs['list-available'].stdout) as { available: unknown[] }
        const spawner = {
          pluginId: SPAWNER,
          name: 'spawner',
          description: 'Spawns a reviewer agent.',
          marketplaceName: 'fixtures',
          source: './spawner',
          version: '1.0.0',
        }
        return out(JSON.stringify({ ...listed, available: [spawner, ...listed.available] }))
      })
      world.fs.files.set(`${MKT}/spawner/hooks/hooks.json`, MODS_JSON)
      world.process.when(['install', SPAWNER], out(runs['install-ok-local'].stdout))
    })
    await act.tab('discover')
    for (let i = 0; i < 10; i += 1) await w.clock.advance(0)
    expect(w.state.values.catalogPage.rows.map(row => row.id)).toEqual([SPAWNER])
    expect(w.http.gets).not.toContain(`${MKT}/spawner/hooks/hooks.json`)
    await act.openFound(SPAWNER)
    await act.install()
    expect(w.state.values.review?.notable.length).toBeGreaterThan(0)
    await act.scope('local')
    await act.confirm()
    await drain()
    expect(argvs()).toContain(`install ${SPAWNER} --scope local --json`)
    expect(w.command.reloads).toBe(1)
  })
})

describe('a reload that restarts modmgr (F54)', () => {
  it('is done, not interrupted: the new module settles it', async () => {
    const w = world()
    fixtureCli(w.process)
    w.state.values.queue = {
      owner: 'old',
      jobs: [
        { id: 'a', kind: 'install', state: 'ok', tail: [], batch: 'b', target: 'spawner@fixtures' },
        { id: 'r', kind: 'reload', state: 'running', tail: [], batch: 'b' },
      ],
    }
    w.state.values.attention = { ...w.state.values.attention, reloadPending: true }
    const rt = createRuntime(w.ports, DEFAULT_CONFIG, 'new')
    const { onSessionStart } = await import('../../plugin/hooks/services/lifecycle.ts')
    await onSessionStart(rt)
    expect(w.state.values.queue.jobs.at(-1)).toMatchObject({ state: 'ok' })
    expect(w.state.values.attention).toMatchObject({
      reloadPending: false,
      lastReload: 'Plugins reloaded, modmgr with them',
    })
  })

  it("the old module's late rejection writes nothing", async () => {
    const w = world()
    fixtureCli(w.process)
    const rt = createRuntime(w.ports, DEFAULT_CONFIG, 'old')
    w.state.values.queue = {
      owner: 'old',
      jobs: [{ id: 'r', kind: 'reload', state: 'queued', tail: [], batch: 'b' }],
    }
    w.command.reloadAnswer = async () => {
      w.state.values.queue = { ...w.state.values.queue, owner: 'new' }
      throw new Error('the module was reloaded')
    }
    rt.runner.kick()
    await w.clock.advance(0)
    await rt.runner.whenIdle()
    expect(w.state.values.attention.reloadPending).toBe(false)
  })
})
