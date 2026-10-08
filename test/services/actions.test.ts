import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../../plugin/hooks/domain/config.ts'
import { type ActionRuntime, createActions } from '../../plugin/hooks/services/actions.ts'
import { createRuntime } from '../../plugin/hooks/services/runtime.ts'
import { fixtureCli } from './cli-world.ts'
import { world } from './fakes.ts'

const TURN_BAND = 'turn-band@fixtures'
const QUIET = 'quiet-bash@fixtures'

/** A world with the fixture mods listed and analysed, and the pane open. */
const setup = async () => {
  const w = world()
  fixtureCli(w.process)
  const rt = createRuntime(w.ports, DEFAULT_CONFIG, 'own')
  w.state.values.queue = { owner: 'own', jobs: [] }
  await rt.store.load()
  await rt.registry.refresh()
  await w.ui.open({ id: 'modmgr', title: 'mods', closeOnEscape: true })
  w.ui.opens.length = 0
  const act = createActions(w.ports, rt)
  /** Runs the queue to rest: the CLI writes, the reload's settle wait, the reload. */
  const drain = async () => {
    await w.clock.advance(0)
    await rt.runner.whenIdle()
    await w.clock.advance(2000)
    await rt.runner.whenIdle()
  }
  return { w, rt, act, drain }
}

describe('selection and overlays', () => {
  it('a focused row becomes the selection and loads its detail, once', async () => {
    const { w, act } = await setup()
    await act.focusRow(TURN_BAND)
    expect(w.state.values.view.selected).toBe(TURN_BAND)
    expect(w.state.values.detail?.id).toBe(TURN_BAND)
    const writes = w.state.writes.length
    await act.focusRow(TURN_BAND)
    expect(w.state.writes.length).toBe(writes)
  })

  it('Enter pushes the detail; back pops it; tabs reset the stack', async () => {
    const { w, act } = await setup()
    await act.open(QUIET)
    expect(w.state.values.view.stack).toEqual(['detail'])
    expect(w.state.values.detail?.id).toBe(QUIET)
    await act.overlay('help')
    expect(w.state.values.view.stack).toEqual(['detail', 'help'])
    await act.overlay('help')
    await act.back()
    expect(w.state.values.view.stack).toEqual([])
    await act.overlay('jobs')
    await act.tab('installed')
    expect(w.state.values.view.stack).toEqual([])
  })

  it('filters, focuses the filter field, and moves to the first or last row', async () => {
    const { w, act } = await setup()
    await act.filter('ba')
    expect(w.state.values.view.query).toBe('ba')
    await act.edge('last')
    expect(w.state.values.view.selected).toBe(TURN_BAND)
    expect(w.ui.focuses.at(-1)).toBe(`modmgr:row:${TURN_BAND}`)
    await act.edge('first')
    expect(w.state.values.view.selected).toBe(QUIET)
    await act.filter('nothing matches')
    await act.edge('first')
    expect(w.state.values.view.selected).toBe(QUIET)
    await act.focusFilter()
    expect(w.ui.focuses.at(-1)).toBe('modmgr:filter')
    await act.filter('x'.repeat(500))
    expect(w.state.values.view.query.length).toBe(100)
  })
})

describe('toggle → review → confirm → reload', () => {
  it('stages, reviews, queues one batch with one reload, and runs it', async () => {
    const { w, act, drain } = await setup()
    await act.focusRow(TURN_BAND)
    await act.toggle()
    expect(w.state.values.view.staged).toEqual({ [TURN_BAND]: false })

    await act.apply()
    expect(w.state.values.view.stack).toEqual(['review'])
    expect(w.state.values.review).toMatchObject({
      action: 'toggle',
      targets: [{ id: TURN_BAND, op: 'disable', scope: 'user' }],
      changesRepoFile: false,
    })

    await act.confirm()
    expect(w.state.values.review).toBeNull()
    expect(w.state.values.view.stack).toEqual([])
    expect(w.state.values.view.staged).toEqual({})
    // Re-opened without holding toasts while the batch runs (C8).
    expect(w.ui.opens).toEqual([
      { id: 'modmgr', title: 'mods', closeOnEscape: true, rows: 14, columns: 96 },
    ])
    expect(w.state.values.queue.jobs.map(job => `${job.kind}:${job.state}`)).toEqual([
      'disable:queued',
      'reload:queued',
    ])

    await drain()
    expect(w.process.calls.map(call => call.argv.slice(1).join(' '))).toContain(
      `plugin disable ${TURN_BAND} --scope user --json`,
    )
    expect(w.command.reloads).toBe(1)
    expect(w.state.values.queue.jobs.map(job => job.state)).toEqual(['ok', 'ok'])
  })

  it('a mixed mod turned off says what it also turns off', async () => {
    const { w, rt } = await setup()
    // No fixture mod carries skills: the registry's facts say this one does.
    const act = createActions(w.ports, {
      ...rt,
      registry: {
        ...rt.registry,
        facts: () => ({ notable: [], parts: { skills: 2, agents: 0, mcp: 1 } }),
      },
    })
    await act.toggle(TURN_BAND)
    await act.apply()
    expect(w.state.values.review?.parts).toEqual({ skills: 2, agents: 0, mcp: 1 })
  })

  it('turning a mod on lists what it may do', async () => {
    const { w, act } = await setup()
    w.state.values.mods = w.state.values.mods.map(row =>
      row.id === QUIET ? { ...row, enabled: false } : row,
    )
    await act.toggle(QUIET)
    await act.apply()
    expect(w.state.values.review?.notable).toEqual([
      'quiet-bash: Can run programs or change files on your machine',
    ])
  })

  it('cancel and back drop the review and keep what is staged', async () => {
    const { w, act } = await setup()
    await act.toggle(TURN_BAND)
    await act.apply()
    await act.cancel()
    expect(w.state.values.review).toBeNull()
    expect(w.state.values.view.stack).toEqual([])
    expect(w.state.values.view.staged).toEqual({ [TURN_BAND]: false })
    await act.apply()
    await act.back()
    expect(w.state.values.review).toBeNull()
  })

  it('apply with nothing staged says so; confirm with no review does nothing', async () => {
    const { w, act } = await setup()
    w.state.values.view = { ...w.state.values.view, staged: { 'gone@fixtures': false } }
    await act.apply()
    expect(w.state.values.view.notice).toBe('Nothing is staged')
    expect(w.state.values.view.staged).toEqual({})
    await act.confirm()
    expect(w.state.values.queue.jobs).toEqual([])
  })

  it('a locked row is not staged; the notice says why', async () => {
    const { w, act } = await setup()
    w.state.values.mods = w.state.values.mods.map(row =>
      row.id === TURN_BAND ? { ...row, scope: 'managed', toggleable: false } : row,
    )
    await act.toggle(TURN_BAND)
    expect(w.state.values.view.staged).toEqual({})
    expect(w.state.values.view.notice).toMatch(/^turn-band: managed by your organisation/)
    await act.toggle('missing@fixtures')
    await act.focusRow(TURN_BAND)
    expect(w.state.values.view.notice).toBeUndefined()
  })

  it('undo queues the inverse of the last batch, or says there is none', async () => {
    const { w, act, drain } = await setup()
    await act.undo()
    expect(w.state.values.view.notice).toBe('Nothing to undo')
    await act.toggle(TURN_BAND)
    await act.apply()
    await act.confirm()
    await drain()
    await act.undo()
    expect(w.state.values.view.notice).toBe('Undoing the last batch (1)')
    await drain()
    expect(w.process.calls.map(call => call.argv.slice(1).join(' '))).toContain(
      `plugin enable ${TURN_BAND} --scope user --json`,
    )
    expect(w.command.reloads).toBe(2)
  })
})

describe('the band and the rest', () => {
  it('reload queues one on its own, and no second while one waits', async () => {
    const { w, act, drain } = await setup()
    await act.reload()
    await act.reload()
    expect(w.state.values.queue.jobs.map(job => job.kind)).toEqual(['reload'])
    await drain()
    expect(w.command.reloads).toBe(1)
    expect(w.state.values.attention.lastReload).toBe('Reloaded: 1 plugin')
    await w.clock.advance(8000)
    expect(w.state.values.attention.lastReload).toBeUndefined()
  })

  it('opens the pane from the band with focus, holding toasts unless jobs run', async () => {
    const { w, act } = await setup()
    await act.openPane()
    expect(w.ui.opens.at(-1)).toMatchObject({ focus: true, holdToasts: true })
    w.state.values.queue = {
      owner: 'own',
      jobs: [{ id: 'q', kind: 'disable', state: 'queued', tail: [] }],
    }
    await act.openPane()
    expect(w.ui.opens.at(-1)?.holdToasts).toBeUndefined()
  })

  it('dismisses the band line, copies, refreshes, closes and cancels', async () => {
    const { w, rt, act } = await setup()
    await act.dismiss('mods · reload to apply')
    expect(w.state.values.attention.dismissed).toBe('mods · reload to apply')
    await act.copy(TURN_BAND)
    expect(w.ui.copies).toEqual([TURN_BAND])
    expect(w.state.values.view.notice).toBe(`Copied ${TURN_BAND}`)
    w.ui.copyFails = 'no-clipboard'
    await act.copy(TURN_BAND)
    expect(w.state.values.view.notice).toBe("Couldn't copy: no-clipboard")
    const lists = () => w.process.calls.filter(call => call.argv[2] === 'list').length
    const before = lists()
    await act.refresh()
    expect(lists()).toBe(before + 1)
    await act.close()
    expect(w.ui.closes).toEqual(['modmgr'])
    w.state.values.queue = {
      owner: 'own',
      jobs: [{ id: 'q', kind: 'disable', state: 'queued', tail: [] }],
    }
    await act.cancelJob('q')
    expect(w.state.values.queue.jobs[0]?.state).toBe('cancelled')
    expect(rt).toBeDefined()
  })
})

describe('Esc (ui.close from the person)', () => {
  it('pops the top overlay, then clears the filter, then lets the close through', async () => {
    const { w, act } = await setup()
    await act.toggle(TURN_BAND)
    await act.apply()
    await act.filter('turn')
    w.ui.keysToPrompt()
    expect(await act.closing('person', true)).toBe(true)
    expect(w.state.values.review).toBeNull()
    expect(w.state.values.view.stack).toEqual([])
    // Esc handed the keys to the prompt: the pane takes them back, the ring onto the row.
    expect(w.ui.opens.at(-1)).toMatchObject({ focus: true, holdToasts: true })
    expect(w.ui.focuses.at(-1)).toBe(`modmgr:row:${TURN_BAND}`)
    w.ui.keysToPrompt()
    expect(await act.closing('person', true)).toBe(true)
    expect(w.state.values.view.query).toBe('')
    w.ui.keysToPrompt()
    expect(await act.closing('person', true)).toBe(false)
    expect(w.state.values.view.staged).toEqual({ [TURN_BAND]: false })
  })

  it('closes at once when the pane did not hold the keys (review M10)', async () => {
    const { w, act } = await setup()
    await act.open(TURN_BAND)
    w.ui.keysToPrompt()
    expect(await act.closing('person', false)).toBe(false)
    expect(w.state.values.view.stack).toEqual([])
  })

  it('a close that leaves the keys with the pane closes, overlays or not', async () => {
    const { w, act } = await setup()
    await act.open(TURN_BAND)
    expect(await act.closing('person', true)).toBe(false)
    expect(w.state.values.view.stack).toEqual([])
  })

  it('a plugin close resets the overlays; a failure still lets it close', async () => {
    const { w, act } = await setup()
    await act.open(TURN_BAND)
    expect(await act.closing('plugin', true)).toBe(false)
    expect(w.state.values.view.stack).toEqual([])
    w.state.failWrites = true
    w.ui.keysToPrompt()
    expect(await act.closing('person', true)).toBe(false)
    expect(w.ui.lines.at(-1)).toMatch(/^modmgr: close failed/)
  })
})

describe('the focus ring (F46, review R-M3a-5)', () => {
  it('goes to what each overlay offers first, and back to the row when it closes', async () => {
    const { w, act } = await setup()
    const last = () => w.ui.focuses.at(-1)
    await act.open(TURN_BAND)
    expect(last()).toBe('modmgr:act:toggle')
    await act.back()
    expect(last()).toBe(`modmgr:row:${TURN_BAND}`)
    await act.toggle(TURN_BAND)
    await act.apply()
    expect(last()).toBe('modmgr:act:cancel')
    await act.cancel()
    expect(last()).toBe(`modmgr:row:${TURN_BAND}`)
    await act.overlay('help')
    expect(last()).toBe('modmgr:act:help')
    await act.overlay('help')
    await act.overlay('jobs')
    expect(last()).toBe('modmgr:act:jobs')
    await act.tab('installed')
    expect(last()).toBe(`modmgr:row:${TURN_BAND}`)
  })

  it('falls back to the next key when one is not drawn (a locked mod has no toggle)', async () => {
    const { w, act } = await setup()
    w.ui.undrawn.add('act:toggle')
    await act.open(TURN_BAND)
    expect(w.ui.focuses.slice(-2)).toEqual(['modmgr:act:toggle', 'modmgr:act:copy'])
    w.ui.focus = async () => {
      throw new Error('refused')
    }
    await act.back()
    expect(w.state.values.view.stack).toEqual([])
  })

  it('confirm puts it back on the row; a help overlay left under the review keeps it there', async () => {
    const { w, act } = await setup()
    await act.overlay('help')
    await act.toggle(TURN_BAND)
    await act.apply()
    await act.confirm()
    expect(w.ui.focuses.at(-1)).toBe('modmgr:act:help')
  })
})

describe('review findings R-M3a-1 to R-M3a-3', () => {
  it('toggle acts on the row the filter shows, never a hidden selection', async () => {
    const { w, act } = await setup()
    await act.focusRow(TURN_BAND)
    await act.filter('red')
    expect(w.state.values.detail?.id).toBe('redactor@fixtures')
    await act.toggle()
    expect(w.state.values.view.staged).toEqual({ 'redactor@fixtures': false })
  })

  it('two confirms before the redraw queue one batch', async () => {
    const { w, act } = await setup()
    await act.toggle(TURN_BAND)
    await act.apply()
    await Promise.all([act.confirm(), act.confirm()])
    expect(w.state.values.queue.jobs.map(job => job.kind)).toEqual(['disable', 'reload'])
  })

  it('a confirm that cannot queue keeps the review', async () => {
    const w = world()
    const review = {
      action: 'toggle' as const,
      targets: [{ id: TURN_BAND, op: 'disable' as const }],
      notable: [],
      changesRepoFile: false,
    }
    w.state.values.review = review
    await createActions(w.ports, undefined).confirm()
    expect(w.state.values.review).toEqual(review)
  })

  it('a refresh drops staged entries that no longer change their row', async () => {
    const { w, act } = await setup()
    w.state.values.view = { ...w.state.values.view, staged: { [TURN_BAND]: true } }
    await act.refresh()
    expect(w.state.values.view.staged).toEqual({})
  })
})

describe('without a runtime, or when the host refuses', () => {
  it('says modmgr is starting instead of queueing', async () => {
    const w = world()
    w.state.values.review = { action: 'toggle', targets: [], notable: [], changesRepoFile: false }
    const act = createActions(w.ports, undefined)
    await act.confirm()
    expect(w.state.values.view.notice).toBe('modmgr is still starting; try again in a moment')
    await act.reload()
    await act.refresh()
    await act.cancelJob('x')
    await act.open('a@m')
    expect(w.state.values.queue.jobs).toEqual([])
  })

  it('logs a failed action instead of throwing into the host', async () => {
    const w = world()
    const rt: ActionRuntime | undefined = undefined
    const act = createActions(w.ports, rt)
    w.state.failWrites = true
    await expect(act.tab('installed')).resolves.toBeUndefined()
    expect(w.ui.lines).toEqual(['modmgr: tab failed: Error: state.set refused'])
  })
})
