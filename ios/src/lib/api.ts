// Typed client for the Hearth backend (FastAPI on the server, reached over Tailscale). Every timestamp is epoch
// seconds; sizes are bytes; rates are bytes per second; CPU for a unit is percent of one core.
// The server can also watch other machines through their Hearth agent ("hosts"). Their units are addressed as
// "<host>/<unit>", and their history keys as "<host>/cpu" (machine) or "mem:<host>/<unit>" (unit).
import { useServer } from './server'

export type Health = 'ok' | 'stopped' | 'down' | 'failed' | 'starting' | 'stopping' | 'unknown'
export type Level = 'ok' | 'warning' | 'critical'
export interface Issue { id: string; severity: 'critical' | 'warning'; title: string; detail: string; target: string | null; host?: string }
export interface Disk { mount: string; size: number; used: number; free: number; percent: number }
export interface Cpu { percent: number | null; per_core: number[]; load: number[] }
export interface Memory { total: number; available: number; used: number; percent: number | null; swap_total: number; swap_used: number; swap_percent: number }
export interface Temps { cpu: number | null; cores_max: number | null; others: { name: string; c: number }[]; fans: { name: string; rpm: number }[] }
export interface Battery { percent: number | null; status: string | null; ac: boolean | null; watts: number | null; health: number | null }
export interface NetRates { iface: string | null; rx_rate: number | null; tx_rate: number | null; rx_total?: number; tx_total?: number }
export interface Host { hostname: string; os: string; kernel: string; cores: number; uptime: number; boot: number }
export interface Gpu { name: string; temp: number | null; util: number | null; mem_used: number | null; mem_total: number | null; watts: number | null; watts_limit: number | null; fan: number | null }
export interface Smart {
  device: string; error?: string; kind?: 'nvme' | 'ata'; model?: string | null; passed?: boolean | null; temp?: number | null
  power_on_hours?: number | null; size?: number | null; checked?: number
  percent_used?: number | null; available_spare?: number | null; media_errors?: number | null; critical_warning?: number | null; unsafe_shutdowns?: number | null
  reallocated?: number | null; pending?: number | null; uncorrectable?: number | null
}
/** One machine at a glance (GET /hosts, and Overview.hosts). The first is the server itself. */
export interface HostSummary {
  id: string; name: string; local: boolean; reachable: boolean | null; last_ok: number | null; error: string | null
  status: { level: Level; issues: Issue[] }
  host: Partial<Host>; cpu: Cpu | null; memory: Memory | null; disk: Disk | null; disks: Disk[] | null; temps: Temps | null
  battery: Battery | null; network: NetRates | null; gpus: Gpu[] | null; smart: Smart[] | null
  spark: Record<'cpu' | 'ram' | 'disk' | 'temp' | 'net_rx' | 'net_tx' | 'battery' | 'gpu', number[]>
  services: { total: number } & Partial<Record<Health, number>>
  ts: number | null
}

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
  games: { id: string; name: string; kind: GameKind; running: boolean; health: Health; since: number | null; version: string | null; max_players: number | null; players: number; host?: string }[]
  backups: BackupSummary & {
    /** Every machine that runs cellar, this server first. Absent from servers older than per-host backups. */
    hosts?: (BackupSummary & { id: string })[]
  }
  dns: { dns?: boolean; percent_blocked?: number | null; queries?: number | null; configured?: boolean }
  /** Absent from servers older than remote-host support. */
  hosts?: HostSummary[]
  errors: Record<string, string>
  ts: number
}

export interface System extends Host {
  ts: number
  cpu: Cpu; memory: Memory; disks: Disk[]; temps: Temps; network: NetRates; battery: Battery | null
  gpus?: Gpu[] | null; smart?: Smart[] | null
  traffic: { today: { rx: number; tx: number } | null; month: { rx: number; tx: number } | null } | null
}

export type Actions = 'none' | 'restart' | 'full'
export interface Service {
  /** The id used in URLs: the unit for this machine's, "<host>/<unit>" for another machine's. */
  unit: string; name: string; group: string; actions: Actions; health: Health
  /** Which machine, the plain unit name, and the group without the host prefix. */
  host?: string; systemd_unit?: string; section?: string
  description: string; active: string; sub: string; enabled: string; type: string
  memory: number | null; cpu: number | null; since: number | null; restarts: number; result: string
  pid: number | null; next_run: number | null; last_run: number | null
}
export interface Event { id: number; ts: number; kind: string; subject: string; detail: string }
export interface JournalLine { ts: number; priority: number; message: string }
export interface ServiceDetail extends Service { journal: JournalLine[]; journal_error?: string; events: Event[] }

export type GameKind = 'minecraft' | 'valheim'
export interface Game {
  id: string; kind: GameKind; name: string; unit: string; address: string | null; running: boolean; health: Health
  since: number | null; memory: number | null; cpu: number | null; players: { name: string; id?: string }[]
  max_players: number | null; version: string | null; loader?: string | null; world?: string | null; error: string | null
  host?: string
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

export interface BackupSummary { available?: boolean; last_success: number | null; result: string | null; age_hours: number | null; next: number | null; local?: { last_success: number | null; result: string | null } | null }
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
  /** The second copy, on the other machine's disk. */
  local?: {
    updated: number | null; last_success: number | null; age_hours: number | null
    backup: (Job & { bytes_added?: number }) | null; frequent: Job | null; check: Job | null; drill: Job | null
    repo: { snapshots: number; size_bytes: number; measured: number | null } | null
  } | null
  /** The off-site repository and the local copy compared after each nightly. */
  drift?: {
    measured: number | null; result: 'ok' | 'drift' | string; problems?: string[]; gap_hours?: number | null
    off_site?: { snapshots: number; newest: number | null }; local?: { snapshots: number; newest: number | null }
    compared_since?: string
  } | null
  /** Which machine the top-level fields describe (the server's own). */
  host?: string
  /** Every machine that runs cellar, this server first. Absent from servers older than per-host backups. */
  hosts?: { id: string; name: string; local: boolean; reachable?: boolean | null; backups: Backups }[]
}

export type Range = '1h' | '6h' | '24h' | '7d' | '30d' | '90d'
/** [ts, avg, min, max] */
export type Point = [number, number, number, number]
export interface Alert { id: number; rule: string; severity: 'critical' | 'warning'; title: string; detail: string; started: number; ended: number | null; notified: number }
export interface AlertsInfo { alerts: Alert[]; ntfy: { url: string; topic: string } | null; heartbeat: { ok: boolean; ts: number } | null; quiet_hours: string | null }
export type Verb = 'start' | 'stop' | 'restart'
export type ListName = 'admin' | 'permitted' | 'banned'
export interface ListPlayer { id: string; name: string | null }
export interface ListsInfo { lists: Record<ListName, ListPlayer[]>; known: ListPlayer[]; note: string }
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
  system: (host?: string) => call<System>('GET', host ? `/system?host=${encodeURIComponent(host)}` : '/system'),
  hosts: () => call<{ hosts: HostSummary[] }>('GET', '/hosts'),
  services: () => call<{ groups: string[]; services: Service[]; hosts?: { id: string; name: string; local: boolean; reachable?: boolean | null }[] }>('GET', '/services'),
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
  unitAction: (unit: string, verb: Verb) =>
    call<{ ok: true; service: Service | null }>('POST', `/services/${encodeURIComponent(unit)}/${verb}`, undefined, 170_000),
  rcon: (id: string, command: string) => call<{ command: string; output: string }>('POST', `/games/${encodeURIComponent(id)}/rcon`, { command }),
  lists: (id: string) => call<ListsInfo>('GET', `/games/${encodeURIComponent(id)}/lists`),
  listAdd: (id: string, list: ListName, steamId: string) => call<ListsInfo>('POST', `/games/${encodeURIComponent(id)}/lists/${list}`, { id: steamId }),
  listRemove: (id: string, list: ListName, steamId: string) => call<ListsInfo>('DELETE', `/games/${encodeURIComponent(id)}/lists/${list}/${steamId}`),
  testAlert: () => call<{ ok: true }>('POST', '/alerts/test'),
}
