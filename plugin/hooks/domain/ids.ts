// Validation of everything that reaches a process argv. Values are
// branded once validated, so services can only build argv from checked input.

import { fail, ok, type Result } from './result.ts'
import { hasHiddenCharacters } from './sanitize.ts'

declare const brand: unique symbol
type Brand<T, B extends string> = T & { readonly [brand]: B }

export type PluginId = Brand<string, 'PluginId'>
export type MarketplaceName = Brand<string, 'MarketplaceName'>
export type AbsolutePath = Brand<string, 'AbsolutePath'>
export type Sha256 = Brand<string, 'Sha256'>
/** What `claude plugin marketplace add` takes: `owner/repo`, an https URL, or an absolute path. */
export type MarketplaceSource = Brand<string, 'MarketplaceSource'>

export const TOGGLE_SCOPES = ['user', 'project', 'local'] as const
export type ToggleScope = (typeof TOGGLE_SCOPES)[number]
export const SCOPES = [...TOGGLE_SCOPES, 'managed'] as const
export type Scope = (typeof SCOPES)[number]

const NAME = '[a-z0-9][a-z0-9._-]{0,63}'
const PLUGIN_ID = new RegExp(`^${NAME}@${NAME}$`)
const MARKETPLACE = new RegExp(`^${NAME}$`)
const SHA256 = /^[0-9a-f]{64}$/
// Loader-reserved provenances: not installable, not toggleable through the CLI by id.
const PSEUDO_MARKETPLACES = new Set(['inline', 'builtin'])

export const parsePluginId = (value: unknown): Result<PluginId> =>
  typeof value === 'string' && PLUGIN_ID.test(value)
    ? ok(value as PluginId)
    : fail('invalid', `not a plugin id: ${describe(value)}`)

/** A plugin's or marketplace's name, as ids spell them. */
export const isPluginName = (value: unknown): value is string =>
  typeof value === 'string' && MARKETPLACE.test(value)

export const parseMarketplaceName = (value: unknown): Result<MarketplaceName> =>
  typeof value === 'string' && MARKETPLACE.test(value)
    ? ok(value as MarketplaceName)
    : fail('invalid', `not a marketplace name: ${describe(value)}`)

export const parseScope = (value: unknown): Result<Scope> =>
  typeof value === 'string' && (SCOPES as readonly string[]).includes(value)
    ? ok(value as Scope)
    : fail('invalid', `not a scope: ${describe(value)}`)

/** The scopes `enable`, `disable`, `install` and `uninstall` take: never `managed`. */
export const parseToggleScope = (value: unknown): Result<ToggleScope> =>
  typeof value === 'string' && (TOGGLE_SCOPES as readonly string[]).includes(value)
    ? ok(value as ToggleScope)
    : fail('invalid', `not a scope modmgr can change: ${describe(value)}`)

/**
 * An absolute POSIX path that can't be read as a flag or split a line:
 * `/`-led, no NUL, CR or LF, no `..` segment.
 */
export const parseAbsolutePath = (value: unknown): Result<AbsolutePath> => {
  if (typeof value !== 'string' || !value.startsWith('/') || value.length > 4096) {
    return fail('invalid', `not an absolute path: ${describe(value)}`)
  }
  if (/[\0\r\n]/.test(value)) return fail('invalid', 'path holds a control character')
  if (value.split('/').includes('..')) return fail('invalid', 'path climbs with ..')
  return ok(value as AbsolutePath)
}

export const parseSha256 = (value: unknown): Result<Sha256> =>
  typeof value === 'string' && SHA256.test(value)
    ? ok(value as Sha256)
    : fail('invalid', `not a sha256: ${describe(value)}`)

const GITHUB_REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/
const HTTPS_URL = /^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?(?:\/[^\s]*)?$/

export const parseMarketplaceSource = (value: unknown): Result<MarketplaceSource> => {
  if (typeof value !== 'string')
    return fail('invalid', `not a marketplace source: ${describe(value)}`)
  if (GITHUB_REPO.test(value) && !value.split('/').includes('..')) {
    return ok(value as MarketplaceSource)
  }
  if (HTTPS_URL.test(value) && value.length <= 2048 && !hasHiddenCharacters(value)) {
    return ok(value as MarketplaceSource)
  }
  const path = parseAbsolutePath(value)
  if (path.ok) return ok(value as MarketplaceSource)
  return fail('invalid', `not a marketplace source: ${describe(value)}`)
}

export type IdParts = { readonly name: string; readonly marketplace: string }

export const splitPluginId = (id: PluginId): IdParts => {
  const at = id.indexOf('@')
  return { name: id.slice(0, at), marketplace: id.slice(at + 1) }
}

/** `@inline` and `@builtin` ids name how a plugin was loaded, not something the CLI installs. */
export const isPseudoMarketplace = (id: PluginId): boolean =>
  PSEUDO_MARKETPLACES.has(splitPluginId(id).marketplace)

const describe = (value: unknown): string => {
  if (typeof value !== 'string') return typeof value
  const shown = value.length > 40 ? `${value.slice(0, 40)}…` : value
  return JSON.stringify(shown)
}
