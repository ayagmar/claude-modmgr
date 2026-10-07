import { expect, test } from 'claude-code/testing'

test('/mods is registered at session start and answers', async ($, on) => {
  const registered: string[] = []
  on('command.register', (_$, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  expect(registered).toEqual(['mods'])

  const ran = await $.command.run({
    command: 'mods',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(ran.text).toBe('modmgr scaffold')
})
