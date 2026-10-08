// The only file that spells `$` (C2, F36). It builds ports from `$` in
// top-level builders, one per noun (F40), registers each event once (F37), and
// delegates to services. `.catch` handlers never touch `$`: on re-entry their
// `$` calls reject (review M2), so they pass through or answer plainly.

import {
  atom,
  type EngineInterface,
  type Register,
  type RenderInput,
  read,
  update,
} from 'claude-code'
import { parseConfig } from './domain/config.ts'
import { devOfKey } from './domain/dev.ts'
import { foundOfKey } from './domain/discover.ts'
import { INITIAL, type ModmgrState, type StateKey } from './domain/state.ts'
import { rowOfKey } from './domain/view.ts'
import type {
  ClockPort,
  CommandPort,
  EnvPort,
  FsPort,
  HttpPort,
  Ports,
  ProcessPort,
  SessionPort,
  StatePort,
  StorePort,
  UiPort,
} from './ports.ts'
import { type Actions, createActions } from './services/actions.ts'
import { modsCommand } from './services/commands.ts'
import {
  MODS_DESCRIPTION,
  onNotice,
  onSessionStart,
  onTurnEnd,
  onTurnStart,
} from './services/lifecycle.ts'
import { createRuntime, newOwnerId, type Runtime } from './services/runtime.ts'
import { drawBand } from './ui/Band.tsx'
import type { El, ViewPorts } from './ui/kit.tsx'
import { drawPane } from './ui/Pane.tsx'

// One atom per key, its plugin and key spelled as literals (the validator lists
// them) and a shape tag that changes with the key's type (C3; domain/state.ts).
const MODS = atom({ plugin: 'modmgr', key: 'mods' } as const, INITIAL.mods, { shape: 'mods/2' })
const DETAIL = atom({ plugin: 'modmgr', key: 'detail' } as const, INITIAL.detail, {
  shape: 'detail/2',
})
const CATALOG_PAGE = atom({ plugin: 'modmgr', key: 'catalogPage' } as const, INITIAL.catalogPage, {
  shape: 'catalogPage/2',
})
const DETECT = atom({ plugin: 'modmgr', key: 'detect' } as const, INITIAL.detect, {
  shape: 'detect/1',
})
const QUEUE = atom({ plugin: 'modmgr', key: 'queue' } as const, INITIAL.queue, { shape: 'queue/1' })
const SYNC = atom({ plugin: 'modmgr', key: 'sync' } as const, INITIAL.sync, { shape: 'sync/1' })
const VIEW = atom({ plugin: 'modmgr', key: 'view' } as const, INITIAL.view, { shape: 'view/5' })
const REVIEW = atom({ plugin: 'modmgr', key: 'review' } as const, INITIAL.review, {
  shape: 'review/3',
})
const ATTENTION = atom({ plugin: 'modmgr', key: 'attention' } as const, INITIAL.attention, {
  shape: 'attention/2',
})
const DEGRADED = atom({ plugin: 'modmgr', key: 'degraded' } as const, INITIAL.degraded, {
  shape: 'degraded/1',
})
const DEV = atom({ plugin: 'modmgr', key: 'dev' } as const, INITIAL.dev, { shape: 'dev/1' })

type Change<K extends StateKey> = (value: ModmgrState[K]) => ModmgrState[K]

function statePorts($: EngineInterface): StatePort {
  // `read`/`update` take an atom named directly (the validator refuses a computed one).
  const readers: { [K in StateKey]: () => Promise<ModmgrState[K]> } = {
    mods: () => read($, MODS),
    detail: () => read($, DETAIL),
    catalogPage: () => read($, CATALOG_PAGE),
    detect: () => read($, DETECT),
    queue: () => read($, QUEUE),
    sync: () => read($, SYNC),
    view: () => read($, VIEW),
    review: () => read($, REVIEW),
    attention: () => read($, ATTENTION),
    degraded: () => read($, DEGRADED),
    dev: () => read($, DEV),
  }
  const writers: { [K in StateKey]: (change: Change<K>) => Promise<ModmgrState[K]> } = {
    mods: change => update($, MODS, change),
    detail: change => update($, DETAIL, change),
    catalogPage: change => update($, CATALOG_PAGE, change),
    detect: change => update($, DETECT, change),
    queue: change => update($, QUEUE, change),
    sync: change => update($, SYNC, change),
    view: change => update($, VIEW, change),
    review: change => update($, REVIEW, change),
    attention: change => update($, ATTENTION, change),
    degraded: change => update($, DEGRADED, change),
    dev: change => update($, DEV, change),
  }
  return {
    read: key => readers[key](),
    update: <K extends StateKey>(key: K, change: Change<K>) =>
      (writers[key] as (change: Change<K>) => Promise<ModmgrState[K]>)(change),
  }
}

function processPorts($: EngineInterface): ProcessPort {
  return {
    run: (argv, init) => $.process.run(argv, init),
    spawn: (argv, init) => $.process.spawn({ argv, ...init }),
  }
}

function storePorts($: EngineInterface): StorePort {
  return {
    get: key => $.store.get(key),
    set: (key, value) => $.store.set(key, value),
    delete: key => $.store.delete(key),
    keys: () => $.store.keys(),
  }
}

function clockPorts($: EngineInterface): ClockPort {
  return {
    now: () => $.clock.now(),
    after: (ms, fn) => $.clock.after(ms, fn),
    every: (ms, fn) => $.clock.every(ms, fn),
  }
}

function envPorts($: EngineInterface): EnvPort {
  return {
    pluginDirs: () => $.env.get('CLAUDE_CODE_PLUGIN_DIRS'),
    nonessentialTraffic: () => $.env.get('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'),
    configDir: () => $.env.get('CLAUDE_CONFIG_DIR'),
    home: () => $.env.get('HOME'),
  }
}

function sessionPorts($: EngineInterface): SessionPort {
  return {
    root: () => $.session.root(),
    cwd: () => $.session.cwd(),
    id: () => $.session.id(),
    repo: () => $.session.repo(),
    surfaces: () => $.session.surfaces(),
    version: () => $.session.version(),
  }
}

function commandPorts($: EngineInterface): CommandPort {
  return {
    registerMods: async () => {
      await $.command.register({ name: 'mods', description: MODS_DESCRIPTION })
    },
    reloadPlugins: async () => (await $.command.run({ command: 'reload-plugins' })).text,
    list: () => $.command.list(),
  }
}

function uiPorts($: EngineInterface): UiPort {
  return {
    debug: text => $.ui.log(text, { to: 'debug' }),
    panes: () => $.ui.panes(),
    open: args => $.ui.open(args),
    close: id => $.ui.close({ id }),
    focus: (requestId, key) => $.ui.focus({ requestId, key }),
    copy: (text, surface) => $.ui.copy(surface === undefined ? { text } : { text, surface }),
    status: text => $.ui.status(text),
  }
}

function httpPorts($: EngineInterface): HttpPort {
  return {
    get: async url => {
      const response = await $.http.fetch(url)
      return { status: response.status, text: response.text }
    },
  }
}

function fsPorts($: EngineInterface): FsPort {
  return {
    read: path => $.fs.read(path),
    list: async path =>
      (await $.fs.list(path)).map(entry => ({ name: entry.name, kind: entry.kind })),
  }
}

function portsOf($: EngineInterface): Ports {
  return {
    process: processPorts($),
    state: statePorts($),
    store: storePorts($),
    clock: clockPorts($),
    env: envPorts($),
    session: sessionPorts($),
    command: commandPorts($),
    ui: uiPorts($),
    http: httpPorts($),
    fs: fsPorts($),
  }
}

function actionsOf($: EngineInterface): Actions {
  return createActions({ state: statePorts($), ui: uiPorts($) }, runtime)
}

/** What a view draws with: the surface's elements, state reads (which subscribe), the actions. */
function viewPortsOf($: EngineInterface, e: RenderInput): ViewPorts {
  const table = $.ui.resolve(e)
  // Mobile draws no Input or Select (d.ts Elements), though a table may carry
  // them (the test kit's does, drawing them as nothing): ask the surface first.
  const el: El =
    e.surface !== 'mobile' && 'Input' in table
      ? {
          Box: table.Box,
          Text: table.Text,
          Button: table.Button,
          Input: table.Input,
          Select: table.Select,
        }
      : { Box: table.Box, Text: table.Text, Button: table.Button }
  return { el, surface: e.surface, read: statePorts($).read, act: actionsOf($) }
}

// This module instance's services, built at its first `session.start` and
// gone with the module (a reload of modmgr builds the next one, F31).
let runtime: Runtime | undefined

// Whether modmgr's pane held the terminal's keys when last drawn. Esc hands
// the keys back to the prompt before it raises `ui.close` (F45), so the close
// hook can't ask `$.ui.panes()` alone; the draw just before it knows, and the
// pane redraws when the keys leave it (F49). Module memory: a reload of modmgr
// starts it false, and the first Esc then closes.
let paneHadKeys = false

export const register: Register = (on, options) => {
  const config = parseConfig(options)

  on('session.start', async ($, e, next) => {
    runtime ??= createRuntime(portsOf($), config, newOwnerId())
    await onSessionStart(runtime)
    return next(e)
  }).catch((_$, e, next) => next(e))

  // Observed only: the detector probes while no turn runs (PLAN §2.3).
  on('turn.start', async (_$, e, next) => {
    onTurnStart(runtime, e.turnId)
    return next(e)
  }).catch((_$, e, next) => next(e))

  on('turn.complete', async (_$, e, next) => {
    try {
      return await next(e)
    } finally {
      onTurnEnd(runtime, e.turnId, e.agentId)
    }
  }).catch((_$, e, next) => next(e))

  // Observed only: what the session says when a hot-reloaded plugin fails (Dev, F20).
  on('session.append', { door: 'notice' }, async (_$, e, next) => {
    const stored = await next(e)
    onNotice(runtime, e.message.content)
    return stored
  }).catch((_$, e, next) => next(e))

  on('command.run', { command: 'mods' }, ($, e) =>
    modsCommand({ state: statePorts($), ui: uiPorts($) }, e.args),
  ).catch(() => ({ text: 'modmgr failed to answer; run with --debug for the reason.' }))

  on('ui.render', { component: 'Pane', requestId: 'modmgr' }, ($, e) => {
    // Esc closes from the terminal's keys; another surface's draw says nothing about them.
    if (e.surface === 'terminal') paneHadKeys = e.props.isFocused
    return drawPane(viewPortsOf($, e), {
      bodyColumns: e.props.bodyColumns,
      bodyRows: e.props.scroll.bodyRows,
      isFocused: e.props.isFocused,
    })
  }).catch((_$, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const band = await drawBand(viewPortsOf($, e), e.props)
    return band ?? next(e)
  }).catch((_$, e, next) => next(e))

  // Matchers spell the pane id (domain/view.ts PANE_ID) as a literal: the
  // validator names it, and scripts/validate-plugin.ts allows these two gates
  // only on modmgr's own pane.

  // The ring landing on a row makes it the selection (the window and the split follow).
  on('ui.focus', { component: 'Pane', requestId: 'modmgr' }, async ($, e, next) => {
    const moved = await next(e)
    if (moved.deny !== undefined) return moved
    const id = rowOfKey(e.element)
    const found = foundOfKey(e.element)
    const dev = devOfKey(e.element)
    if (id !== undefined) await actionsOf($).focusRow(id)
    else if (found !== undefined) await actionsOf($).focusFound(found)
    else if (dev !== undefined) await actionsOf($).focusDev(dev)
    return moved
  }).catch((_$, e, next) => next(e))

  // Esc pops an overlay, then clears the filter, then closes (PLAN §5.2).
  on('ui.close', { id: 'modmgr' }, async ($, e, next) =>
    e.origin.kind !== 'unload' && (await actionsOf($).closing(e.origin.kind, paneHadKeys))
      ? { value: undefined }
      : next(e),
  ).catch((_$, e, next) => next(e))
}
