// Spike probe (M0). Logs to $PROBE_OUT (default /tmp/modmgr-probe.log).
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const starts = atom({ plugin: 'probe', key: 'starts' } as const, 0)
const GEN = Math.random().toString(36).slice(2, 8)

const log = async ($: any, line: string) => {
  const out = (await $.env.get('PROBE_OUT')) || '/tmp/modmgr-probe.log'
  let prev = ''
  try { prev = await $.fs.read(out) } catch {}
  await $.fs.write(out, `${prev}${new Date().toISOString()} gen=${GEN} ${line}\n`)
}

const reload = async ($: any, from: string) => {
  try {
    const r = await $.command.run({ command: 'reload-plugins' })
    await log($, `S8 ${from}: resolved ${JSON.stringify(r).slice(0, 200)}`)
  } catch (err) {
    await log($, `S8 ${from}: rejected ${String(err).slice(0, 300)}`)
  }
}

export const register: Register = on => {
  let registeredLogged = false

  on('session.start', async ($, e, next) => {
    await update($, starts, n => (n ?? 0) + 1)
    await log($, `session.start fired; e=${JSON.stringify(e)} starts=${await read($, starts)}`)
    await $.command.register({ name: 'probe', description: 'spike probe' })
    const panes = await $.ui.panes()
    await log($, `S9 panes at session.start: ${JSON.stringify(panes)}`)
    $.clock.after(0, async () => {
      if (registeredLogged) return
      registeredLogged = true
      await log($, `S11 surfaces=${JSON.stringify(await $.session.surfaces())}; version=${JSON.stringify(await $.session.version())}`)
      await log($, `S12 env CLAUDE_CODE_PLUGIN_DIRS=${JSON.stringify(await $.env.get('CLAUDE_CODE_PLUGIN_DIRS'))}`)
      {
        try {
          const env = await $.process.run(['env'], { timeoutMs: 5000 })
          const keys = env.stdout.split('\n').filter(l => /^(CLAUDE|AI_AGENT)/.test(l)).map(l => l.replace(/=.*/, l.startsWith('CLAUDE_CODE_PLUGIN_DIRS') ? l.slice(l.indexOf('=')) : '=…'))
          await log($, `S12 child env: ${keys.join(' ')}`)
          const list = await $.process.run(['claude', 'plugin', 'list', '--json'], { timeoutMs: 20000 })
          await log($, `S12 child list exit=${list.exitCode}: ${list.stdout.replace(/\s+/g, ' ').slice(0, 1500)}`)
        } catch (err) {
          await log($, `S11 process.run rejected: ${String(err)}`)
        }
      }
    })
    return next(e)
  }).catch((_$, e, next) => next(e))

  on('command.run', { command: 'probe' }, async ($, e) => {
    const answer = await answerProbe($, e)
    await log($, `answer /probe ${e.args.trim()} → ${answer.text}`)
    return answer
  }).catch(() => ({ text: 'probe: command hook failed' }))

  on('ui.render', { component: 'Pane', requestId: 'probe' }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const n = await read($, starts)
    return (
      <Box flexDirection="column">
        <Text>probe pane drawn by gen={GEN} starts={n} cols={e.props.bodyColumns} rows={e.props.scroll?.bodyRows ?? '?'}</Text>
        <Button key="reload" hotkey="r" label="reload from button" onPress={() => reload($, 'Button press handler')} />
        <Button key="reload-void" hotkey="v" label="reload from button (void)" onPress={() => { void reload($, 'Button press (void)') }} />
      </Box>
    )
  }).catch((_$, e, next) => next(e))
}

async function answerProbe($: any, e: any): Promise<{ text: string }> {
  {
    const arg = e.args.trim()
    await log($, `command /probe ${arg} origin=${JSON.stringify(e.origin)} presentation=${JSON.stringify(e.presentation)}`)
    if (arg === 'reload-cmd') {
      await reload($, 'command.run hook (awaited)')
      return { text: 'probe: reload from command hook attempted (see log)' }
    }
    if (arg === 'reload-cmd-void') {
      void reload($, 'command.run hook (not awaited)')
      return { text: 'probe: unawaited reload queued' }
    }
    if (arg === 'reload-timer') {
      $.clock.after(1500, () => reload($, 'clock.after callback'))
      return { text: 'probe: reload scheduled in 1.5 s' }
    }
    if (arg === 'pane') {
      const r = await $.ui.open({ id: 'probe', title: `probe ${GEN}`, focus: true, closeOnEscape: true, holdToasts: true, rows: 8 })
      await log($, `pane open result ${JSON.stringify(r)}`)
      return { text: 'probe: pane opened' }
    }
    if (arg.startsWith('exec ')) {
      const argv = arg.slice(5).split(' ')
      const r = await $.process.run(['claude', 'plugin', ...argv], { timeoutMs: 60000 })
      await log($, `S2 exec ${argv.join(' ')} exit=${r.exitCode} stdout=${r.stdout.replace(/\s+/g, ' ').slice(0, 1200)} stderr=${r.stderr.replace(/\s+/g, ' ').slice(0, 300)}`)
      return { text: `exec exit=${r.exitCode}` }
    }
    if (arg === 'fail') {
      throw new Error('probe deliberate failure')
    }
    return { text: `probe gen=${GEN} starts=${await read($, starts)}` }
  }
}
