// `/mods` as text: the subcommands and their flags, parsed
// into checked values. Every id, scope and sha passes domain/ids.ts before it
// can become a job; a write asks for `--yes`.

import {
  type PluginId,
  parsePluginId,
  parseSha256,
  parseToggleScope,
  type Sha256,
  type ToggleScope,
} from './ids.ts'
import { fail, ok, type Result } from './result.ts'
import { sanitize } from './sanitize.ts'

export type ModsCommand =
  | { readonly kind: 'open' }
  | { readonly kind: 'help' }
  | { readonly kind: 'list' }
  | { readonly kind: 'info'; readonly id: PluginId }
  | {
      readonly kind: 'install'
      readonly id: PluginId
      readonly scope: ToggleScope
      readonly yes: boolean
      readonly acceptSha?: Sha256
    }
  | {
      readonly kind: 'remove'
      readonly id: PluginId
      readonly yes: boolean
      readonly wipe: boolean
    }
  | { readonly kind: 'update'; readonly id?: PluginId; readonly yes: boolean }
  | { readonly kind: 'enable' | 'disable'; readonly id: PluginId; readonly yes: boolean }
  | { readonly kind: 'doctor'; readonly json: boolean }
  | { readonly kind: 'export' }
  | { readonly kind: 'apply'; readonly file: string; readonly yes: boolean }

export const USAGE = [
  'Usage: /mods                       open the dialog',
  '       /mods list | info <id> | doctor [--json] | export',
  '       /mods install <id> [--scope user|project|local] [--accept-command <sha256>] --yes',
  '       /mods remove <id> [--wipe-data] --yes',
  '       /mods update [<id>] --yes',
  '       /mods enable <id> --yes | disable <id> --yes',
  '       /mods apply <file> --yes',
  'Writes run through the claude CLI; run /reload-plugins (or restart) to apply them.',
].join('\n')

type Flags = {
  readonly words: string[]
  readonly yes: boolean
  readonly json: boolean
  readonly wipe: boolean
  readonly scope?: string
  readonly accept?: string
}

const VALUED = new Set(['--scope', '--accept-command'])
const SWITCHES = new Set(['--yes', '--json', '--wipe-data'])

/** The flags each subcommand reads; any other is an error, never silently dropped. */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  install: ['--scope', '--accept-command', '--yes'],
  remove: ['--wipe-data', '--yes'],
  update: ['--yes'],
  enable: ['--yes'],
  disable: ['--yes'],
  apply: ['--yes'],
  doctor: ['--json'],
}

/** Splits the words from the flags; an unknown flag or one missing its value is an error. */
const flagsOf = (sub: string, tokens: readonly string[]): Result<Flags> => {
  const allowed = new Set(ALLOWED[sub] ?? [])
  const words: string[] = []
  const seen = new Map<string, string>()
  const switches = new Set<string>()
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] ?? ''
    if (!token.startsWith('--')) {
      words.push(token)
      continue
    }
    if (!SWITCHES.has(token) && !VALUED.has(token)) {
      return fail('invalid', `unknown option ${sanitize(token, { max: 40 })}`)
    }
    if (!allowed.has(token)) return fail('invalid', `${token} doesn't apply to ${sub}`)
    if (SWITCHES.has(token)) {
      switches.add(token)
      continue
    }
    const value = tokens[i + 1]
    if (value === undefined || value.startsWith('--'))
      return fail('invalid', `${token} needs a value`)
    seen.set(token, value)
    i += 1
  }
  const scope = seen.get('--scope')
  const accept = seen.get('--accept-command')
  return ok({
    words,
    yes: switches.has('--yes'),
    json: switches.has('--json'),
    wipe: switches.has('--wipe-data'),
    ...(scope === undefined ? {} : { scope }),
    ...(accept === undefined ? {} : { accept }),
  })
}

const idOf = (word: string | undefined): Result<PluginId> => {
  if (word === undefined) return fail('invalid', 'which mod? give its id, name@marketplace')
  const id = parsePluginId(word)
  return id.ok ? id : fail('invalid', `not a plugin id: ${sanitize(word, { max: 80 })}`)
}

/** What `/mods <args>` asks for, or why it can't be read. */
export const parseModsArgs = (args: string): Result<ModsCommand> => {
  const tokens = args.trim() === '' ? [] : args.trim().split(/\s+/)
  const [sub, ...rest] = tokens
  if (sub === undefined) return ok({ kind: 'open' })
  const flags = flagsOf(sub, rest)
  if (!flags.ok) return flags
  const { words, yes } = flags.value
  const extra = (count: number) =>
    words.length > count
      ? fail('invalid', `unexpected ${sanitize(words[count], { max: 40 })}`)
      : undefined
  switch (sub) {
    case 'help':
    case '--help':
      return ok({ kind: 'help' })
    case 'list':
      return extra(0) ?? ok({ kind: 'list' })
    case 'export':
      return extra(0) ?? ok({ kind: 'export' })
    case 'doctor':
      return extra(0) ?? ok({ kind: 'doctor', json: flags.value.json })
    case 'info': {
      const id = idOf(words[0])
      return extra(1) ?? (id.ok ? ok({ kind: 'info', id: id.value }) : id)
    }
    case 'enable':
    case 'disable': {
      const id = idOf(words[0])
      return extra(1) ?? (id.ok ? ok({ kind: sub, id: id.value, yes }) : id)
    }
    case 'remove': {
      const id = idOf(words[0])
      return (
        extra(1) ?? (id.ok ? ok({ kind: 'remove', id: id.value, yes, wipe: flags.value.wipe }) : id)
      )
    }
    case 'update': {
      if (words[0] === undefined) return ok({ kind: 'update', yes })
      const id = idOf(words[0])
      return extra(1) ?? (id.ok ? ok({ kind: 'update', id: id.value, yes }) : id)
    }
    case 'install': {
      const id = idOf(words[0])
      if (!id.ok) return id
      const scope = parseToggleScope(flags.value.scope ?? 'user')
      if (!scope.ok) return fail('invalid', 'the scope is user, project or local')
      const accept = flags.value.accept
      const sha = accept === undefined ? undefined : parseSha256(accept)
      if (sha !== undefined && !sha.ok)
        return fail('invalid', '--accept-command takes a sha256 (64 hex)')
      return (
        extra(1) ??
        ok({
          kind: 'install',
          id: id.value,
          scope: scope.value,
          yes,
          ...(sha === undefined ? {} : { acceptSha: sha.value }),
        })
      )
    }
    case 'apply': {
      const file = words[0]
      if (file === undefined) return fail('invalid', 'which file? /mods apply <file> --yes')
      return extra(1) ?? ok({ kind: 'apply', file, yes })
    }
    default:
      return fail('invalid', `unknown subcommand ${sanitize(sub, { max: 40 })}`)
  }
}
