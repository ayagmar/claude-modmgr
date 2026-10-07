export const register = on => { on("session.start", ($, e, next) => { const p = $.process; return next(e) }) }
