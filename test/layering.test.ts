// The layering rules (PLAN §3 with C2), checked over every import in plugin/:
// - domain/ imports only domain/ (and the state contract's types);
// - services/ imports domain/, services/ and contract types;
// - ui/ imports domain/, ui/ and services' types only;
// - only hooks/register.tsx spells `$.` (F36: `$` can't cross a file);
// - hooks/ports.ts is types only, and services/ and ui/ import it as types;
// - no `.catch` handler touches `$` (on re-entry its `$` calls reject, review M2);
// - only register.tsx imports values from 'claude-code' (atom, read, update);
// - every function in register.tsx that takes `$` is declared at the top level (F40);
// - ui/ never names the process, store, env or command ports;
// - ui/ takes hotkeys only from domain/keymap.ts and colours only from the theme keys.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasHiddenCharacters } from '../plugin/hooks/domain/sanitize.ts'

const root = join(import.meta.dirname, '..')
const hooks = join(root, 'plugin', 'hooks')
const contract = join(root, 'plugin', 'types', 'index.d.ts')

// plugin/.claude-plugin/types/ is the engine's own, laid by a live session (git-ignored).
const ENGINE_TYPES = join(root, 'plugin', '.claude-plugin', 'types')

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (path === ENGINE_TYPES) return []
    return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : []
  })

type Import = { from: string; to: string; typeOnly: boolean; specifier: string }

const IMPORT = /^\s*(import|export)\s+(type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/gm

const importsOf = (file: string): Import[] => {
  const source = readFileSync(file, 'utf8')
  return [...source.matchAll(IMPORT)].map(match => {
    const specifier = match[3] ?? ''
    const to = specifier.startsWith('.') ? resolve(dirname(file), specifier) : specifier
    return { from: file, to, typeOnly: match[2] !== undefined, specifier }
  })
}

const ports = join(hooks, 'ports.ts')

const layerOf = (path: string): string => {
  if (path === contract) return 'contract'
  if (path === ports) return 'ports'
  if (path === 'claude-code') return 'engine'
  const rel = relative(hooks, path)
  if (rel.startsWith('..')) return 'outside'
  return rel.includes('/') ? (rel.split('/')[0] ?? 'root') : 'root'
}

const files = walk(hooks)
const imports = files.flatMap(importsOf)

const violations = (layer: string, allowed: (to: string, imp: Import) => boolean): string[] =>
  imports
    .filter(imp => layerOf(imp.from) === layer && !allowed(layerOf(imp.to), imp))
    .map(imp => `${relative(root, imp.from)} → ${imp.specifier}`)

describe('layering', () => {
  it('finds the plugin sources', () => {
    expect(files.some(file => file.includes('/domain/'))).toBe(true)
    expect(files.some(file => file.includes('/ui/'))).toBe(true)
  })

  const uiSources = files
    .filter(file => relative(hooks, file).startsWith('ui/'))
    .map(file => ({ file: relative(root, file), code: readFileSync(file, 'utf8') }))

  it('ui spells no hotkey of its own: they come from domain/keymap.ts (R17)', () => {
    const literal = uiSources.filter(({ code }) =>
      /hotkey\s*[=:]\s*["'{]\s*['"]?[0-9a-z]['"]/.test(code),
    )
    expect(literal.map(({ file }) => file)).toEqual([])
  })

  it('ui colours only through the theme keys (F13, PLAN §5.6)', () => {
    const literal = uiSources.filter(({ code }) => /(color|Color)\s*=\s*["'{]\s*['"]/.test(code))
    expect(literal.map(({ file }) => file)).toEqual([])
    const kit = uiSources.find(({ file }) => file.endsWith('ui/kit.tsx'))?.code ?? ''
    const keys = [...kit.matchAll(/^\s+\w+: '(\w+)',$/gm)].map(match => match[1])
    expect(keys).toEqual(
      expect.arrayContaining(['claude', 'subtle', 'success', 'warning', 'error']),
    )
  })

  it('domain imports only domain and contract types', () => {
    expect(
      violations('domain', (to, imp) => to === 'domain' || (to === 'contract' && imp.typeOnly)),
    ).toEqual([])
  })

  it('services import only domain, services, ports and types', () => {
    expect(
      violations(
        'services',
        (to, imp) =>
          to === 'domain' ||
          to === 'services' ||
          ((to === 'contract' || to === 'engine' || to === 'ports') && imp.typeOnly),
      ),
    ).toEqual([])
  })

  it('ui imports domain, ui, and only types from services and the engine', () => {
    expect(
      violations(
        'ui',
        (to, imp) =>
          to === 'domain' ||
          to === 'ui' ||
          ((to === 'services' || to === 'contract' || to === 'engine' || to === 'ports') &&
            imp.typeOnly),
      ),
    ).toEqual([])
  })

  it('nothing in plugin/ imports a package (PLAN §9)', () => {
    const packages = imports.filter(
      imp => !imp.specifier.startsWith('.') && imp.specifier !== 'claude-code',
    )
    expect(packages.map(imp => `${relative(root, imp.from)} → ${imp.specifier}`)).toEqual([])
  })

  it('only hooks/register.tsx spells $ (C2, F36)', () => {
    const spelling = files.filter(file => {
      if (relative(hooks, file) === 'register.tsx') return false
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""')
      return /(^|[^\w$])\$\s*[.,)]/.test(code)
    })
    expect(spelling.map(file => relative(root, file))).toEqual([])
  })

  it('services never import ui', () => {
    expect(violations('services', to => to !== 'ui')).toEqual([])
  })

  it("only register.tsx imports values from 'claude-code'", () => {
    const valued = imports.filter(
      imp =>
        imp.specifier === 'claude-code' &&
        !imp.typeOnly &&
        relative(hooks, imp.from) !== 'register.tsx' &&
        // `import { type A, type B }` is type-only too.
        !/import\s*\{(\s*type\s+\w+\s*,?)+\s*\}/.test(readFileSync(imp.from, 'utf8')),
    )
    expect(valued.map(imp => relative(root, imp.from))).toEqual([])
  })

  it('register.tsx declares every $-taking function at the top level (F40)', () => {
    const source = readFileSync(join(hooks, 'register.tsx'), 'utf8')
    const builders = [...source.matchAll(/^([ \t]*)function\s+(\w+)\s*\(\s*\$/gm)]
    expect(builders.length).toBeGreaterThan(0)
    expect(builders.filter(match => (match[1] ?? '') !== '').map(match => match[2])).toEqual([])
    // An arrow taking `$` as its only parameter, bound at any depth, is a nested builder.
    expect(source).not.toMatch(/=\s*\(\s*\$\s*(?::[^)]*)?\)\s*(?::[^=]*)?=>/)
  })

  it('ui names no process, store, env or command port', () => {
    const ui = files.filter(file => relative(hooks, file).startsWith('ui/'))
    const reaching = ui.filter(file =>
      /\b(ProcessPort|StorePort|EnvPort|CommandPort|Ports)\b/.test(readFileSync(file, 'utf8')),
    )
    expect(reaching.map(file => relative(root, file))).toEqual([])
  })

  it('ports.ts holds types only', () => {
    const source = existsSync(ports) ? readFileSync(ports, 'utf8') : ''
    expect(source).not.toMatch(/^\s*export\s+(const|let|function|class)\b/m)
  })

  it('no .catch handler references $ (review M2)', () => {
    const register = join(hooks, 'register.tsx')
    const source = readFileSync(register, 'utf8')
    const handlers = [
      ...source.matchAll(/\.catch\(([\s\S]*?)\)\s*(?:\n\s*\n|\n\s*on\(|\n\s*\}|$)/g),
    ].map(match => match[1] ?? '')
    expect(handlers.length).toBeGreaterThan(0)
    expect(handlers.filter(handler => /(^|[^\w$])\$\s*\./.test(handler))).toEqual([])
  })

  it('no module uses import() (a module holding it does not load)', () => {
    const dynamic = files.filter(file => /\bimport\s*\(/.test(readFileSync(file, 'utf8')))
    expect(dynamic.map(file => relative(root, file))).toEqual([])
  })
})

describe('source hygiene', () => {
  // Trojan Source: bidi controls and invisible characters must be written as escapes.
  const sources = ['plugin', 'test', 'scripts', 'site/src'].flatMap(dir => {
    try {
      return walk(join(root, dir))
    } catch {
      return []
    }
  })

  it('no source file holds a raw control, bidi or zero-width character', () => {
    const dirty = sources.filter(file =>
      hasHiddenCharacters(readFileSync(file, 'utf8').replace(/\r/g, '')),
    )
    expect(dirty.map(file => relative(root, file))).toEqual([])
  })
})
