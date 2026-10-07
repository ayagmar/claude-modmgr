// plugin/tests/fixtures.ts is generated from the captured CLI runs.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generate } from '../scripts/fixtures-to-plugin-tests.ts'

describe('plugin/tests/fixtures.ts', () => {
  it('is fresh (node scripts/fixtures-to-plugin-tests.ts)', () => {
    const current = readFileSync(
      join(import.meta.dirname, '..', 'plugin', 'tests', 'fixtures.ts'),
      'utf8',
    )
    expect(current).toBe(generate())
  })
})
