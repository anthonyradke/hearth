// Numbers like a product: 1.2 GB, 16 KB/s, 53 °C, up 63 days, 4 min ago.

export function bytes(n: number | null | undefined, digits = 1): string {
  if (n == null || !isFinite(n)) return '–'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = Math.abs(n)
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i++ }
  const d = i === 0 || v >= 100 ? 0 : digits
  return `${trim(v.toFixed(d))} ${units[i]}`
}

export const rate = (n: number | null | undefined) => (n == null ? '–' : `${bytes(n)}/s`)

/** Bits per second, how network speeds are usually quoted. */
export function bits(n: number | null | undefined): string {
  if (n == null) return '–'
  const b = n * 8
  const units = ['bps', 'kbps', 'Mbps', 'Gbps']
  let i = 0
  let v = b
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i++ }
  return `${trim(v.toFixed(i === 0 || v >= 100 ? 0 : 1))} ${units[i]}`
}

const trim = (s: string) => s.replace(/\.0$/, '')

export const pct = (n: number | null | undefined, digits = 0) => (n == null ? '–' : `${trim(n.toFixed(digits))}%`)
export const temp = (n: number | null | undefined) => (n == null ? '–' : `${Math.round(n)} °C`)

export function count(n: number | null | undefined): string {
  if (n == null) return '–'
  if (n >= 1e6) return `${trim((n / 1e6).toFixed(1))}M`
  if (n >= 1e4) return `${Math.round(n / 1e3)}k`
  return n.toLocaleString('en-US')
}

/** 63 days, 5 h, 12 min, 40 s */
export function span(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s} s`
  if (s < 3600) return `${Math.floor(s / 60)} min`
  if (s < 86400) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
    return m && h < 10 ? `${h} h ${m} min` : `${h} h`
  }
  const d = Math.floor(s / 86400)
  return d === 1 ? '1 day' : `${d} days`
}

export const now = () => Date.now() / 1000

export function ago(ts: number | null | undefined, t = now()): string {
  if (!ts) return 'never'
  const d = t - ts
  if (d < 45) return 'just now'
  return `${span(d)} ago`
}

export function until(ts: number | null | undefined, t = now()): string {
  if (!ts) return '–'
  const d = ts - t
  if (d <= 0) return 'now'
  return `in ${span(d)}`
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()

export function clock(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/** "Today, 4:30 AM" / "Yesterday, 9:12 PM" / "Sep 21, 9:12 PM" */
export function when(ts: number | null | undefined): string {
  if (!ts) return '–'
  const d = new Date(ts * 1000)
  const today = new Date()
  const yest = new Date(Date.now() - 86400_000)
  const tomorrow = new Date(Date.now() + 86400_000)
  const day = sameDay(d, today) ? 'Today' : sameDay(d, yest) ? 'Yesterday' : sameDay(d, tomorrow) ? 'Tomorrow'
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${day}, ${clock(ts)}`
}

export function dayLabel(ts: number): string {
  const d = new Date(ts * 1000)
  if (sameDay(d, new Date())) return 'Today'
  if (sameDay(d, new Date(Date.now() - 86400_000))) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}
