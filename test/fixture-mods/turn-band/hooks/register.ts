// Fixture mod: display + what-the-model-sees reach.
export const register = on => {
  on('prompt.submit', async ($, e, next) => {
    await $.state.set({ plugin: 'turn-band', key: 'at', value: await $.clock.now() })
    return next(e)
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => next(e))
  on('turn.complete', ($, e, next) => {
    $.ui.toast('turn done')
    return next(e)
  })
}
