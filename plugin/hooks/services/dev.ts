// Dev's sources (PLAN §2.4, C6, C14): the listed plugins a person edits in a
// folder (`@inline`, `@skills-dir`, folder marketplaces), this session's mods
// folder, and the `--plugin-dir` plugins inferred from their commands, whose
// folder is looked for where the session runs. Rows go to `$.state` `dev`;
// what validate and test said is read from the job queue. Also counts the
// failures the session reports while it hot-reloads a folder (F20).

import type { DevShare } from '../../types/index.d.ts'
import {
  devRowsOf,
  type Found,
  failureOf,
  githubRepoOf,
  isInside,
  joinPath,
  keptSelection,
  manifestOf,
  marketplaceFolderOf,
  recordFailure,
  sessionFolderOf,
  shareOf,
  unlistedPlugins,
} from '../domain/dev.ts'
import { splitPluginId } from '../domain/ids.ts'
import type { Ports } from '../ports.ts'
import type { Registry } from './registry.ts'

export type DevPorts = Pick<Ports, 'state' | 'fs' | 'env' | 'session' | 'command' | 'clock'>

/** Plugins whose failures are kept at once (the newest; Dev and Health read them). */
export const FAILURES_KEPT = 50

export type Dev = {
  /** Lists the dev mods again; a call during one queues exactly one more. */
  refresh(): Promise<void>
  /** A session notice: counted when it says a plugin's hook or module failed. */
  notice(text: string): Promise<void>
  /** Works out how to share the row `key` and puts it in `dev.share` (the share overlay). */
  share(key: string): Promise<DevShare | undefined>
}

const MANIFEST = '.claude-plugin/plugin.json'
const MARKETPLACE = '.claude-plugin/marketplace.json'

export const createDev = (
  ports: DevPorts,
  registry: Pick<Registry, 'isLoaded' | 'refresh' | 'listed'>,
  debug: (text: string) => void = () => {},
): Dev => {
  let running: Promise<void> | undefined
  let again = false

  const readText = (path: string): Promise<string | undefined> =>
    ports.fs.read(path).catch(() => undefined)

  /** The plugin a folder holds, by its manifest. */
  const foundAt = async (path: string): Promise<Found | undefined> => {
    const text = await readText(joinPath(path, MANIFEST))
    const manifest = text === undefined ? undefined : manifestOf(text)
    return manifest === undefined ? undefined : { ...manifest, path }
  }

  /** This session's mods folder's plugins (absent folder: none). */
  const sessionFolder = async (): Promise<Found[]> => {
    const [configDir, home, sessionId] = await Promise.all([
      ports.env.configDir().catch(() => undefined),
      ports.env.home().catch(() => undefined),
      ports.session.id().catch(() => ''),
    ])
    const folder = sessionFolderOf({ configDir, home, sessionId })
    if (folder === undefined) return []
    const entries = await ports.fs.list(folder).catch(() => [])
    const found = await Promise.all(
      entries
        .filter(entry => entry.kind !== 'file' && !entry.name.startsWith('.'))
        .map(entry => foundAt(joinPath(folder, entry.name))),
    )
    return found.filter((item): item is Found => item !== undefined)
  }

  /**
   * Where a `--plugin-dir` plugin's folder is: where the session runs, when its
   * manifest names it, or the folder a marketplace file there lists it at (a
   * mod's repository is often its marketplace, reference §Sharing a mod).
   */
  const locate = async (name: string, places: readonly string[]): Promise<Found | undefined> => {
    for (const place of places) {
      const here = await foundAt(place)
      if (here?.name === name) return here
      const text = await readText(joinPath(place, MARKETPLACE))
      const relative = text === undefined ? undefined : marketplaceFolderOf(text, name)
      if (relative === undefined) continue
      const there = await foundAt(joinPath(place, relative))
      if (there?.name === name) return there
    }
    return undefined
  }

  const once = async (): Promise<void> => {
    await ports.state.update('dev', dev => ({ ...dev, loading: true }))
    if (!registry.isLoaded()) await registry.refresh()
    const listed = registry.listed()
    const commands = await ports.command.list().catch(() => [])
    const commandPlugins = commands.flatMap(command =>
      command.source === 'plugin' && command.plugin !== undefined ? [command.plugin] : [],
    )
    const found = await sessionFolder()
    const known = new Set([
      ...listed.map(({ entry }) => splitPluginId(entry.id).name),
      ...found.map(item => item.name),
    ])
    const places = [
      ...new Set(
        await Promise.all([
          ports.session.cwd().catch(() => ''),
          ports.session.root().catch(() => ''),
        ]),
      ),
    ].filter(place => place.startsWith('/'))
    // A failure that named its folder says where the plugin is; else look where the session runs.
    const { failures } = await ports.state.read('dev')
    const failing = Object.keys(failures).filter(name => failures[name]?.folder !== undefined)
    const located = new Map<string, Found>()
    for (const name of unlistedPlugins(commandPlugins, failing, known)) {
      const folder = failures[name]?.folder
      const named = folder === undefined ? undefined : await foundAt(folder)
      const at = named?.name === name ? named : await locate(name, places)
      if (at !== undefined) located.set(name, at)
    }
    const rows = devRowsOf({ listed, commandPlugins, sessionFolder: found, located })
    const now = await ports.clock.now()
    const before = (await ports.state.read('dev')).rows
    await ports.state.update('view', view => {
      const dev = keptSelection(view.dev, before, rows)
      if (dev === view.dev) return view
      if (dev !== undefined) return { ...view, dev }
      const { dev: _gone, ...rest } = view
      return rest
    })
    await ports.state.update('dev', dev => ({ ...dev, rows, loading: false, at: now }))
  }

  const loop = async (): Promise<void> => {
    do {
      again = false
      try {
        await once()
      } catch (error) {
        debug(`modmgr: dev refresh failed: ${String(error)}`)
        await ports.state.update('dev', dev => ({ ...dev, loading: false })).catch(() => undefined)
      }
    } while (again)
  }

  const refresh = (): Promise<void> => {
    if (running !== undefined) {
      again = true
      return running
    }
    running = loop().finally(() => {
      running = undefined
    })
    return running
  }

  return {
    refresh,

    async notice(text) {
      const failure = failureOf(text)
      if (failure === undefined) return
      const now = await ports.clock.now()
      const dev = await ports.state.update('dev', current => {
        const failures = recordFailure(current.failures, failure, now)
        // The newest FAILURES_KEPT plugins.
        const kept = Object.entries(failures)
          .sort(([, a], [, b]) => b.lastAt - a.lastAt)
          .slice(0, FAILURES_KEPT)
        return { ...current, failures: Object.fromEntries(kept) }
      })
      // A failing folder Dev doesn't list yet (a --plugin-dir mod that never loaded) joins it.
      const listed = dev.rows.some(row => row.name === failure.name)
      if (failure.folder !== undefined && !listed && dev.at !== undefined) void refresh()
    },

    async share(key) {
      const row = (await ports.state.read('dev')).rows.find(item => item.key === key)
      if (row === undefined) return undefined
      const path = row.path
      const repo = await ports.session.repo().catch(() => null)
      const inRepo = repo !== null && isInside(path, repo.root)
      // The marketplace file `--marketplace <owner>/<repo>` reads sits at the repository's root.
      const root = inRepo ? repo.root.replace(/\/+$/, '') : path
      const text = await readText(joinPath(root, MARKETPLACE))
      const listed = text !== undefined && marketplaceFolderOf(text, row.name) !== undefined
      const relative = path.slice(root.length).replace(/^\/+/, '')
      const share = shareOf(row, {
        repo: inRepo ? githubRepoOf(repo.remote) : undefined,
        listed,
        source: relative === '' ? './' : `./${relative}`,
      })
      const value: DevShare = {
        key,
        name: row.name,
        line: share.line,
        complete: share.complete,
        notes: [...share.notes],
        ...(share.snippet === undefined ? {} : { snippet: share.snippet }),
      }
      await ports.state.update('dev', dev => ({ ...dev, share: value }))
      return value
    },
  }
}
