// Every `claude …` argv modmgr runs, built only from values `ids.ts` checked:
// an argv array, never a shell line; never `-y` (a declared command is accepted
// only by its sha, with `--accept-command`). A job read
// back from `$.state` is checked again before it becomes a command.

import type { Job } from '../../types/index.d.ts'
import {
  type AbsolutePath,
  isPseudoMarketplace,
  type MarketplaceName,
  type MarketplaceSource,
  type PluginId,
  parseAbsolutePath,
  parseMarketplaceName,
  parseMarketplaceSource,
  parsePluginId,
  parseScope,
  parseSha256,
  parseToggleScope,
  type Scope,
  type Sha256,
  splitPluginId,
  type ToggleScope,
} from './ids.ts'
import { fail, ok, type Result } from './result.ts'

export const CLAUDE_BIN = 'claude'

export type CliCommand =
  | { readonly op: 'version' }
  | { readonly op: 'list'; readonly dataSize?: boolean }
  | { readonly op: 'available' }
  | { readonly op: 'marketplaces' }
  | { readonly op: 'details'; readonly id: PluginId }
  | { readonly op: 'validate'; readonly path: AbsolutePath; readonly strict?: boolean }
  | { readonly op: 'test'; readonly path: AbsolutePath }
  | { readonly op: 'enable' | 'disable'; readonly id: PluginId; readonly scope?: ToggleScope }
  | {
      readonly op: 'install'
      readonly id: PluginId
      readonly scope: ToggleScope
      readonly acceptSha?: Sha256
      /** Install from the marketplace at this source, added first when it isn't yet. */
      readonly marketplace?: MarketplaceSource
    }
  | {
      readonly op: 'update'
      readonly id: PluginId
      readonly scope?: Scope
      readonly acceptSha?: Sha256
    }
  | {
      readonly op: 'uninstall'
      readonly id: PluginId
      readonly scope?: ToggleScope
      readonly keepData?: boolean
    }
  | { readonly op: 'marketplace-add'; readonly source: MarketplaceSource }
  | { readonly op: 'marketplace-update'; readonly name?: MarketplaceName }

export type CliOp = CliCommand['op']

const SECOND = 1000
const MINUTE = 60 * SECOND

/** How long each command may run before the engine kills it (10 min at most). */
export const TIMEOUTS: Readonly<Record<CliOp, number>> = {
  version: 15 * SECOND,
  list: 30 * SECOND,
  available: MINUTE,
  marketplaces: 30 * SECOND,
  details: 30 * SECOND,
  validate: MINUTE,
  test: 10 * MINUTE,
  enable: MINUTE,
  disable: MINUTE,
  install: 5 * MINUTE,
  update: 5 * MINUTE,
  uninstall: 2 * MINUTE,
  'marketplace-add': 5 * MINUTE,
  'marketplace-update': 5 * MINUTE,
}

const scoped = (scope: Scope | undefined): string[] =>
  scope === undefined ? [] : ['--scope', scope]
const accepting = (sha: Sha256 | undefined): string[] =>
  sha === undefined ? [] : ['--accept-command', sha]

export const argvOf = (command: CliCommand): string[] => {
  const plugin = [CLAUDE_BIN, 'plugin']
  switch (command.op) {
    case 'version':
      return [CLAUDE_BIN, '--version']
    case 'list':
      return [...plugin, 'list', '--json', ...(command.dataSize === true ? ['--data-size'] : [])]
    case 'available':
      return [...plugin, 'list', '--json', '--available']
    case 'marketplaces':
      return [...plugin, 'marketplace', 'list', '--json']
    case 'details':
      return [...plugin, 'details', command.id]
    case 'validate':
      return [
        ...plugin,
        'validate',
        '--json',
        ...(command.strict === true ? ['--strict'] : []),
        command.path,
      ]
    case 'test':
      return [...plugin, 'test', command.path]
    case 'enable':
    case 'disable':
      return [...plugin, command.op, command.id, ...scoped(command.scope), '--json']
    case 'install':
      return [
        ...plugin,
        'install',
        // With a marketplace source the CLI takes the plugin's bare name.
        ...(command.marketplace === undefined
          ? [command.id]
          : [splitPluginId(command.id).name, '--marketplace', command.marketplace]),
        ...scoped(command.scope),
        ...accepting(command.acceptSha),
        '--json',
      ]
    case 'update':
      return [
        ...plugin,
        'update',
        command.id,
        ...scoped(command.scope),
        ...accepting(command.acceptSha),
        '--json',
      ]
    case 'uninstall':
      return [
        ...plugin,
        'uninstall',
        command.id,
        ...scoped(command.scope),
        ...(command.keepData === true ? ['--keep-data'] : []),
        '--json',
      ]
    case 'marketplace-add':
      return [...plugin, 'marketplace', 'add', command.source, '--json']
    case 'marketplace-update':
      // `--json` only exists for a named marketplace.
      return command.name === undefined
        ? [...plugin, 'marketplace', 'update']
        : [...plugin, 'marketplace', 'update', command.name, '--json']
  }
}

/** An optional field that, when present, must pass its check. */
const optional = <T>(
  value: unknown,
  parse: (value: unknown) => Result<T>,
): Result<T | undefined> => (value === undefined ? ok(undefined) : parse(value))

const target = (job: Job): Result<PluginId> => {
  const id = parsePluginId(job.target)
  if (!id.ok) return id
  if (isPseudoMarketplace(id.value)) {
    return fail('invalid', `${id.value} is loaded by the launch command; the CLI can't change it`)
  }
  return id
}

/**
 * The command a queued job runs, every field checked again (the queue lives in
 * `$.state`, which an older module may have written). `reload` is not a CLI job.
 */
export const commandOfJob = (job: Job): Result<CliCommand> => {
  const args = job.args ?? {}
  switch (job.kind) {
    case 'enable':
    case 'disable':
    case 'remove': {
      const id = target(job)
      if (!id.ok) return id
      const scope = optional(args.scope, parseToggleScope)
      if (!scope.ok) return scope
      if (job.kind === 'remove') {
        return ok({
          op: 'uninstall',
          id: id.value,
          ...(scope.value === undefined ? {} : { scope: scope.value }),
          ...(args.keepData === true ? { keepData: true } : {}),
        })
      }
      return ok({
        op: job.kind,
        id: id.value,
        ...(scope.value === undefined ? {} : { scope: scope.value }),
      })
    }
    case 'install': {
      const id = target(job)
      if (!id.ok) return id
      const scope = parseToggleScope(args.scope ?? 'user')
      if (!scope.ok) return scope
      const sha = optional(args.acceptSha, parseSha256)
      if (!sha.ok) return sha
      const source = optional(args.source, parseMarketplaceSource)
      if (!source.ok) return source
      return ok({
        op: 'install',
        id: id.value,
        scope: scope.value,
        ...(sha.value === undefined ? {} : { acceptSha: sha.value }),
        ...(source.value === undefined ? {} : { marketplace: source.value }),
      })
    }
    case 'update': {
      const id = target(job)
      if (!id.ok) return id
      const scope = optional(args.scope, parseScope)
      if (!scope.ok) return scope
      const sha = optional(args.acceptSha, parseSha256)
      if (!sha.ok) return sha
      return ok({
        op: 'update',
        id: id.value,
        ...(scope.value === undefined ? {} : { scope: scope.value }),
        ...(sha.value === undefined ? {} : { acceptSha: sha.value }),
      })
    }
    case 'validate':
    case 'test': {
      const path = parseAbsolutePath(args.path)
      if (!path.ok) return path
      return ok(
        job.kind === 'test'
          ? { op: 'test', path: path.value }
          : { op: 'validate', path: path.value, strict: true },
      )
    }
    case 'marketplace-add': {
      const source = parseMarketplaceSource(args.source)
      if (!source.ok) return source
      return ok({ op: 'marketplace-add', source: source.value })
    }
    case 'marketplace-update': {
      const name = optional(job.target, parseMarketplaceName)
      if (!name.ok) return name
      return ok(
        name.value === undefined
          ? { op: 'marketplace-update' }
          : { op: 'marketplace-update', name: name.value },
      )
    }
    case 'reload':
      return fail('invalid', 'a reload is not a CLI command')
  }
}
