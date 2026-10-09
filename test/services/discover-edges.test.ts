// Discover's edges over fake ports: inspections shared
// and never on the ring's path, idle-only by turn id, no stale catalogue window,
// echoes that clear, a failed local read said, a detector that restarts, the
// tab key dropping a review, a too-long declared command, a silent old module.
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../../plugin/hooks/domain/config.ts'
import { acceptReview, installReview } from '../../plugin/hooks/domain/discover.ts'
import { createActions } from '../../plugin/hooks/services/actions.ts'
import { createCatalog } from '../../plugin/hooks/services/catalog.ts'
import { createDetector } from '../../plugin/hooks/services/detector.ts'
import {
  background,
  onSessionStart,
  onTurnEnd,
  onTurnStart,
} from '../../plugin/hooks/services/lifecycle.ts'
import { createRuntime } from '../../plugin/hooks/services/runtime.ts'
import { createStore } from '../../plugin/hooks/services/store.ts'
import { runs } from '../domain/fixtures/cli-runs.ts'
import { fixtureCli, markMods } from './cli-world.ts'
import { type FakeProcess, out, world } from './fakes.ts'

const SDK = 'agent-sdk-dev@claude-plugins-official'
const SDK_DIR =
  '/tmp/modmgr-fixtures/config/plugins/marketplaces/claude-plugins-official/plugins/agent-sdk-dev'
const AWS = 'aws-serverless@claude-plugins-official'

const catalogCli = (process: FakeProcess): FakeProcess =>
  fixtureCli(process)
    .when(['list', '--json', '--available'], out(runs['list-available'].stdout))
    .when(['marketplace', 'list'], out(runs['marketplace-list'].stdout))

/** A validate of the SDK folder that answers only when released. */
const gatedValidate = (process: FakeProcess) => {
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  let calls = 0
  process.on(argv => {
    if (argv[2] !== 'validate' || argv.at(-1) !== SDK_DIR) return undefined
    calls += 1
    return undefined
  })
  const run = process.run
  process.run = async (argv, init) => {
    if (argv[2] === 'validate' && argv.at(-1) === SDK_DIR) {
      calls += 1
      await gate
      return {
        exitCode: 0,
        stdout: runs['validate-spawner'].stdout,
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      }
    }
    return run(argv, init)
  }
  return { release, calls: () => calls }
}

const catalogWorld = async () => {
  const w = world()
  catalogCli(w.process)
  const store = createStore(w.ports)
  await store.load()
  const catalog = createCatalog(w.ports, store)
  await catalog.load()
  return { w, store, catalog }
}

describe('inspections', () => {
  it('concurrent reads of one entry run one validate, kept in the store for next time', async () => {
    const { w, store, catalog } = await catalogWorld()
    const gate = gatedValidate(w.process)
    const reads = Promise.all([catalog.inspect(SDK), catalog.inspect(SDK), catalog.inspect(SDK)])
    await w.clock.advance(0)
    gate.release()
    const [first] = await reads
    expect(gate.calls()).toBe(1)
    expect(first).toMatchObject({ hasModule: true })
    expect(Object.keys(store.get('validate'))).toContain(`${SDK_DIR}@?`)
    // A fresh catalogue (a reload, the next session) reads it back without a child.
    const again = createCatalog(w.ports, store)
    await again.load()
    expect(await again.inspect(SDK)).toEqual(first)
    expect(gate.calls()).toBe(1)
  })

  it('the ring moving onto a local row never waits for the read', async () => {
    const w = world()
    catalogCli(w.process)
    const gate = gatedValidate(w.process)
    const rt = createRuntime(w.ports, DEFAULT_CONFIG, 'own')
    w.state.values.queue = { owner: 'own', jobs: [] }
    await rt.store.load()
    const act = createActions(w.ports, rt)
    await act.tab('discover')
    await act.focusFound(SDK)
    // Settled before the read answered: the ring's path doesn't wait on it.
    expect(w.state.values.view.found).toBe(SDK)
    await w.clock.advance(0)
    expect(gate.calls()).toBe(1)
    gate.release()
    await w.clock.advance(0)
  })

  it('a read that failed is said, and r tries again', async () => {
    const { w, store, catalog } = await catalogWorld()
    w.process.when(['validate'], argv =>
      argv.at(-1) === SDK_DIR ? out('', 1, 'the manifest is malformed') : undefined,
    )
    const read = await catalog.inspect(SDK)
    expect(read).toEqual({ failed: expect.any(String) })
    const failed = read !== undefined && 'failed' in read ? read.failed : ''
    expect(installReview({ id: SDK, name: 'agent-sdk-dev' }, 'user', read)).toMatchObject({
      uninspected: true,
      unreadable: failed,
    })
    // Discover lists mods only: not one yet, it isn't drawn.
    await catalog.show()
    expect(w.state.values.catalogPage.rows.find(row => row.id === SDK)).toBeUndefined()
    markMods(store, catalog, [SDK])
    w.state.values.view = { ...w.state.values.view, found: SDK }
    await catalog.show()
    expect(w.state.values.catalogPage.rows.find(row => row.id === SDK)).toMatchObject({
      local: true,
      unread: failed,
    })
    w.process.when(['validate'], argv =>
      argv.at(-1) === SDK_DIR ? out(runs['validate-spawner'].stdout) : undefined,
    )
    await catalog.load({ force: true })
    expect(await catalog.inspect(SDK)).toMatchObject({ hasModule: true })
    expect(await catalog.inspect('nosuch@x')).toBeUndefined()
  })
})

describe('idle-only by turn id', () => {
  it("a subagent's end doesn't end the main turn", async () => {
    const w = world()
    catalogCli(w.process)
    const rt = createRuntime(w.ports, DEFAULT_CONFIG, 'own')
    const busy: boolean[] = []
    rt.detector.setBusy = value => {
      busy.push(value)
    }
    onTurnStart(rt, 'main')
    onTurnEnd(rt, 'sub', 'agent-1')
    expect(busy).toEqual([true])
    onTurnEnd(rt, 'main', undefined)
    expect(busy).toEqual([true, false])
    onTurnStart(rt, 'a')
    onTurnStart(rt, 'b')
    onTurnEnd(rt, 'a', undefined)
    expect(busy.at(-1)).toBe(true)
    onTurnStart(undefined, 'x')
    onTurnEnd(undefined, 'x', undefined)
  })
})

describe('the catalogue window', () => {
  it('a window computed from a replaced view is dropped', async () => {
    const { w, store, catalog } = await catalogWorld()
    markMods(store, catalog)
    const read = w.state.read
    let held: (() => void) | undefined
    let hold = false
    w.state.read = async key => {
      if (key === 'view' && hold) {
        hold = false
        await new Promise<void>(resolve => {
          held = resolve
        })
      }
      return read(key)
    }
    await catalog.show()
    const last = catalog.edge('last') ?? ''
    hold = true
    const stale = catalog.show()
    await w.clock.advance(0)
    w.state.values.view = { ...w.state.values.view, found: last }
    await catalog.show()
    const offset = w.state.values.catalogPage.offset
    held?.()
    await stale
    expect(w.state.values.catalogPage.offset).toBe(offset)
    expect(w.state.values.catalogPage.rows.some(row => row.id === last)).toBe(true)
  })
})

describe('echoes and the old module', () => {
  it('the echo of a reload that restarted modmgr clears after a while', async () => {
    const w = world()
    fixtureCli(w.process)
    w.state.values.queue = {
      owner: 'old',
      jobs: [{ id: 'r', kind: 'reload', state: 'running', tail: [], batch: 'b' }],
    }
    const rt = createRuntime(w.ports, DEFAULT_CONFIG, 'new')
    await onSessionStart(rt)
    expect(w.state.values.attention.lastReload).toBe('Plugins reloaded, modmgr with them')
    await w.clock.advance(9000)
    expect(w.state.values.attention.lastReload).toBeUndefined()
  })

  it("an old module's rejected reload writes nothing and records nothing", async () => {
    const w = world()
    fixtureCli(w.process)
    const rt = createRuntime(w.ports, DEFAULT_CONFIG, 'old')
    await rt.store.load()
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
    const writes = w.state.writes.filter(key => key === 'queue').length
    expect(writes).toBe(1) // the claim only
    expect(rt.store.get('history')).toEqual([])
  })
})

describe('the detector restarts for what a refresh added', () => {
  it('a start while running goes again over the new catalogue', async () => {
    const { w, store, catalog } = await catalogWorld()
    let gate: () => void = () => {}
    const held = new Promise<void>(resolve => {
      gate = resolve
    })
    const get = w.http.get
    let first = true
    w.http.get = async (url, maxBytes) => {
      if (first) {
        first = false
        await held
      }
      return get(url, maxBytes)
    }
    const detector = createDetector(w.ports, {
      store,
      catalog,
      remoteAllowed: async () => true,
      budget: 2000,
    })
    detector.start()
    await w.clock.advance(0)
    detector.start()
    gate()
    for (let i = 0; i < 20; i += 1) await w.clock.advance(0)
    await detector.whenIdle()
    // Both runs went over the catalogue; the second found everything cached.
    expect(w.state.values.detect.running).toBe(false)
    expect(w.state.values.detect.checked).toBe(w.state.values.detect.total)
  })
})

describe('reviews and tabs', () => {
  it('a tab switch drops a review in state', async () => {
    const w = world()
    catalogCli(w.process)
    const rt = createRuntime(w.ports, DEFAULT_CONFIG, 'own')
    w.state.values.queue = { owner: 'own', jobs: [] }
    await rt.store.load()
    const act = createActions(w.ports, rt)
    await act.tab('discover')
    await act.install(AWS)
    expect(w.state.values.review?.action).toBe('install')
    await act.tab('installed')
    expect(w.state.values.review).toBeNull()
    await act.install()
    await act.install('gone@x')
    expect(w.state.values.view.notice).toBe('gone@x is no longer listed')
  })

  it('a declared command longer than modmgr keeps is marked, for the terminal', async () => {
    const review = acceptReview({
      id: 'j',
      kind: 'install',
      state: 'failed',
      tail: [],
      target: 'cmdmod@cmdmkt',
      shown: { kind: 'command_source', command: 'x', sha256: 'a'.repeat(64), truncated: true },
    })
    expect(review?.declaredCommand).toEqual({ text: 'x', sha256: 'a'.repeat(64), truncated: true })
  })
})

describe('a reloaded modmgr with Discover showing', () => {
  it('reads the catalogue again and probes', async () => {
    const w = world()
    catalogCli(w.process)
    w.state.values.view = { ...w.state.values.view, tab: 'discover' }
    const rt = createRuntime(w.ports, DEFAULT_CONFIG, 'own')
    await background(rt, { fresh: false })
    expect(rt.catalog.isLoaded()).toBe(true)
    expect(w.state.values.catalogPage.total).toBe(199)
  })
})
