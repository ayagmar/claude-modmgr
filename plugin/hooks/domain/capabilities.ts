// Capabilities as facts: what a mod hooks and calls, grouped by
// reach, plus a short list of "notable" combinations. No score: the facts and
// the combinations are what a person can act on.

import type { Capabilities, Reach } from '../../types/index.d.ts'
import { CALLS, EVENTS } from './explanations.ts'

export type { Capabilities, Reach }

export const REACH_ORDER: readonly Reach[] = [
  'machine',
  'network',
  'session',
  'model',
  'tools',
  'plugins',
  'display',
]

export const REACH_LABEL: Readonly<Record<Reach, string>> = {
  machine: 'Your machine',
  network: 'Network',
  session: 'Session content',
  model: 'What the model sees',
  tools: 'Tools and turns',
  plugins: 'Other plugins',
  display: 'Display only',
}

// Exact calls first, then the noun's default.
const CALL_REACH: Readonly<Record<string, Reach>> = {
  'process.run': 'machine',
  'process.spawn': 'machine',
  'fs.write': 'machine',
  'fs.read': 'machine',
  'fs.list': 'machine',
  'fs.stat': 'machine',
  'fs.ancestors': 'machine',
  'env.set': 'machine',
  'http.fetch': 'network',
  'mcp.call': 'network',
  'session.messages': 'session',
  'settings.read': 'session',
  'env.get': 'session',
  'prompt.read': 'session',
  'ui.selection': 'session',
  'prompt.fill': 'model',
  'session.append': 'model',
  'prompt.submit': 'model',
  'session.send': 'model',
  'session.compact': 'model',
  'tool.register': 'tools',
  'tool.call': 'tools',
  'agent.spawn': 'tools',
  'agent.register': 'tools',
  'model.complete': 'tools',
  'model.fork': 'tools',
  'command.run': 'tools',
  'command.register': 'display',
  'config.set': 'plugins',
}

const NOUN_REACH: Readonly<Record<string, Reach>> = {
  process: 'machine',
  fs: 'machine',
  env: 'session',
  http: 'network',
  mcp: 'network',
  telemetry: 'network',
  settings: 'session',
  session: 'session',
  prompt: 'model',
  tool: 'tools',
  agent: 'tools',
  model: 'tools',
  command: 'tools',
  config: 'plugins',
}

const EVENT_REACH: Readonly<Record<string, Reach>> = {
  'prompt.submit': 'model',
  'prompt.compose': 'model',
  'prompt.context': 'model',
  'session.append': 'model',
  'tool.describe': 'model',
  'turn.step': 'model',
  'model.complete': 'model',
  'tool.call': 'tools',
  'tool.check': 'tools',
  'agent.spawn': 'tools',
  'agent.offer': 'tools',
  'command.run': 'tools',
  'plugin.register': 'plugins',
  'engine.create': 'plugins',
  'state.set': 'plugins',
  'config.set': 'plugins',
}

export const reachOfCall = (call: string): Reach =>
  CALL_REACH[call] ?? NOUN_REACH[call.split('.')[0] ?? ''] ?? 'display'

export const reachOfEvent = (event: string): Reach => {
  if (event.startsWith('classic.')) return 'plugins'
  // Op events (`process.run`, `http.fetch`, …) intercept other plugins' `$` calls.
  if (CALL_REACH[event] !== undefined && EVENT_REACH[event] === undefined) return 'plugins'
  return EVENT_REACH[event] ?? 'display'
}

export const NOTABLE_IDS = [
  'runs-programs',
  'reads-and-sends',
  'secret-env',
  'changes-model-input',
  'judges-plugins',
  'starts-model-calls',
] as const
export type NotableId = (typeof NOTABLE_IDS)[number]

const NOTABLE_TEXT: Readonly<Record<NotableId, string>> = {
  'runs-programs': 'Can run programs or change files on your machine',
  'reads-and-sends': 'Can read your conversation or files and send data out',
  'secret-env': 'Reads environment variables that look like secrets',
  'changes-model-input': 'Can change what the model reads',
  'judges-plugins': 'Judges other plugins',
  'starts-model-calls': 'Starts model calls (costs tokens)',
}

export const notableText = (id: string): string =>
  (NOTABLE_TEXT as Readonly<Record<string, string>>)[id] ?? id

/** The same, after "<mod> can now …" (the band's capability diff). */
const NOTABLE_VERB: Readonly<Record<NotableId, string>> = {
  'runs-programs': 'run programs',
  'reads-and-sends': 'read your conversation and send data out',
  'secret-env': 'read secret-looking variables',
  'changes-model-input': 'change what the model reads',
  'judges-plugins': 'judge other plugins',
  'starts-model-calls': 'start model calls',
}

export const notableVerb = (id: string): string =>
  (NOTABLE_VERB as Readonly<Record<string, string>>)[id] ?? `do more (${id})`

const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION/i
const RUNS = ['process.run', 'process.spawn', 'fs.write', 'env.set']
const READS = ['session.messages', 'settings.read', 'prompt.read', 'ui.selection', 'fs.read']
const SENDS = ['http.fetch', 'mcp.call']
const MODEL_EVENTS = ['prompt.submit', 'prompt.compose', 'prompt.context', 'session.append']
const MODEL_CALLS = ['prompt.fill', 'session.append']
const JUDGES = ['plugin.register', 'engine.create']
const SPENDS = ['model.complete', 'model.fork', 'agent.spawn']

export const secretEnvReads = (envReads: readonly string[]): string[] =>
  envReads.filter(name => SECRET_NAME.test(name))

export type Notable = { readonly id: NotableId; readonly text: string; readonly because: string[] }

const hits = (have: readonly string[], want: readonly string[]): string[] =>
  want.filter(item => have.includes(item))

/** The notable combinations, most serious first, each with the facts behind it. */
/** What a mod hooks, calls and reads: a validate report, a cached analysis, or Capabilities. */
export type CapabilityFacts = {
  readonly events: readonly string[]
  readonly calls: readonly string[]
  readonly envReads: readonly string[]
}

export const notableOf = (caps: CapabilityFacts): Notable[] => {
  const found: Notable[] = []
  const add = (id: NotableId, because: string[]) => {
    if (because.length > 0) found.push({ id, text: NOTABLE_TEXT[id], because })
  }
  add('runs-programs', hits(caps.calls, RUNS))
  const secrets = secretEnvReads(caps.envReads)
  const reads = [...hits(caps.calls, READS), ...secrets.map(name => `env.get ${name}`)]
  const sends = hits(caps.calls, SENDS)
  add('reads-and-sends', reads.length > 0 && sends.length > 0 ? [...reads, ...sends] : [])
  add('secret-env', secrets)
  add('changes-model-input', [
    ...hits(caps.events, MODEL_EVENTS),
    ...hits(caps.calls, MODEL_CALLS).map(call => `$.${call}`),
  ])
  add('judges-plugins', [
    ...hits(caps.events, JUDGES),
    ...caps.events.filter(event => event.startsWith('classic.')),
  ])
  add('starts-model-calls', hits(caps.calls, SPENDS))
  return found
}

const sortedUnique = (values: Iterable<string>): string[] => [...new Set(values)].sort()

export const capabilitiesOf = (report: CapabilityFacts): Capabilities => {
  const events = sortedUnique(report.events)
  const calls = sortedUnique(report.calls)
  const envReads = sortedUnique(report.envReads)
  const reach = new Set<Reach>([...calls.map(reachOfCall), ...events.map(reachOfEvent)])
  return {
    events,
    calls,
    envReads,
    reach: REACH_ORDER.filter(item => reach.has(item)),
    notable: notableOf({ events, calls, envReads }).map(item => item.id),
  }
}

export type ReachGroup = {
  readonly reach: Reach
  readonly label: string
  readonly items: {
    readonly name: string
    readonly kind: 'call' | 'event'
    readonly line: string
  }[]
}

const FALLBACK_LINE = 'No description in this Claude Code version.'

export const explainCall = (call: string): string => CALLS[call] ?? FALLBACK_LINE
export const explainEvent = (event: string): string =>
  EVENTS[event] ?? (event.startsWith('classic.') ? 'A settings hook event.' : FALLBACK_LINE)

/** Facts grouped by reach, in REACH_ORDER, for the detail view. */
export const groupByReach = (caps: Pick<Capabilities, 'events' | 'calls'>): ReachGroup[] => {
  const groups = new Map<Reach, ReachGroup['items']>()
  const push = (reach: Reach, item: ReachGroup['items'][number]) =>
    groups.set(reach, [...(groups.get(reach) ?? []), item])
  for (const event of caps.events) {
    push(reachOfEvent(event), { name: event, kind: 'event', line: explainEvent(event) })
  }
  for (const call of caps.calls) {
    push(reachOfCall(call), { name: call, kind: 'call', line: explainCall(call) })
  }
  return REACH_ORDER.filter(reach => groups.has(reach)).map(reach => ({
    reach,
    label: REACH_LABEL[reach],
    items: groups.get(reach) ?? [],
  }))
}

export type CapabilityDiff = {
  readonly addedNotable: string[]
  readonly removedNotable: string[]
  readonly addedCalls: string[]
  readonly addedEvents: string[]
}

const minus = (a: readonly string[], b: readonly string[]): string[] =>
  a.filter(item => !b.includes(item))

export const diffCapabilities = (
  before: Pick<Capabilities, 'notable' | 'calls' | 'events'>,
  after: Pick<Capabilities, 'notable' | 'calls' | 'events'>,
): CapabilityDiff => ({
  addedNotable: minus(after.notable, before.notable),
  removedNotable: minus(before.notable, after.notable),
  addedCalls: minus(after.calls, before.calls),
  addedEvents: minus(after.events, before.events),
})

export const isEmptyDiff = (diff: CapabilityDiff): boolean =>
  diff.addedNotable.length === 0 &&
  diff.removedNotable.length === 0 &&
  diff.addedCalls.length === 0 &&
  diff.addedEvents.length === 0
