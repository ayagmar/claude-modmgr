// The layering rules (PLAN §3 with C2), checked over every import in plugin/:
// - domain/ imports only domain/ (and the state contract's types);
// - services/ imports domain/, services/ and contract types;
// - ui/ imports domain/, ui/ and services' types only;
// - only hooks/register.tsx spells `$.` (F36: `$` can't cross a file);
// - hooks/ports.ts is types only, and services/ and ui/ import it as types;
// - no `.catch` handler touches `$` (on re-entry its `$` calls reject, review M2).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasHiddenCharacters } from '../plugin/hooks/domain/sanitize.ts'

const root = join(import.meta.dirname, '..')
const hooks = join(root, 'plugin', 'hooks')
const contract = join(root, 'plugin', 'types', 'index.d.ts')

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
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
