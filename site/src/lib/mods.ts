// The community index at build time: the file named by MODS_INDEX when set (a
// local build, or one being tried out), else the one CI publishes daily. What
// each mod can do is computed by the plugin's own capabilities.ts, so the page
// and Discover say the same thing. A build with no readable index fails: a
// page whose search finds nothing would say something untrue.

import { readFileSync } from 'node:fs'
import { capabilitiesOf } from '../../../plugin/hooks/domain/capabilities.ts'
import { COMMUNITY_URL, parseCommunity } from '../../../plugin/hooks/domain/community.ts'
import { type Data, NOTABLE_BITS, REACH_BITS, type Row } from './search.ts'

const DAY = 24 * 60 * 60 * 1000
/** Results show a line or two; the full text is on GitHub. */
const DESCRIPTION_MAX = 180

const cut = (text: string): string => {
  const points = Array.from(text)
  return points.length <= DESCRIPTION_MAX
    ? text
    : `${points
        .slice(0, DESCRIPTION_MAX - 1)
        .join('')
        .trimEnd()}…`
}

const bits = <K extends string>(names: readonly string[], table: Readonly<Record<K, number>>) =>
  names.reduce((sum, name) => sum | ((table as Record<string, number>)[name] ?? 0), 0)

const CHECK = { passed: 0, warnings: 1, failed: 2 } as const

let loaded: Promise<Data> | undefined

const read = async (): Promise<Data> => {
  const path = process.env.MODS_INDEX
  const text =
    path !== undefined && path !== ''
      ? readFileSync(path, 'utf8')
      : await fetch(COMMUNITY_URL).then(response => {
          if (!response.ok) throw new Error(`${COMMUNITY_URL} answered ${response.status}`)
          return response.text()
        })
  const parsed = parseCommunity(text)
  if (!parsed.ok) throw new Error(`the community index is unusable: ${parsed.error.message}`)
  const rows = parsed.value.mods.map((mod): Row => {
    const caps = capabilitiesOf(mod)
    return [
      mod.name,
      cut(mod.description),
      mod.repo,
      mod.path,
      mod.stars,
      Math.floor(mod.pushed / DAY),
      bits(caps.reach, REACH_BITS),
      bits(caps.notable, NOTABLE_BITS),
      CHECK[mod.check],
      mod.market === undefined ? '' : `${mod.market.plugin}@${mod.market.name}`,
    ]
  })
  return { at: parsed.value.at, rows }
}

/** The index, read once per build. */
export const modsData = (): Promise<Data> => {
  loaded ??= read()
  return loaded
}
