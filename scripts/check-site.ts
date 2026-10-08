// Checks the built site (PLAN §8): every internal link and asset resolves in
// site/dist, and what a first visit transfers stays under 100 KB, fonts aside.
//
//   pnpm --filter modmgr-site build && node scripts/check-site.ts
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const dist = join(import.meta.dirname, '../site/dist')
const BASE = '/modmgr/'
const BUDGET = 100 * 1024

const html = readFileSync(join(dist, 'index.html'), 'utf8')
const problems: string[] = []
const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map(match => match[1] ?? '')
let assets = 0
for (const ref of refs) {
  if (/^(https?:|mailto:|#)/.test(ref)) continue
  if (!ref.startsWith(BASE)) {
    problems.push(`not under ${BASE}: ${ref}`)
    continue
  }
  const path = join(dist, ref.slice(BASE.length).split('#')[0] || 'index.html')
  if (!existsSync(path)) problems.push(`missing: ${ref}`)
  // What a visit loads: not the pages and the sitemap it links to, and not fonts.
  else if (!/\.(woff2|html|xml)$/.test(path)) assets += statSync(path).size
}
for (const id of [...html.matchAll(/href="#([^"]+)"/g)].map(match => match[1])) {
  if (!html.includes(`id="${id}"`)) problems.push(`no element with id ${id}`)
}
const page = gzipSync(html).length
const total = page + assets
console.log(
  `index.html ${html.length} B (${page} B gzipped); other assets ${assets} B; fonts aside`,
)
if (total > BUDGET) problems.push(`a first visit transfers ${total} B, over ${BUDGET} B`)
if (problems.length > 0) {
  for (const problem of problems) console.error(`✗ ${problem}`)
  process.exit(1)
}
console.log('✓ links resolve and the page is within budget')
