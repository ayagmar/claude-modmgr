// Runs the plugin's `claude plugin test` files. They live in test/plugin/tests
// so they don't ship with plugin/; the engine runs a mod's tests from its own
// folder, so this copies plugin/ and them into one throwaway folder, with a
// throwaway config dir, and runs it there.
//
//   node scripts/test-plugin.ts
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const work = mkdtempSync(join(tmpdir(), 'modmgr-plugin-test-'))
try {
  const mod = join(work, 'modmgr')
  cpSync(join(root, 'plugin'), mod, { recursive: true })
  cpSync(join(root, 'test', 'plugin', 'tests'), join(mod, 'tests'), { recursive: true })
  const ran = spawnSync('claude', ['plugin', 'test', mod], {
    stdio: 'inherit',
    env: { ...process.env, CLAUDE_CONFIG_DIR: join(work, 'config') },
  })
  process.exitCode = ran.status ?? 1
} finally {
  rmSync(work, { recursive: true, force: true })
}
