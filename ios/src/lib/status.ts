import type { Health, Issue, Level, Service } from './api'
import type { Palette } from '@/theme'

/** What a unit's health reads as on a row. Timers and oneshots get their own words. */
export function healthLabel(s: Pick<Service, 'health' | 'type' | 'sub'> | { health: Health; type?: string; sub?: string }): string {
  if (s.type === 'timer' && s.health === 'ok') return 'Scheduled'
  if (s.type === 'oneshot' && s.health === 'ok') return s.sub === 'exited' ? 'Done' : 'Running'
  if (s.type === 'oneshot' && s.health === 'stopped') return 'Idle'
  return { ok: 'Running', stopped: 'Stopped', down: 'Not running', failed: 'Failed', starting: 'Starting',
    stopping: 'Stopping', unknown: 'Unknown' }[s.health]
}

/** The dot: green running, grey off on purpose, amber in between, red when it should be up and isn't. */
export function healthColor(h: Health, c: Palette): string {
  if (h === 'ok') return c.pos
  if (h === 'down' || h === 'failed') return c.neg
  if (h === 'starting' || h === 'stopping') return c.warn
  return c.label3
}

export const levelColor = (l: Level | 'warning' | 'critical' | undefined, c: Palette) =>
  l === 'critical' ? c.neg : l === 'warning' ? c.warn : undefined

/** The worst open issue about a metric/target, if any (issue ids look like "disk:/", "ram", "temp", "unit:x"). */
export function issueFor(issues: Issue[] | undefined, ...ids: string[]): Issue | undefined {
  return issues?.find((i) => ids.some((id) => i.id === id || i.id.startsWith(`${id}:`)))
}

/** "Minecraft 26.3", "Minecraft 26.2 · Fabric 0.19.3", "Valheim 1.0.12" (Valheim prefixes its build type: "l-"). */
export function gameLabel(g: { kind: string; version: string | null; loader?: string | null }): string {
  const name = g.kind === 'minecraft' ? 'Minecraft' : 'Valheim'
  const v = g.version?.replace(/^[a-z]-/, '')
  return `${name}${v ? ` ${v}` : ''}${g.loader ? ` · ${g.loader}` : ''}`
}
