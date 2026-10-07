import { expect, test } from 'claude-code/testing'
import { host, MODS, START } from './harness.ts'

test('/mods is registered at session start and lists the mods found in the background', async ($, on) => {
  const h = host(on)
  await $.session.start(START)
  expect(h.registered()).toBe(1)
  // session.start defers everything past the registration and the queue takeover.
  expect(h.argvs).toEqual([])
  await h.clock.advance(1)
  expect(h.argvs[0]).toBe('--version')
  expect(h.argvs[1]).toBe('plugin list --json')

  const ran = await $.command.run(MODS)
  const lines = (ran.text ?? '').split('\n')
  expect(lines[0]).toBe('5 mods (5 on)')
  expect(lines.slice(1).map(line => line.split('  ')[1])).toEqual([
    'broken',
    'quiet-bash',
    'redactor',
    'spawner',
    'turn-band',
  ])
})
