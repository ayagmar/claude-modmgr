// M3b over fake ports: a fixture update's capability diff in the detail, the
// band, the status line and the title; update, update all, remove (data kept
// or not) and undo through the review; the status line and title service.
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../../plugin/hooks/domain/config.ts'
import { bandOf, summaryOf } from '../../plugin/hooks/domain/view.ts'
import { createActions } from '../../plugin/hooks/services/actions.ts'
import { createChrome } from '../../plugin/hooks/services/chrome.ts'
import { createRuntime, observedState } from '../../plugin/hooks/services/runtime.ts'
import { runs } from '../domain/fixtures/cli-runs.ts'
import { bumpTurnBand, fixtureCli } from './cli-world.ts'
import { type FakeProcess, out, world } from './fakes.ts'

const TURN_BAND = 'turn-band@fixtures'
const QUIET = 'quiet-bash@fixtures'
const SPAWNER = 'spawner@fixtures'

/**
 * Lists `ids` as installed from a git marketplace (no folder of their own),
 * which the CLI can update; the fixture marketplace is a folder (F51).
 */
const fromGit = (process: FakeProcess, ...ids: string[]): FakeProcess =>
  process.when(['list', '--json'], () => {
    const list = JSON.parse(runs.list.stdout) as Array<Record<string, unknown>>
    return out(
      JSON.stringify(
        list.map(entry => {
          if (!ids.includes(entry.id as string)) return entry
          const { readFromFolder: _folder, folderVersion: _version, ...rest } = entry
          // A cache copy named like its plugin, so the fake validate finds its fixture.
          const name = (entry.id as string).split('@')[0]
          return { ...rest, installPath: `/tmp/modmgr-fixtures/git/${name}` }
        }),
      ),
    )
  })

const setup = async (more: (process: FakeProcess) => void = () => {}) => {
  const w = world()
  fixtureCli(w.process)
  w.process.when(['marketplace', 'update'], out(runs['marketplace-update-ok'].stdout))
  more(w.process)
  const rt = createRuntime(w.ports, DEFAULT_CONFIG, 'own')
  w.state.values.queue = { owner: 'own', jobs: [] }
  await rt.store.load()
  await rt.registry.refresh()
  await w.ui.open({ id: 'modmgr', title: 'mods', closeOnEscape: true })
  await w.clock.advance(0)
  w.ui.opens.length = 0
  const act = createActions(w.ports, rt)
  const drain = async () => {
    await w.clock.advance(0)
    await rt.runner.whenIdle()
    await w.clock.advance(2000)
    await rt.runner.whenIdle()
    await w.clock.advance(0)
  }
  const argvs = () => w.process.calls.map(call => call.argv.slice(2).join(' '))
  const band = () => {
    const { attention, queue, mods } = w.state.values
    return bandOf(summaryOf({ attention, queue, mods }), {
      dismissed: attention.dismissed,
      isWorking: false,
    })?.text
  }
  return { w, rt, act, drain, argvs, band }
}

describe('a fixture update shows its capability diff (M3b done criterion)', () => {
  it('in the row, the detail, the band, the status line and the title, until the detail is opened', async () => {
    const { w, rt, act, band } = await setup()
    expect(w.state.values.mods.find(row => row.id === TURN_BAND)).toMatchObject({
      version: '0.3.1',
    })
    expect(w.ui.statusLine).toBeUndefined()

    // turn-band's folder moves to 0.4.0, which now runs programs.
    bumpTurnBand(w.process)
    await act.refresh()
    await w.clock.advance(0)

    const row = w.state.values.mods.find(item => item.id === TURN_BAND)
    expect(row).toMatchObject({
      version: '0.4.0',
      capsNew: { since: '0.3.1', added: ['runs-programs'] },
    })
    expect(w.state.values.attention.capsChanged).toBe(1)
    expect(band()).toBe('mods · turn-band can now run programs')
    expect(w.ui.statusLine).toBe('mods: turn-band can now run programs')
    // Retitled with its manners, never asking for the keys (F22).
    expect(w.ui.opens).toEqual([
      {
        id: 'modmgr',
        title: 'mods · 1 can do more',
        closeOnEscape: true,
        rows: 14,
        holdToasts: true,
      },
    ])
    await rt.registry.select(TURN_BAND)
    expect(w.state.values.detail?.capsNew).toEqual({ since: '0.3.1', added: ['runs-programs'] })

    // Opening its detail is seeing it.
    await act.open(TURN_BAND)
    await w.clock.advance(0)
    expect(w.state.values.mods.find(item => item.id === TURN_BAND)?.capsNew).toBeUndefined()
    expect(w.state.values.detail?.capsNew).toBeUndefined()
    expect(w.state.values.attention.capsChanged).toBe(0)
    expect(band()).toBeUndefined()
    expect(w.ui.statusLine).toBeUndefined()
    expect(w.ui.opens.at(-1)?.title).toBe('mods')
    // And it stays seen across refreshes.
    await act.refresh()
    expect(w.state.values.mods.find(item => item.id === TURN_BAND)?.capsNew).toBeUndefined()
  })

  it('a mod seen for the first time is only recorded', async () => {
    const { w } = await setup(bumpTurnBand)
    expect(w.state.values.mods.some(row => row.capsNew !== undefined)).toBe(false)
    expect(w.state.values.attention.capsChanged).toBe(0)
  })
})

describe('update', () => {
  it('a folder-marketplace mod says why it has no update', async () => {
    const { w, act } = await setup()
    await act.update(TURN_BAND)
    expect(w.state.values.view.notice).toMatch(/turn-band: runs from its marketplace folder/)
    expect(w.state.values.review).toBeNull()
    await act.updateAll()
    expect(w.state.values.view.notice).toBe('None of these mods updates through the CLI')
  })

  it('u reviews, refreshes the marketplace, updates, reloads', async () => {
    const { w, act, drain, argvs } = await setup(process => fromGit(process, QUIET))
    await act.focusRow(QUIET)
    await act.update()
    expect(w.state.values.review).toMatchObject({
      action: 'update',
      targets: [{ id: QUIET, op: 'update', scope: 'user', version: '0.2.0' }],
      marketplaces: ['fixtures'],
    })
    expect(w.state.values.view.stack).toEqual(['review'])
    expect(w.ui.focuses.at(-1)).toBe('modmgr:act:cancel')
    await act.confirm()
    expect(w.state.values.queue.jobs.map(job => job.kind)).toEqual([
      'marketplace-update',
      'update',
      'reload',
    ])
    await drain()
    expect(argvs()).toContain('marketplace update fixtures --json')
    expect(argvs()).toContain(`update ${QUIET} --scope user --json`)
    expect(w.command.reloads).toBe(1)
    expect(w.state.values.queue.jobs.map(job => job.state)).toEqual(['ok', 'ok', 'ok'])
  })

  it('an update the CLI finds current owes no reload', async () => {
    const { w, act, drain } = await setup(process => {
      fromGit(process, QUIET)
      process.when(['update'], out(runs['update-current'].stdout))
    })
    await act.update(QUIET)
    await act.confirm()
    await drain()
    const [, update, reload] = w.state.values.queue.jobs
    expect(update).toMatchObject({ state: 'ok', unchanged: true })
    expect(update?.tail.at(-1)).toMatch(/^already so: /)
    expect(reload?.state).toBe('cancelled')
    expect(w.command.reloads).toBe(0)
    expect(w.state.values.attention.reloadPending).toBe(false)
  })

  it('a updates every mod the CLI can update; an update has no undo', async () => {
    const { w, act, drain } = await setup(process => fromGit(process, QUIET, SPAWNER))
    await act.updateAll()
    expect(w.state.values.review?.targets.map(target => target.id)).toEqual([QUIET, SPAWNER])
    await act.confirm()
    await drain()
    await act.undo()
    expect(w.state.values.view.notice).toBe(
      "An update can't be undone: the CLI can't install an older version",
    )
  })
})

describe('remove and its undo', () => {
  it('x reviews, keeps the data by default, and drops the detail of what went', async () => {
    const { w, act, drain, argvs } = await setup()
    await act.open(QUIET)
    await act.remove()
    expect(w.state.values.review).toMatchObject({
      action: 'remove',
      targets: [{ id: QUIET, op: 'remove', scope: 'user' }],
      keepData: true,
    })
    expect(w.state.values.view.stack).toEqual(['detail', 'review'])
    await act.confirm()
    expect(w.state.values.view.stack).toEqual([])
    await drain()
    expect(argvs()).toContain(`uninstall ${QUIET} --scope user --keep-data --json`)

    // z brings it back, through the review: a reinstall runs its code again.
    await act.undo()
    expect(w.state.values.review).toMatchObject({
      action: 'undo',
      targets: [{ id: QUIET, op: 'install', scope: 'user', keptData: true }],
      notable: ['quiet-bash: Can run programs or change files on your machine'],
    })
    expect(w.state.values.queue.jobs.filter(job => job.state === 'queued')).toEqual([])
    await act.confirm()
    await drain()
    expect(argvs()).toContain(`install ${QUIET} --scope user --json`)
  })

  it('d deletes the data too, and only on a remove', async () => {
    const { w, act, drain, argvs } = await setup()
    await act.remove(QUIET)
    await act.keepData()
    expect(w.state.values.review?.keepData).toBe(false)
    await act.keepData()
    await act.keepData()
    await act.confirm()
    await drain()
    expect(argvs()).toContain(`uninstall ${QUIET} --scope user --json`)
    await act.toggle(TURN_BAND)
    await act.apply()
    const review = w.state.values.review
    await act.keepData()
    expect(w.state.values.review).toEqual(review)
  })

  it('a managed mod is locked', async () => {
    const { w, act } = await setup()
    w.state.values.mods = w.state.values.mods.map(row =>
      row.id === QUIET ? { ...row, scope: 'managed', toggleable: false } : row,
    )
    await act.remove(QUIET)
    expect(w.state.values.view.notice).toMatch(/managed by your organisation/)
    expect(w.state.values.review).toBeNull()
    await act.remove('nosuch@fixtures')
    expect(w.state.values.review).toBeNull()
    await act.update('nosuch@fixtures')
    expect(w.state.values.review).toBeNull()
  })

  it('a toggle batch still undoes directly', async () => {
    const { w, act, drain } = await setup()
    await act.toggle(TURN_BAND)
    await act.apply()
    await act.confirm()
    await drain()
    await act.undo()
    expect(w.state.values.review).toBeNull()
    expect(w.state.values.view.notice).toBe('Undoing the last batch (1)')
  })
})

describe('the status line and the title', () => {
  it('says each line once, and clears it', async () => {
    const w = world()
    const chrome = createChrome(w.ports)
    await chrome.sync()
    expect(w.ui.statuses).toEqual([undefined])
    await chrome.sync()
    expect(w.ui.statuses).toEqual([undefined])
    w.state.values.attention = { ...w.state.values.attention, reloadPending: true }
    await chrome.sync()
    expect(w.ui.statusLine).toBe('mods: reload to apply')
  })

  it('retitles only a placed pane whose title changed, holding toasts only when idle', async () => {
    const w = world()
    const chrome = createChrome(w.ports)
    w.state.values.mods = [
      {
        id: 'a@m',
        name: 'a',
        origin: 'marketplace',
        enabled: true,
        toggleable: true,
        notableCount: 0,
        problems: 0,
        mixed: false,
        capsNew: { since: '1', added: ['runs-programs'] },
      },
    ]
    await chrome.sync()
    expect(w.ui.opens).toEqual([]) // not open
    w.ui.shown = [{ id: 'modmgr', title: 'mods', isShown: true, isFocused: true, isPlaced: false }]
    await chrome.sync()
    expect(w.ui.opens).toEqual([]) // waiting undrawn: an unasked open would not place it
    w.ui.shown = [{ id: 'modmgr', title: 'mods', isShown: true, isFocused: true, isPlaced: true }]
    w.state.values.queue = {
      owner: 'o',
      jobs: [{ id: 'j', kind: 'update', state: 'running', tail: [] }],
    }
    await chrome.sync()
    expect(w.ui.opens).toEqual([
      { id: 'modmgr', title: 'mods · 1 can do more', closeOnEscape: true, rows: 14 },
    ])
    await chrome.sync()
    expect(w.ui.opens).toHaveLength(1)
  })

  it('coalesces scheduled syncs and survives a failing read', async () => {
    const w = world()
    const lines: string[] = []
    const chrome = createChrome(w.ports, line => lines.push(line))
    chrome.schedule()
    chrome.schedule()
    await w.clock.advance(0)
    expect(w.ui.statuses).toEqual([undefined])
    const busy = Promise.all([chrome.sync(), chrome.sync()])
    await busy
    w.ui.panes = async () => {
      throw new Error('no panes')
    }
    w.state.values.attention = { ...w.state.values.attention, reloadPending: true }
    await chrome.sync()
    expect(lines.at(-1)).toMatch(/status line failed: Error: no panes/)
  })

  it('a runtime write to what the summary reads schedules a sync', async () => {
    const w = world()
    let synced = 0
    const state = observedState(w.state, new Set(['attention']), () => {
      synced += 1
    })
    await state.update('view', view => view)
    expect(synced).toBe(0)
    await state.update('attention', attention => attention)
    expect(synced).toBe(1)
    expect(await state.read('attention')).toEqual(w.state.values.attention)
  })
})

describe('what a review knows about a mod', () => {
  const withData = (process: FakeProcess) =>
    process.when(['list', '--json'], () => {
      const list = JSON.parse(runs.list.stdout) as Array<Record<string, unknown>>
      return out(
        JSON.stringify(
          list.map(entry =>
            entry.id === QUIET
              ? { ...entry, dataDirSize: { bytes: 12_400, human: '12 KB' } }
              : entry,
          ),
        ),
      )
    })

  it("a remove's review gives the data's size; d then names it", async () => {
    const { w, act, rt } = await setup(withData)
    expect(rt.registry.facts(QUIET)).toMatchObject({ dataBytes: 12_400 })
    await act.remove(QUIET)
    expect(w.state.values.review).toMatchObject({ keepData: true, dataBytes: 12_400 })
  })

  it('a mod no longer installed is known by what it could do when last seen', async () => {
    const { rt } = await setup()
    expect(rt.registry.facts('nosuch@fixtures')).toBeUndefined()
    rt.store.set('capsHistory', {
      ...rt.store.get('capsHistory'),
      'gone@fixtures': { version: '1', notable: ['secret-env'] },
    })
    expect(rt.registry.facts('gone@fixtures')).toEqual({ notable: ['secret-env'] })
  })

  it('acknowledging with no detail shown, or nothing new, writes nothing more', async () => {
    const { w, rt } = await setup(bumpTurnBand)
    await rt.registry.acknowledge(TURN_BAND)
    const writes = w.state.writes.length
    await rt.registry.acknowledge(TURN_BAND)
    expect(w.state.writes.length).toBe(writes)
    bumpTurnBand(w.process).when(['validate'], argv =>
      argv.at(-1)?.endsWith('/turn-band') === true
        ? out(
            runs['validate-turn-band'].stdout.replace(
              'calls: $.clock.now,',
              'calls: $.clock.now, $.process.run, $.http.fetch, $.session.messages,',
            ),
          )
        : undefined,
    )
    w.process.when(['list', '--json'], () => {
      const list = JSON.parse(runs.list.stdout) as Array<Record<string, unknown>>
      return out(
        JSON.stringify(
          list.map(entry =>
            entry.id === TURN_BAND ? { ...entry, folderVersion: '0.5.0' } : entry,
          ),
        ),
      )
    })
    await rt.registry.refresh()
    expect(w.state.values.detail).toBeNull()
    expect(w.state.values.mods.find(row => row.id === TURN_BAND)?.capsNew).toEqual({
      since: '0.4.0',
      added: ['reads-and-sends'],
    })
    await rt.registry.acknowledge(TURN_BAND)
    expect(w.state.values.detail).toBeNull()
    expect(w.state.values.attention.capsChanged).toBe(0)
  })

  it('an update reported from and to the same version changed nothing', async () => {
    const { w, act, drain } = await setup(process => {
      fromGit(process, QUIET)
      process.when(
        ['update'],
        out(
          `${JSON.stringify({ command: 'update', outcome: 'ok', pluginId: QUIET, message: 'ok', updateOutcome: 'other', oldVersion: '1', newVersion: '1' })}\n`,
        ),
      )
    })
    await act.update(QUIET)
    await act.confirm()
    await drain()
    expect(w.state.values.queue.jobs.find(job => job.kind === 'update')?.unchanged).toBe(true)
  })
})
