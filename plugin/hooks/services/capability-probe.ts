// What this session lets modmgr do (C5, C8): `$.process` is detected by
// calling `claude --version` and catching (the validator refuses `'process' in
// $`, F32); the network by `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`. The
// result goes to `$.state` `degraded`; `acceptCommand` is set elsewhere, after
// Claude Code refused an acceptance (C4), and kept here.

import type { Degraded } from '../../types/index.d.ts'
import { trafficOff } from '../domain/config.ts'
import { compareVersions, MIN_CLAUDE_VERSION } from '../domain/version.ts'
import type { Ports } from '../ports.ts'
import { type CliPorts, cliVersion } from './cli.ts'

export type ProbePorts = CliPorts & Pick<Ports, 'env' | 'state'>

export type Probe = Pick<Degraded, 'process' | 'network' | 'reason'> & {
  /** The `claude` on PATH, when it answered. */
  readonly cliVersion?: string
}

const envValue = async (read: () => Promise<string | undefined>): Promise<string | undefined> => {
  try {
    return await read()
  } catch {
    return undefined
  }
}

export const probeCapabilities = async (ports: ProbePorts): Promise<Probe> => {
  const network = trafficOff(await envValue(() => ports.env.nonessentialTraffic()))
  const version = await cliVersion(ports)
  if (!version.ok) {
    return {
      process: true,
      network,
      reason: `modmgr can't run the claude CLI here (${version.error.message}); mods can be viewed, not changed`,
    }
  }
  const older = (compareVersions(version.value, MIN_CLAUDE_VERSION) ?? 0) < 0
  return {
    process: false,
    network,
    cliVersion: version.value,
    ...(older
      ? {
          reason: `the claude CLI on PATH is ${version.value}; modmgr needs ${MIN_CLAUDE_VERSION} or newer`,
        }
      : network
        ? { reason: 'network use is off (CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC)' }
        : {}),
  }
}

/** Probes and records the result, keeping `acceptCommand`. */
export const probeAndRecord = async (ports: ProbePorts): Promise<Probe> => {
  const probe = await probeCapabilities(ports)
  await ports.state.update('degraded', degraded => ({
    process: probe.process,
    network: probe.network,
    acceptCommand: degraded.acceptCommand,
    ...(probe.reason === undefined ? {} : { reason: probe.reason }),
  }))
  return probe
}
