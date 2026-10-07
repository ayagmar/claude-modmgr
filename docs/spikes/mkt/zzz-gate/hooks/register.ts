import type { Register } from 'claude-code'
const OUT = '/tmp/claude-1000/-home-ayagmar-projects/bc3dfdbe-f603-46cc-9da1-c322ea069397/scratchpad/spike/out'
export const register: Register = on => {
  const seen: string[] = []
  on('plugin.register', async ($, e, next) => {
    seen.push(e.name + ' tier=' + e.tier + ' prov=' + e.provenance + ' events=' + e.uses.events.join(',') + ' calls=' + e.uses.calls.join(','))
    await $.fs.write(OUT + '/gate-seen.txt', seen.join('\n'))
    if (e.name === 'never') return { refuse: 'spike: disabled by gate' }
    return next(e)
  })
  on('session.start', async ($, e, next) => {
    const cmds = (await $.command.list()).map(c => c.name).filter(n => /reload|plugin/.test(n))
    await $.fs.write(OUT + '/gate-start.txt', 'seen-at-start:\n' + seen.join('\n') + '\ncmds:' + cmds.join(','))
    return next(e)
  })
}
