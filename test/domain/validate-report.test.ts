import { describe, expect, it } from 'vitest'
import { parseValidateReport, splitList } from '../../plugin/hooks/domain/validate-report.ts'
import { runs } from './fixtures/cli-runs.ts'

const report = (name: keyof typeof runs) => {
  const result = parseValidateReport(runs[name])
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

describe('splitList', () => {
  it('splits on commas outside braces and parens, dropping "nothing"', () => {
    expect(splitList('session.start, ui.render{component=Pane, requestId=x}, command.run')).toEqual(
      ['session.start', 'ui.render{component=Pane, requestId=x}', 'command.run'],
    )
    expect(splitList('$.fs.read (via log, other), $.ui.toast')).toEqual([
      '$.fs.read (via log, other)',
      '$.ui.toast',
    ])
    expect(splitList('nothing')).toEqual([])
    expect(splitList('a}, b')).toEqual(['a}', 'b'])
  })
})

describe('parseValidateReport', () => {
  it('reads hooks, calls, env and state from a real report', () => {
    expect(report('validate-redactor')).toMatchObject({
      success: true,
      hasModule: true,
      events: ['session.append', 'session.end'],
      calls: ['env.get', 'http.fetch', 'session.messages'],
      envReads: ['GITHUB_TOKEN', 'HOME', 'OPENAI_API_KEY'],
      envWrites: [],
      uncaughtGates: [],
    })
  })

  it('strips matchers and via-notes', () => {
    const value = report('validate-turn-band')
    expect(value.events).toEqual(['prompt.submit', 'turn.complete', 'ui.render'])
    expect(value.calls).toEqual(['clock.now', 'state.set', 'ui.toast'])
    expect(value.stateWrites).toEqual(['turn-band.at'])
    expect(value.uncaughtGates).toEqual(['prompt.submit'])
  })

  it('reports no module for a skills-only plugin', () => {
    expect(report('validate-plain-skill')).toMatchObject({
      success: true,
      hasModule: false,
      events: [],
    })
  })

  it('reports errors of a broken mod', () => {
    const value = report('validate-broken')
    expect(value.success).toBe(false)
    expect(value.hasModule).toBe(true)
    expect(value.errors[0]?.message).toMatch(/\$\.process is used as a value/)
  })

  it('reads warnings and tolerates odd shapes', () => {
    const stdout = JSON.stringify({
      success: true,
      manifest: { warnings: [{ path: 'author', message: 'No author' }, 'junk'], notes: [3] },
      contents: [{ type: 'hooks', notes: ['./m.ts calls: $.x.y', './m.ts unknown: a'] }, 'junk'],
    })
    const result = parseValidateReport({ stdout, exitCode: 0, stderr: '' })
    expect(result.ok && result.value).toMatchObject({
      warnings: [{ path: 'author', message: 'No author' }],
      calls: ['x.y'],
    })
  })

  it('fails when no report was printed', () => {
    expect(parseValidateReport({ stdout: 'oops', exitCode: 1, stderr: '' }).ok).toBe(false)
    expect(parseValidateReport({ stdout: '{"success":"yes"}', exitCode: 0, stderr: '' }).ok).toBe(
      false,
    )
  })
})
