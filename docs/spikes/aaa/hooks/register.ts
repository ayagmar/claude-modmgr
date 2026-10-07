import type { Register } from 'claude-code'
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.fs.write('/tmp/claude-1000/-home-ayagmar-projects/bc3dfdbe-f603-46cc-9da1-c322ea069397/scratchpad/spike/out/aaa-loaded.txt', 'loaded')
    return next(e)
  })
}
