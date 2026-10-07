import type { Register } from 'claude-code'

// Wiring only (PLAN §3). M0: registers /mods and answers with a scaffold line.
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'mods',
      description: 'Discover, inspect, toggle and update mods',
    })
    return next(e)
  }).catch((_$, e, next) => next(e))

  on('command.run', { command: 'mods' }, () => ({ text: 'modmgr scaffold' })).catch(() => ({
    text: 'modmgr failed to answer; run with --debug for the reason.',
  }))
}
