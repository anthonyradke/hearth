// Typed client for the Hearth backend (FastAPI on the server, reached over Tailscale). Every timestamp is epoch
// seconds; sizes are bytes; rates are bytes per second; CPU for a unit is percent of one core.
import { useServer } from './server'

export type Health = 'ok' | 'stopped' | 'down' | 'failed' | 'starting' | 'stopping' | 'unknown'
export type Level = 'ok' | 'warning' | 'critical'
export interface Issue { id: string; severity: 'critical' | 'warning'; title: string; detail: string; target: string | null }
export interface Disk { mount: string; size: number; used: number; free: number; percent: number }
export interface Cpu { percent: number | null; per_core: number[]; load: number[] }
export interface Memory { total: number; available: number; used: number; percent: number | null; swap_total: number; swap_used: number; swap_percent: number }
export interface Temps { cpu: number | null; cores_max: number | null; others: { name: string; c: number }[]; fans: { name: string; rpm: number }[] }
export interface Battery { percent: number | null; status: string | null; ac: boolean | null; watts: number | null; health: number | null }
export interface NetRates { iface: string | null; rx_rate: number | null; tx_rate: number | null; rx_total?: number; tx_total?: number }
export interface Host { hostname: string; os: string; kernel: string; cores: number; uptime: number; boot: number }

export interface Overview {
  host: Host
  status: { level: Level; issues: Issue[] }
  cpu: Cpu | null
  memory: Memory | null
  disk: Disk | null
  temps: Temps | null
  battery: Battery | null
  network: NetRates | null
  spark: Record<'cpu' | 'ram' | 'disk' | 'temp' | 'net_rx' | 'net_tx' | 'battery', number[]>
  services: { total: number } & Partial<Record<Health, number>>
  games: { id: string; name: string; kind: GameKind; running: boolean; health: Health; since: number | null; version: string | null; max_players: number | null; players: number }[]
  backups: { available?: boolean; last_success: number | null; result: string | null; age_hours: number | null; next: number | null }
  dns: { dns?: boolean; percent_blocked?: number | null; queries?: number | null; configured?: boolean }
  errors: Record<string, string>
  ts: number
}

export interface System extends Host {
  ts: number
  cpu: Cpu; memory: Memory; disks: Disk[]; temps: Temps; network: NetRates; battery: Battery | null
  traffic: { today: { rx: number; tx: number } | null; month: { rx: number; tx: number } | null } | null
}

export type Actions = 'none' | 'restart' | 'full'
export interface Service {
  unit: string; name: string; group: string; actions: Actions; health: Health
  description: string; active: string; sub: string; enabled: string; type: string
  memory: number | null; cpu: number | null; since: number | null; restarts: number; result: string
  pid: number | null; next_run: number | null; last_run: number | null
}
export interface Event { id: number; ts: number; kind: string; subject: string; detail: string }
export interface JournalLine { ts: number; priority: number; message: string }
export interface ServiceDetail extends Service { journal: JournalLine[]; events: Event[] }

export type GameKind = 'minecraft' | 'valheim'
export interface Game {
  id: string; kind: GameKind; name: string; unit: string; address: string | null; running: boolean; health: Health
  since: number | null; memory: number | null; cpu: number | null; players: { name: string; id?: string }[]
  max_players: number | null; version: string | null; loader?: string | null; world?: string | null; error: string | null
}
export interface GameDetail extends Game { events: Event[] }

export interface Peer { name: string; os: string | null; online: boolean; ip: string | null; last_seen: number | null; key_expiry: number | null; user: string | null; exit_node: boolean; direct: boolean }
export interface Network {
  tailscale: { state: string; version?: string | null; self: Peer | null; peers: Peer[]; error?: string } | null
  pihole: {
    dns: boolean; dns_ms: number | null; upstream: boolean; upstream_ms: number | null; configured: boolean; error?: string
    queries?: number; blocked?: number; percent_blocked?: number; cached?: number; forwarded?: number
    clients?: number; blocklist?: number; blocking?: string; top_clients?: { name: string; ip: string; count: number }[]
  } | null
  public_ip: { ip?: string; since?: number; checked?: number; reachable: boolean } | null
  traffic: System['traffic']
  interface: NetRates | null
}

export interface Job { started: number | null; finished: number | null; result: string; error: string | null }
export interface Backups {
  available: boolean; error?: string; schema?: number; updated?: number | null; last_success?: number | null
  age_hours?: number | null
  backup?: Job & { tag?: string; snapshot?: string; bytes_added?: number; bytes_uploaded?: number; bytes_total?: number; files_new?: number; files_changed?: number; files_total?: number; missing_sources?: string[] } | null
  check?: Job & { subset?: string } | null
  drill?: Job & { snapshot?: string; files?: { path: string; bytes: number; integrity?: string }[] } | null
  repo?: { snapshots: number; size_bytes: number; measured: number | null } | null
  sources?: { path: string; bytes: number }[]
  timers?: Record<'backup' | 'check' | 'drill', { active: boolean; next: number | null; last: number | null }>
}

export type Range = '1h' | '6h' | '24h' | '7d' | '30d' | '90d'
/** [ts, avg, min, max] */
export type Point = [number, number, number, number]
export interface Alert { id: number; rule: string; severity: 'critical' | 'warning'; title: string; detail: string; started: number; ended: number | null; notified: number }
export interface AlertsInfo { alerts: Alert[]; ntfy: { url: string; topic: string } | null; heartbeat: { ok: boolean; ts: number } | null; quiet_hours: string | null }
export interface Audit { id: number; ts: number; who: string; action: string; target: string; result: string; detail: string }

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

/** No answer at all (Tailscale off, timed out, server restarting), as opposed to Hearth refusing the request. */
export const unreachable = (e: unknown) =>
  e instanceof ApiError ? e.status >= 502 : e instanceof TypeError || (e instanceof Error && e.name === 'AbortError')

export async function call<T>(method: string, path: string, body?: unknown, timeoutMs = 15_000,
  creds?: { url: string; token: string }): Promise<T> {
  const { url, token } = creds ?? useServer.getState()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const res = await fetch(`${url}/api${path}`, {
      method, signal: ctrl.signal, headers, body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const detail = typeof data?.detail === 'string' ? data.detail : `Request failed (${res.status})`
      throw new ApiError(res.status, detail)
    }
    return data as T
  } finally {
    clearTimeout(timer)
  }
}

export const api = {
  overview: () => call<Overview>('GET', '/overview'),
  system: () => call<System>('GET', '/system'),
  services: () => call<{ groups: string[]; services: Service[] }>('GET', '/services'),
  service: (unit: string) => call<ServiceDetail>('GET', `/services/${encodeURIComponent(unit)}?lines=120`),
  games: () => call<{ games: Game[] }>('GET', '/games'),
  game: (id: string) => call<GameDetail>('GET', `/games/${encodeURIComponent(id)}`),
  network: () => call<Network>('GET', '/network'),
  backups: () => call<Backups>('GET', '/backups'),
  history: (key: string, range: Range) =>
    call<{ key: string; range: Range; points: Point[] }>('GET', `/history?key=${encodeURIComponent(key)}&range=${range}`),
  events: (before?: number) => call<{ events: Event[] }>('GET', `/events?limit=100${before ? `&before=${before}` : ''}`),
  audit: () => call<{ audit: Audit[] }>('GET', '/audit'),
  alerts: () => call<AlertsInfo>('GET', '/alerts'),
  testAlert: () => call<{ ok: true }>('POST', '/alerts/test'),
}
