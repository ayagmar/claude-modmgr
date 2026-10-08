import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..')
const readJson = (path: string): unknown => JSON.parse(readFileSync(join(root, path), 'utf8'))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// The marketplace is ayagmar/claude-mods: this repository holds the plugin only.
describe('the manifest', () => {
  const plugin = readJson('plugin/.claude-plugin/plugin.json')

  it('names the plugin modmgr (its tags are modmgr--v<version>)', () => {
    expect(isRecord(plugin) && plugin.name).toBe('modmgr')
  })

  it('declares the userConfig fields the README documents', () => {
    const config = isRecord(plugin) ? plugin.userConfig : undefined
    expect(isRecord(config) && Object.keys(config).sort()).toEqual([
      'debugTimings',
      'detectRemote',
      'updateCheckHours',
    ])
  })
})
