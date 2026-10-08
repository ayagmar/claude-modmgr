// `claude plugin validate --strict --json plugin`, plus the verdicts modmgr
// relies on: no errors or warnings, `/mods` answers its own
// command (it is not a gate), no gate beyond its own pane's, no plugin.register hook, no telemetry, no
// environment writes. Runs with a throwaway CLAUDE_CONFIG_DIR.
//
//   node scripts/validate-plugin.ts
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type Section = {
  errors: unknown[]
  warnings: unknown[]
  notes: string[]
}

const root = join(import.meta.dirname, '..')
const config = mkdtempSync(join(tmpdir(), 'modmgr-validate-'))
let stdout: string
try {
  stdout = execFileSync(
    'claude',
    ['plugin', 'validate', '--strict', '--json', join(root, 'plugin')],
    {
      env: { ...process.env, CLAUDE_CONFIG_DIR: config },
      encoding: 'utf8',
    },
  )
} catch (error) {
  stdout = (error as { stdout?: string }).stdout ?? ''
} finally {
  rmSync(config, { recursive: true, force: true })
}

const report = JSON.parse(stdout) as { success: boolean; manifest: Section; contents: Section[] }
const sections = [report.manifest, ...report.contents]
const notes = sections.flatMap(section => section.notes)
const problems: string[] = []
const check = (ok: boolean, what: string) => {
  if (!ok) problems.push(what)
}

check(report.success, 'validate --strict did not succeed')
check(
  sections.every(s => s.errors.length === 0),
  `errors: ${JSON.stringify(sections.flatMap(s => s.errors))}`,
)
check(
  sections.every(s => s.warnings.length === 0),
  `warnings: ${JSON.stringify(sections.flatMap(s => s.warnings))}`,
)
check(
  notes.some(note => note.endsWith('answers its own command: command.run{command=mods}')),
  '/mods is no longer "answering its own command": is the registration literal still in register.tsx?',
)
// The only gates modmgr may hold are on its own pane: the Esc cascade keeps it
// open (ui.close) and the focus ring is observed (ui.focus); and the session's
// notices, observed for Dev's failures (it returns what `next` stored, so
// it changes no row, and notices are rows the model never reads). Each has a .catch.
const OWN_GATES = [
  'gating hook with .catch: ui.focus{component=Pane, requestId=modmgr}',
  'gating hook with .catch: ui.close{id=modmgr}',
  'gating hook with .catch: session.append{door=notice}',
]
const gates = notes.filter(note => / gating hook/.test(note))
check(
  gates.every(note => OWN_GATES.some(own => note.endsWith(own))),
  `a gating hook appeared: ${gates.filter(n => !OWN_GATES.some(own => n.endsWith(own))).join('; ')}`,
)
check(
  !notes.some(note => / hooks: .*plugin\.register/.test(note)),
  'modmgr hooks plugin.register (it must gate no other plugin)',
)
check(
  !notes.some(note => / calls: .*\$\.telemetry\./.test(note)),
  'modmgr calls $.telemetry (it sends no telemetry)',
)
check(
  notes.some(note => / env writes: nothing$/.test(note)),
  'modmgr writes environment variables',
)

for (const note of notes) console.log(`  ${note}`)
if (problems.length > 0) {
  for (const problem of problems) console.error(`✗ ${problem}`)
  process.exit(1)
}
console.log('✓ plugin validates strictly with the expected verdicts')
