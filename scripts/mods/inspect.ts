// What one repository's checkout holds: each plugin whose hooks/hooks.json
// lists modules, what `claude plugin validate` reports for it (a static read:
// no mod code runs), and whether the marketplace at the repository's root
// lists it from its own folder, so `--marketplace owner/repo` can install it.
// Test material, Claude Code's own bundled mods and repackaged copies are left
// out, by the rules awesome-claude-code-mods uses (tools/kind.mjs, CC0).

import { capabilitiesOf } from '../../plugin/hooks/domain/capabilities.ts'
import type { CliRun } from '../../plugin/hooks/domain/cli-results.ts'
import {
  type Check,
  type CommunityMod,
  DESCRIPTION_MAX,
  isRepoPath,
  NAME_MAX,
  WORD_MAX,
  WORDS_PER_LIST,
} from '../../plugin/hooks/domain/community.ts'
import { isPluginName } from '../../plugin/hooks/domain/ids.ts'
import {
  arr,
  isRecord,
  type JsonRecord,
  parseJson,
  rec,
  str,
} from '../../plugin/hooks/domain/json.ts'
import { hasHiddenCharacters, sanitize } from '../../plugin/hooks/domain/sanitize.ts'
import { parseValidateReport } from '../../plugin/hooks/domain/validate-report.ts'

export type Checkout = {
  readonly repo: string
  readonly commit: string
  /** Every file path in the tree, `/`-joined. */
  readonly files: readonly string[]
  /** A file's text, or undefined when it can't be read. */
  readonly read: (path: string) => string | undefined
  /** `claude plugin validate --json` on a path inside the checkout. */
  readonly validate: (path: string) => Promise<CliRun>
}

/** What GitHub says about the repository, for what the files don't. */
export type RepoFacts = {
  readonly description: string
  readonly stars: number
  readonly pushed: number
}

/** Mods that ship with Claude Code itself: installing them from here would copy them. */
const BUILTIN = new Set(['anthropics/claude-code'])
/** Repositories that repackage other authors' mods: the authors' own repositories count. */
const REPACKAGED = new Set(['davila7/claude-code-templates'])
const NOT_A_MOD = [
  /\/tests?\//,
  /\/fixtures?\//,
  /\/probes?\//,
  /\/examples?\//,
  /\/upstreams?\//,
  /\/docs?\//,
  /\/templates?\//,
  /\/canary\//,
  /\/bench(?:marks?)?\//,
  /\/stubs?\//,
  /\/node_modules\//,
]
const SAYS_NOT_A_MOD =
  /not a product mod|not a (?:plugin|mod) to install|not an? installable plugin|measurement instrument|test fixture/i
const HOOKS_FILE = /(?:^|\/)hooks\/hooks\.json$/
/** More plugins than this in one repository is a repository of copies. */
const MAX_PLUGINS = 100

export const skipsRepo = (repo: string): boolean => {
  const key = repo.toLowerCase()
  return BUILTIN.has(key) || REPACKAGED.has(key)
}

/** The plugin folders whose hooks.json lists modules, shortest first. */
export const modRoots = (checkout: Pick<Checkout, 'files' | 'read'>): string[] => {
  const roots: string[] = []
  for (const file of checkout.files) {
    if (!HOOKS_FILE.test(file)) continue
    const root = file.replace(/(?:^|\/)hooks\/hooks\.json$/, '')
    if (!isRepoPath(root) || NOT_A_MOD.some(rule => rule.test(`/${root}/`))) continue
    const hooks = parseJson(checkout.read(file) ?? '')
    if (!isRecord(hooks) || !Array.isArray(hooks.modules) || hooks.modules.length === 0) continue
    roots.push(root)
  }
  return roots.sort((a, b) => a.length - b.length || a.localeCompare(b)).slice(0, MAX_PLUGINS)
}

const join = (root: string, path: string): string => (root === '' ? path : `${root}/${path}`)

/** `./plugins/x/`, `plugins/x` → `plugins/x`; undefined when it climbs or isn't plain. */
const normalise = (path: string): string | undefined => {
  const segments = path.split('/').filter(segment => segment !== '' && segment !== '.')
  const joined = segments.join('/')
  return isRepoPath(joined) ? joined : undefined
}

/**
 * Where the root marketplace's entries come from: their folder in the
 * repository, by plugin name. Only entries read from this checkout count (a
 * relative path, or this very repository at its root); anything else installs
 * other files than the ones validated.
 */
export const marketplaceEntries = (
  repo: string,
  marketplace: JsonRecord,
): { readonly name: string; readonly folders: ReadonlyMap<string, string> } | undefined => {
  const name = str(marketplace, 'name')
  if (!isPluginName(name)) return undefined
  const pluginRoot = str(rec(marketplace, 'metadata') ?? {}, 'pluginRoot') ?? ''
  const folders = new Map<string, string>()
  for (const entry of arr(marketplace, 'plugins') ?? []) {
    if (!isRecord(entry)) continue
    const plugin = str(entry, 'name')
    if (!isPluginName(plugin)) continue
    const source = entry.source
    let folder: string | undefined
    if (typeof source === 'string') {
      folder = normalise(source.startsWith('./') ? source : join(pluginRoot, source))
    } else if (isRecord(source)) {
      const sameRepo =
        (str(source, 'source') === 'github' &&
          str(source, 'repo')?.toLowerCase() === repo.toLowerCase()) ||
        (str(source, 'source') === 'url' &&
          str(source, 'url')
            ?.toLowerCase()
            .replace(/\.git$/, '') === `https://github.com/${repo.toLowerCase()}`)
      const pinned = str(source, 'path') !== undefined || str(source, 'sha') !== undefined
      if (sameRepo && !pinned) folder = ''
    }
    if (folder !== undefined && !folders.has(folder)) folders.set(folder, plugin)
  }
  return { name, folders }
}

const validates = (run: CliRun): boolean => {
  const report = parseValidateReport(run)
  return report.ok && report.value.success
}

/** What the index can carry: a computed or garbled name past its length is left out. */
const kept = (words: readonly string[] = []): string[] =>
  words
    .filter(word => word.length <= WORD_MAX && !hasHiddenCharacters(word))
    .slice(0, WORDS_PER_LIST)

const checkOf = (run: CliRun): { check: Check; caps?: ReturnType<typeof capabilitiesOf> } => {
  const report = parseValidateReport(run)
  if (!report.ok) return { check: 'failed' }
  const caps = capabilitiesOf(report.value)
  if (!report.value.success || !report.value.hasModule) return { check: 'failed', caps }
  return { check: report.value.warnings.length > 0 ? 'warnings' : 'passed', caps }
}

export const inspectCheckout = async (
  checkout: Checkout,
  facts: RepoFacts,
): Promise<CommunityMod[]> => {
  if (skipsRepo(checkout.repo)) return []
  const roots = modRoots(checkout)
  if (roots.length === 0) return []
  const listing = parseJson(checkout.read('.claude-plugin/marketplace.json') ?? '')
  let market = isRecord(listing) ? marketplaceEntries(checkout.repo, listing) : undefined
  // A marketplace the CLI would refuse installs nothing.
  if (
    market !== undefined &&
    !validates(await checkout.validate('.claude-plugin/marketplace.json'))
  ) {
    market = undefined
  }
  const mods: CommunityMod[] = []
  const seen = new Set<string>()
  for (const root of roots) {
    const manifestPath = join(root, '.claude-plugin/plugin.json')
    const manifestText = checkout.read(manifestPath)
    const manifest = parseJson(manifestText ?? '')
    const own = isRecord(manifest) ? manifest : {}
    const description = sanitize(str(own, 'description') ?? facts.description, {
      max: DESCRIPTION_MAX,
    })
    if (SAYS_NOT_A_MOD.test(description)) continue
    const fallback = root === '' ? checkout.repo.split('/')[1] : root.split('/').at(-1)
    const name = sanitize(str(own, 'name') ?? fallback, { max: NAME_MAX })
    if (name === '') continue
    const { check, caps } = checkOf(
      await checkout.validate(manifestText === undefined ? root || '.' : manifestPath),
    )
    // A copy of the same plugin elsewhere in the repository counts once.
    const same = `${name}\u0000${caps?.events.join()}\u0000${caps?.calls.join()}`
    if (seen.has(same)) continue
    seen.add(same)
    const plugin = market?.folders.get(root)
    mods.push({
      repo: checkout.repo,
      path: root,
      commit: checkout.commit,
      name,
      description,
      stars: facts.stars,
      pushed: facts.pushed,
      ...(market === undefined || plugin === undefined
        ? {}
        : { market: { name: market.name, plugin } }),
      check,
      events: kept(caps?.events),
      calls: kept(caps?.calls),
      envReads: kept(caps?.envReads),
    })
  }
  return mods
}
