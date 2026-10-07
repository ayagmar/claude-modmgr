// S6: detector latency. Usage: node probe-latency.mjs <available.json> [n=50] [concurrency=6] [seed=1]
// Mirrors PLAN §2.3: hooks/hooks.json at <sha>/<path>; on 404, .claude-plugin/plugin.json.
import { readFileSync } from 'node:fs'

const [file, nArg = '50', concArg = '6', seedArg = '1'] = process.argv.slice(2)
const all = JSON.parse(readFileSync(file, 'utf8')).available
let seed = Number(seedArg)
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)

const ghRepo = url => url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/)
const base = e => {
  const s = e.source
  if (typeof s !== 'object' || !s?.sha || !s.url) return undefined
  const m = ghRepo(s.url)
  if (!m) return undefined
  const segs = s.source === 'git-subdir' ? s.path.split('/').filter(Boolean) : []
  if (segs.some(x => x === '..' || x === '.')) return undefined
  const sub = segs.map(encodeURIComponent).join('/')
  return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${s.sha}/${sub ? `${sub}/` : ''}`
}

const remote = all.filter(base)
const pick = []
while (pick.length < Number(nArg)) {
  const e = remote[Math.floor(rand() * remote.length)]
  if (!pick.includes(e)) pick.push(e)
}

const get = async url => {
  const t = performance.now()
  const r = await fetch(url, { redirect: 'follow' })
  const body = r.ok ? await r.text() : (await r.arrayBuffer(), '')
  return { status: r.status, ms: performance.now() - t, bytes: body.length, body }
}

const results = []
const queue = [...pick]
const worker = async () => {
  for (let e = queue.shift(); e; e = queue.shift()) {
    const b = base(e)
    const t = performance.now()
    let kind = 'unknown'
    const steps = []
    try {
      const h = await get(`${b}hooks/hooks.json`)
      steps.push(h.status)
      if (h.status === 200) kind = /"modules"/.test(h.body) ? 'mod' : 'hooks'
      else if (h.status === 404) {
        const p = await get(`${b}.claude-plugin/plugin.json`)
        steps.push(p.status)
        kind = p.status === 200 ? (/"hooks"/.test(p.body) ? 'hooks' : 'plain') : 'unknown'
      }
    } catch (err) {
      steps.push(String(err))
    }
    results.push({ id: e.pluginId, kind, steps, ms: performance.now() - t })
  }
}
const t0 = performance.now()
await Promise.all(Array.from({ length: Number(concArg) }, worker))
const wall = performance.now() - t0
const ms = results.map(r => r.ms).sort((a, b) => a - b)
const q = p => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))].toFixed(0)
const count = k => results.filter(r => r.kind === k).length
console.log(JSON.stringify({ n: results.length, concurrency: Number(concArg), wallMs: Math.round(wall), p50: q(0.5), p95: q(0.95), max: q(0.999),
  kinds: { mod: count('mod'), hooks: count('hooks'), plain: count('plain'), unknown: count('unknown') },
  statuses: results.reduce((a, r) => ((a[r.steps.join('>')] = (a[r.steps.join('>')] ?? 0) + 1), a), {}) }, null, 1))
