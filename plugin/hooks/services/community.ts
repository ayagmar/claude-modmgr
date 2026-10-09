// Reads the community index (domain/community.ts): the mods CI found on public
// GitHub. Kept in module memory only (about 1 MB, more than the store holds),
// so each new module asks once, then again past COMMUNITY_MAX_AGE_MS, and at
// most once an hour after a failure. Off with remote reads (`detectRemote`, the
// traffic switch). Any failure is quiet: Discover lists the catalogue alone.

import {
  COMMUNITY_MAX_BYTES,
  COMMUNITY_URL,
  type CommunityFile,
  parseCommunity,
} from '../domain/community.ts'
import type { Ports } from '../ports.ts'

/** The index is rebuilt daily; twice a day catches a rebuild soon enough. */
export const COMMUNITY_MAX_AGE_MS = 12 * 60 * 60 * 1000
export const COMMUNITY_RETRY_MS = 60 * 60 * 1000

export type Community = {
  /** The index, read now when what is held is old; undefined when there is none. */
  read(): Promise<CommunityFile | undefined>
}

/** Beside an index being tried out (`MODMGR_INDEX_URL`), its community file. */
export const trialUrl = (indexUrl: string | undefined): string | undefined =>
  indexUrl !== undefined && /^https?:\/\/[^?#]+\/[^/?#]+$/.test(indexUrl)
    ? indexUrl.replace(/\/[^/]+$/, '/mods-v1.json')
    : undefined

export const createCommunity = (
  ports: Pick<Ports, 'http' | 'clock' | 'env'>,
  deps: {
    readonly allowed: () => Promise<boolean>
    readonly debug?: (text: string) => void
  },
): Community => {
  const debug = deps.debug ?? (() => {})
  let held: { file: CommunityFile; at: number } | undefined
  let failedAt: number | undefined
  let reading: Promise<CommunityFile | undefined> | undefined

  const fetchFile = async (): Promise<CommunityFile | undefined> => {
    if (!(await deps.allowed())) return undefined
    const now = await ports.clock.now()
    const trial = trialUrl(await ports.env.indexUrl().catch(() => undefined))
    if (trial === undefined) {
      if (held !== undefined && now - held.at < COMMUNITY_MAX_AGE_MS) return held.file
      if (failedAt !== undefined && now - failedAt < COMMUNITY_RETRY_MS) return held?.file
    }
    const url = trial ?? COMMUNITY_URL
    const answer = await ports.http.get(url, COMMUNITY_MAX_BYTES).catch((error: unknown) => {
      debug(`modmgr: community index ${url} failed: ${String(error)}`)
      return undefined
    })
    const parsed = answer?.status === 200 ? parseCommunity(answer.text) : undefined
    if (parsed?.ok !== true) {
      if (answer !== undefined) {
        debug(
          `modmgr: community index ${url} ${parsed === undefined ? `answered ${answer.status}` : `unusable: ${parsed.error.message}`}`,
        )
      }
      failedAt = now
      return held?.file
    }
    held = { file: parsed.value, at: now }
    failedAt = undefined
    return held.file
  }

  return {
    read() {
      reading ??= fetchFile().finally(() => {
        reading = undefined
      })
      return reading
    },
  }
}
