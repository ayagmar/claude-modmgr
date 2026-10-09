// What modmgr shows outside the dialog besides the band:
// the status line under the prompt and the pane's title. Both come from the
// same summary the band draws (domain/view.ts `summaryOf`), so the three never
// disagree. The runtime's state writes to `attention`, `queue` and `mods`
// schedule a sync; one runs at a time and says only what changed.

import { holdsToasts, PANE_ID, paneOpen, statusLineOf, summaryOf, titleOf } from '../domain/view.ts'
import type { Ports } from '../ports.ts'

export type ChromePorts = Pick<Ports, 'state' | 'ui' | 'clock'>

export type Chrome = {
  /** Syncs soon (on the clock): many writes in a row cost one sync. */
  schedule(): void
  /** Syncs now. */
  sync(): Promise<void>
}

export const createChrome = (
  ports: ChromePorts,
  debug: (text: string) => void = () => {},
): Chrome => {
  // What the status line says now; `null` until this module first sets it (a
  // reloaded module can't know what the last one left, so it always sets it).
  let shown: string | undefined | null = null
  let timer: { cancel(): void } | undefined
  let running: Promise<void> | undefined
  let again = false

  const once = async (): Promise<void> => {
    const [attention, queue, mods, view] = await Promise.all([
      ports.state.read('attention'),
      ports.state.read('queue'),
      ports.state.read('mods'),
      ports.state.read('view'),
    ])
    const summary = summaryOf({ attention, queue, mods })
    const status = statusLineOf(summary)
    if (status !== shown) {
      ports.ui.status(status)
      shown = status
    }
    // A retitle is an open: it sets the manners anew, so it re-sends
    // them (toasts held only while nothing runs) and never asks for the keys;
    // and only for a pane already drawn, which an unasked open would not place.
    const title = titleOf(summary)
    const pane = (await ports.ui.panes()).find(item => item.id === PANE_ID)
    if (pane?.isPlaced === true && pane.title !== title) {
      const hold = holdsToasts(queue, view)
      const opened = await ports.ui.open(
        paneOpen({ focus: false, hold, mods: mods.length, title, dock: view.dock }),
      )
      // A placed pane stays placed when retitled; if the engine ever disagrees, say so.
      if (!opened.isPlaced) debug(`modmgr: retitle left the pane unplaced: ${opened.reason}`)
    }
  }

  const sync = (): Promise<void> => {
    if (running !== undefined) {
      again = true
      return running
    }
    running = (async () => {
      do {
        again = false
        try {
          await once()
        } catch (error) {
          debug(`modmgr: status line failed: ${String(error)}`)
        }
      } while (again)
    })().finally(() => {
      running = undefined
    })
    return running
  }

  return {
    schedule() {
      if (timer !== undefined) return
      timer = ports.clock.after(0, () => {
        timer = undefined
        void sync()
      })
    },
    sync,
  }
}
