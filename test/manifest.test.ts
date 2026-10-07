import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..')
const readJson = (path: string): unknown => JSON.parse(readFileSync(join(root, path), 'utf8'))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

describe('manifests', () => {
  const plugin = readJson('plugin/.claude-plugin/plugin.json')
  const marketplace = readJson('.claude-plugin/marketplace.json')

  it('name the plugin modmgr in the marketplace modmgr', () => {
    expect(isRecord(plugin) && plugin.name).toBe('modmgr')
    expect(isRecord(marketplace) && marketplace.name).toBe('modmgr')
  })

  it('agree on the version (claude plugin tag needs it)', () => {
    if (!isRecord(plugin) || !isRecord(marketplace) || !Array.isArray(marketplace.plugins)) {
      throw new Error('unexpected manifest shape')
    }
    const entry: unknown = marketplace.plugins.find(p => isRecord(p) && p.name === 'modmgr')
    expect(isRecord(entry) && entry.source).toBe('./plugin')
    expect(isRecord(entry) && entry.version).toBe(plugin.version)
  })

  it('declare the userConfig fields the plan names', () => {
    const config = isRecord(plugin) ? plugin.userConfig : undefined
    expect(isRecord(config) && Object.keys(config).sort()).toEqual([
      'debugTimings',
      'detectRemote',
      'updateCheckHours',
    ])
  })
})
