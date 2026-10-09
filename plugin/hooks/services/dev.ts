// Dev's sources: the listed plugins a person edits in a
// folder (`@inline`, `@skills-dir`, folder marketplaces), this session's mods
// folder, and the `--plugin-dir` plugins inferred from their commands, whose
// folder is looked for where the session runs. Rows go to `$.state` `dev`;
// what validate and test said is read from the job queue.

import type { DevShare } from '../../types/index.d.ts'
import {
  devRowsOf,
  type Found,
  githubRepoOf,
  isInside,
  joinPath,
  keptSelection,
  manifestOf,
  marketplaceFolderOf,
  sessionFolderOf,
  shareOf,
  unlistedPlugins,
} from '../domain/dev.ts'
import { splitPluginId } from '../domain/ids.ts'
import { rootOf } from '../domain/mods.ts'
import type { Ports } from '../ports.ts'
import type { Registry } from './registry.ts'
import { NO_TIMING, type Timing, timed } from './timing.ts'

export type DevPorts = Pick<Ports, 'state' | 'fs' | 'env' | 'session' | 'command' | 'clock'>

export type Dev = {
  /** Lists the dev mods again; a call during one queues exactly one more. */
  refresh(): Promise<void>
  /** Works out how to share the row `key` and puts it in `dev.share` (the share overlay). */
  share(key: string): Promise<DevShare | undefined>
}

const MANIFEST = '.claude-plugin/plugin.json'
const MARKETPLACE = '.claude-plugin/marketplace.json'

export const createDev = (
  ports: DevPorts,
  registry: Pick<Registry, 'isLoaded' | 'refresh' | 'listed'>,
  debug: (text: string) => void = () => {},
  timing: Timing = NO_TIMING,
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
   * mod's repository is often its marketplace: the engine's reference, §Sharing a mod).
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
    // A --plugin-dir plugin is looked for where the session runs.
    const located = new Map<string, Found>()
    for (const name of unlistedPlugins(commandPlugins, known)) {
      const at = await locate(name, places)
      if (at !== undefined) located.set(name, at)
    }
    // modmgr loaded from a folder that isn't an installed copy's is one under development.
    const ownRoot = await ports.session.ownRoot().catch(() => '')
    const installed = listed.some(({ entry }) => rootOf(entry) === ownRoot)
    const own = installed || !ownRoot.startsWith('/') ? undefined : await foundAt(ownRoot)
    const rows = devRowsOf({
      listed,
      commandPlugins,
      sessionFolder: found,
      located,
      ...(own === undefined ? {} : { own }),
    })
    const now = await ports.clock.now()
    const [before, shown] = await Promise.all([ports.state.read('dev'), ports.state.read('view')])
    // Written only when it moves: a view write redraws the pane.
    if (keptSelection(shown.dev, before.rows, rows) !== shown.dev) {
      await ports.state.update('view', view => {
        const dev = keptSelection(view.dev, before.rows, rows)
        if (dev !== undefined) return { ...view, dev }
        const { dev: _gone, ...rest } = view
        return rest
      })
    }
    await ports.state.update('dev', dev => ({ ...dev, rows, loading: false, at: now }))
  }

  const loop = async (): Promise<void> => {
    do {
      again = false
      try {
        await timed(timing, 'dev refresh', once)
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
