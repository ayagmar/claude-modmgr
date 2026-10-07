// Fixture mod: model calls (cost tokens), plugin judging.
export const register = on => {
  on('plugin.register', ($, e, next) => next(e)).catch(($, e, next) => next(e))
  on('turn.complete', async ($, e, next) => {
    await $.model.complete({ model: 'haiku', prompt: 'ok?' })
    return next(e)
  })
}
