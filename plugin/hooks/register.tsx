// The only file that spells `$` (C2, F36). It builds ports from `$` in
// top-level builders, one per noun (F40), registers each event once (F37), and
// delegates to services. `.catch` handlers never touch `$`: on re-entry their
// `$` calls reject (review M2), so they pass through or answer plainly.

import { atom, type EngineInterface, type Register, read, update } from 'claude-code'
import { parseConfig } from './domain/config.ts'
import { INITIAL, type ModmgrState, type StateKey } from './domain/state.ts'
import type {
  ClockPort,
  CommandPort,
  EnvPort,
  Ports,
  ProcessPort,
  SessionPort,
  StatePort,
  StorePort,
  UiPort,
} from './ports.ts'
import { modsCommand } from './services/commands.ts'
import { MODS_DESCRIPTION, onSessionStart } from './services/lifecycle.ts'
import { createRuntime, newOwnerId, type Runtime } from './services/runtime.ts'

// One atom per key, its plugin and key spelled as literals (the validator lists
// them) and a shape tag that changes with the key's type (C3; domain/state.ts).
const MODS = atom({ plugin: 'modmgr', key: 'mods' } as const, INITIAL.mods, { shape: 'mods/1' })
const DETAIL = atom({ plugin: 'modmgr', key: 'detail' } as const, INITIAL.detail, {
  shape: 'detail/1',
})
const CATALOG_PAGE = atom({ plugin: 'modmgr', key: 'catalogPage' } as const, INITIAL.catalogPage, {
  shape: 'catalogPage/1',
})
const DETECT = atom({ plugin: 'modmgr', key: 'detect' } as const, INITIAL.detect, {
  shape: 'detect/1',
})
const QUEUE = atom({ plugin: 'modmgr', key: 'queue' } as const, INITIAL.queue, { shape: 'queue/1' })
const SYNC = atom({ plugin: 'modmgr', key: 'sync' } as const, INITIAL.sync, { shape: 'sync/1' })
const VIEW = atom({ plugin: 'modmgr', key: 'view' } as const, INITIAL.view, { shape: 'view/1' })
const REVIEW = atom({ plugin: 'modmgr', key: 'review' } as const, INITIAL.review, {
  shape: 'review/1',
})
const ATTENTION = atom({ plugin: 'modmgr', key: 'attention' } as const, INITIAL.attention, {
  shape: 'attention/1',
})
const DEGRADED = atom({ plugin: 'modmgr', key: 'degraded' } as const, INITIAL.degraded, {
  shape: 'degraded/1',
})

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
  }
}

function sessionPorts($: EngineInterface): SessionPort {
  return {
    root: () => $.session.root(),
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
  }
}

// This module instance's services, built at its first `session.start` and
// gone with the module (a reload of modmgr builds the next one, F31).
let runtime: Runtime | undefined

export const register: Register = (on, options) => {
  const config = parseConfig(options)

  on('session.start', async ($, e, next) => {
    runtime ??= createRuntime(portsOf($), config, newOwnerId())
    await onSessionStart(runtime)
    return next(e)
  }).catch((_$, e, next) => next(e))

  on('command.run', { command: 'mods' }, ($, e) =>
    modsCommand({ state: statePorts($) }, e.args),
  ).catch(() => ({ text: 'modmgr failed to answer; run with --debug for the reason.' }))
}
