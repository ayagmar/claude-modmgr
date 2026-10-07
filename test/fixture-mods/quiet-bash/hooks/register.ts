// Fixture mod: machine reach + tools.
export const register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    await $.process.run(['true'])
    return ran
  })
}
