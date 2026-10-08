import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  capabilitiesOf,
  diffCapabilities,
  explainCall,
  explainEvent,
  groupByReach,
  isEmptyDiff,
  NOTABLE_IDS,
  notableOf,
  notableText,
  REACH_LABEL,
  REACH_ORDER,
  reachOfCall,
  reachOfEvent,
  secretEnvReads,
} from '../../plugin/hooks/domain/capabilities.ts'
import { CALLS, EVENTS } from '../../plugin/hooks/domain/explanations.ts'
import { parseValidateReport } from '../../plugin/hooks/domain/validate-report.ts'
import { generate } from '../../scripts/gen-explanations.ts'
import { runs } from './fixtures/cli-runs.ts'

const capsOf = (name: keyof typeof runs) => {
  const report = parseValidateReport(runs[name])
  if (!report.ok) throw new Error(report.error.message)
  return capabilitiesOf(report.value)
}

describe('reach', () => {
  it.each([
    ['process.run', 'machine'],
    ['fs.read', 'machine'],
    ['http.fetch', 'network'],
    ['telemetry.log', 'network'],
    ['session.messages', 'session'],
    ['session.cwd', 'session'],
    ['prompt.fill', 'model'],
    ['agent.spawn', 'tools'],
    ['config.set', 'plugins'],
    ['ui.toast', 'display'],
    ['command.register', 'display'],
    ['unknown.thing', 'display'],
  ] as const)('call %s → %s', (call, reach) => expect(reachOfCall(call)).toBe(reach))

  it.each([
    ['prompt.compose', 'model'],
    ['session.append', 'model'],
    ['tool.call', 'tools'],
    ['plugin.register', 'plugins'],
    ['classic.Stop', 'plugins'],
    ['process.run', 'plugins'],
    ['ui.render', 'display'],
    ['session.start', 'display'],
  ] as const)('event %s → %s', (event, reach) => expect(reachOfEvent(event)).toBe(reach))

  it('labels every reach', () => {
    for (const reach of REACH_ORDER) expect(REACH_LABEL[reach].length).toBeGreaterThan(0)
  })
})

describe('notable', () => {
  it('flags the redactor fixture: reads + sends, secret env', () => {
    const caps = capsOf('validate-redactor')
    expect(caps.notable).toEqual(['reads-and-sends', 'secret-env', 'changes-model-input'])
    expect(caps.reach).toEqual(['network', 'session', 'model', 'display'])
  })

  it('flags machine reach, plugin judging and model spend', () => {
    expect(capsOf('validate-quiet-bash').notable).toEqual(['runs-programs'])
    expect(capsOf('validate-spawner').notable).toEqual(['judges-plugins', 'starts-model-calls'])
    expect(capsOf('validate-turn-band').notable).toEqual(['changes-model-input'])
  })

  it('needs both halves for reads-and-sends', () => {
    expect(notableOf({ events: [], calls: ['session.messages'], envReads: [] })).toEqual([])
    expect(notableOf({ events: [], calls: ['http.fetch'], envReads: [] })).toEqual([])
  })

  it('names the facts behind each item', () => {
    const items = notableOf({
      events: ['classic.Stop', 'prompt.submit'],
      calls: ['prompt.fill', 'mcp.call', 'fs.read'],
      envReads: ['AWS_SECRET_ACCESS_KEY', 'PATH'],
    })
    expect(items.find(item => item.id === 'reads-and-sends')?.because).toEqual([
      'fs.read',
      'env.get AWS_SECRET_ACCESS_KEY',
      'mcp.call',
    ])
    expect(items.find(item => item.id === 'judges-plugins')?.because).toEqual(['classic.Stop'])
    expect(items.find(item => item.id === 'changes-model-input')?.because).toEqual([
      'prompt.submit',
      '$.prompt.fill',
    ])
  })

  it('spots secret-looking env names only', () => {
    expect(secretEnvReads(['HOME', 'GITHUB_TOKEN', 'api_key', 'PATH', 'DB_PASSWORD'])).toEqual([
      'GITHUB_TOKEN',
      'api_key',
      'DB_PASSWORD',
    ])
  })

  it('has text for every id and passes unknown ids through', () => {
    for (const id of NOTABLE_IDS) expect(notableText(id)).not.toBe(id)
    expect(notableText('future-thing')).toBe('future-thing')
  })
})

describe('groupByReach', () => {
  it('groups in reach order with explanations from the d.ts', () => {
    const groups = groupByReach(capsOf('validate-redactor'))
    expect(groups.map(group => group.reach)).toEqual(['network', 'session', 'model', 'display'])
    const network = groups[0]
    expect(network?.items[0]).toMatchObject({ name: 'http.fetch', kind: 'call' })
    expect(network?.items[0]?.line).toMatch(/Fetches url through the host/)
  })

  it('falls back for unknown names', () => {
    expect(explainCall('nope.nope')).toMatch(/No description/)
    expect(explainEvent('classic.Stop')).toBe('A settings hook event.')
    expect(explainEvent('nope.nope')).toMatch(/No description/)
  })
})

describe('diffCapabilities', () => {
  it('reports what an update added and removed', () => {
    const before = capsOf('validate-turn-band')
    const after = capsOf('validate-quiet-bash')
    const diff = diffCapabilities(before, after)
    expect(diff.addedNotable).toEqual(['runs-programs'])
    expect(diff.removedNotable).toEqual(['changes-model-input'])
    expect(diff.addedCalls).toEqual(['process.run'])
    expect(diff.addedEvents).toEqual(['tool.call'])
    expect(isEmptyDiff(diff)).toBe(false)
    expect(isEmptyDiff(diffCapabilities(before, before))).toBe(true)
  })
})

describe('explanations.ts', () => {
  it('is fresh: regenerating from the vendored d.ts changes nothing', () => {
    const root = join(import.meta.dirname, '..', '..')
    const dts = readFileSync(
      join(root, 'vendor/claude-code-types/2.1.293/claude-code.d.ts'),
      'utf8',
    )
    const current = readFileSync(join(root, 'plugin/hooks/domain/explanations.ts'), 'utf8')
    expect(generate(dts)).toBe(current)
  })

  it('covers every call and event the reach tables name', () => {
    for (const call of [
      'process.run',
      'http.fetch',
      'session.messages',
      'settings.read',
      'mcp.call',
    ]) {
      expect(CALLS[call]).toBeDefined()
    }
    for (const event of ['tool.call', 'prompt.compose', 'session.append', 'plugin.register']) {
      expect(EVENTS[event]).toBeDefined()
    }
  })
})
