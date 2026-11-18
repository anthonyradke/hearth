import { RefreshControl, ScrollView, View } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { MetricChart } from '@/components/MetricChart'
import { Group, Row } from '@/components/Row'
import { StaleBanner, StateView } from '@/components/StateView'
import { Txt } from '@/components/Txt'
import type { Smart, System } from '@/lib/api'
import { usePull, useSystem } from '@/lib/data'
import { ago, bits, bytes, count, pct, span, temp, when } from '@/lib/format'
import { hostKey } from '@/lib/status'
import { radius, space, useTheme } from '@/theme'

type Key = 'cpu' | 'ram' | 'disk' | 'temp' | 'net' | 'battery' | 'gpu'

const TITLES: Record<Key, string> = {
  cpu: 'CPU', ram: 'Memory', disk: 'Disk', temp: 'Temperature', net: 'Network', battery: 'Power', gpu: 'GPU',
}

const fmtPct = (v: number) => pct(v, v < 10 ? 1 : 0)

export default function Metric() {
  // host: another machine the server watches (?host=h5); its history keys are "h5/cpu" and so on.
  const { key, host } = useLocalSearchParams<{ key: Key; host?: string }>()
  const q = useSystem(host)
  const pull = usePull(q)
  const { c } = useTheme()
  return (
    <>
      <Stack.Screen options={{ title: `${TITLES[key] ?? ''}${host ? ` · ${host}` : ''}` }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: c.bg }}
        contentContainerStyle={{ padding: space.l, paddingBottom: 120, gap: space.section - 4 }}
        refreshControl={<RefreshControl {...pull} />}>
        <StaleBanner q={q} />
        {q.data ? <Body k={key} s={q.data} h={(m) => hostKey(m, host)} /> : <StateView q={q} shape="detail" />}
      </ScrollView>
    </>
  )
}

/** h turns a metric into this machine's history key. */
type P = { s: System; h: (metric: string) => string }

function Body({ k, s, h }: P & { k: Key }) {
  switch (k) {
    case 'cpu': return <Cpu s={s} h={h} />
    case 'ram': return <Ram s={s} h={h} />
    case 'disk': return <Disk s={s} h={h} />
    case 'temp': return <Temp s={s} h={h} />
    case 'net': return <Net s={s} h={h} />
    case 'battery': return <Power s={s} h={h} />
    case 'gpu': return <Gpu s={s} h={h} />
    default: return null
  }
}

function Cpu({ s, h }: P) {
  const { c } = useTheme()
  return (
    <>
      <MetricChart metric={h('cpu')} format={fmtPct} now={s.cpu.percent} span={20} big />
      <View style={{ gap: 6 }}>
        <Txt variant="sub" tone="label2" style={{ paddingHorizontal: space.l }}>Each thread, now</Txt>
        <View style={{ backgroundColor: c.panel, borderRadius: radius.panel, borderCurve: 'continuous', padding: space.l, flexDirection: 'row', gap: 6, height: 120, alignItems: 'flex-end' }}
          accessibilityLabel={`Per thread: ${s.cpu.per_core.map((v) => pct(v)).join(', ')}`}>
          {s.cpu.per_core.map((v, i) => (
            <View key={i} style={{ flex: 1, height: '100%', justifyContent: 'flex-end', backgroundColor: c.fill, borderRadius: 4, overflow: 'hidden' }}>
              <View style={{ height: `${Math.max(2, Math.min(100, v))}%`, backgroundColor: c.label2 }} />
            </View>
          ))}
        </View>
      </View>
      <Group header="Load average" footer={`${s.cores} threads. A load under ${s.cores} means nothing is waiting for the CPU.`}>
        <Row label="1 minute" value={s.cpu.load[0].toFixed(2)} />
        <Row label="5 minutes" value={s.cpu.load[1].toFixed(2)} />
        <Row label="15 minutes" value={s.cpu.load[2].toFixed(2)} />
      </Group>
      <MetricChart title="Load, 1 minute" metric={h('load1')} format={(v) => v.toFixed(2)} now={s.cpu.load[0]} />
    </>
  )
}

function Ram({ s, h }: P) {
  const m = s.memory
  return (
    <>
      <MetricChart metric={h('ram')} format={fmtPct} now={m.percent} span={20} big />
      <Group footer="Available counts memory the system can free at once, like file caches.">
        <Row label="Used" value={bytes(m.used)} />
        <Row label="Available" value={bytes(m.available)} />
        <Row label="Total" value={bytes(m.total)} />
      </Group>
      <Group header="Swap" footer="Swap is disk used as overflow memory. A full swap with free memory is normal after a busy spell: Linux leaves idle pages there.">
        <Row label="Used" value={`${bytes(m.swap_used)} of ${bytes(m.swap_total)}`} />
      </Group>
      <MetricChart title="Swap" metric={h('swap')} format={fmtPct} now={m.swap_percent} span={20} />
    </>
  )
}

function Disk({ s, h }: P) {
  const root = s.disks.find((d) => d.mount === '/') ?? s.disks[0]
  return (
    <>
      <MetricChart metric={h('disk')} format={(v) => pct(v, 1)} now={root?.percent} zero={false} span={5} big initial="7d" />
      {s.disks.map((d) => (
        <View key={d.mount} style={{ gap: space.l }}>
          {d.mount !== '/' && <MetricChart title={d.mount} metric={h(`disk:${d.mount}`)} format={(v) => pct(v, 1)} now={d.percent} zero={false} span={5} initial="7d" />}
          <Group header={d.mount === '/' ? 'System disk' : d.mount}>
            <Row label="Used" value={bytes(d.used)} />
            <Row label="Free" value={bytes(d.free)} />
            <Row label="Size" value={bytes(d.size, 0)} />
          </Group>
        </View>
      ))}
      {(s.smart ?? []).map((d) => <SmartGroup key={d.device} d={d} />)}
    </>
  )
}

function Temp({ s, h }: P) {
  const t = s.temps
  return (
    <>
      <MetricChart metric={h('temp')} format={(v) => temp(v)} now={t.cpu} zero={false} span={15} big />
      <Group header="Sensors" footer="The CPU slows itself down at 100 °C.">
        <Row label="CPU package" value={temp(t.cpu)} />
        {t.cores_max != null && <Row label="Hottest core" value={temp(t.cores_max)} />}
        {t.others.map((o, i) => <Row key={`${o.name}${i}`} label={o.name} value={temp(o.c)} />)}
        {(s.gpus ?? []).map((g) => <Row key={g.name} label={g.name} value={temp(g.temp)} />)}
        {(s.smart ?? []).filter((d) => d.temp != null).map((d) => <Row key={d.device} label={d.model ?? d.device} value={temp(d.temp)} />)}
      </Group>
      {t.fans.some((f) => f.rpm > 0) && (
        <Group header="Fans" footer="Headers with nothing plugged in are left out.">
          {t.fans.filter((f) => f.rpm > 0).map((f) => <Row key={f.name} label={f.name} value={`${count(f.rpm)} rpm`} />)}
        </Group>
      )}
    </>
  )
}

function Net({ s, h }: P) {
  const n = s.network
  const tr = s.traffic
  return (
    <>
      <MetricChart metric={h('net_rx')} format={(v) => bits(v)} now={n.rx_rate} second={h('net_tx')} big />
      <Txt variant="foot" tone="label2" style={{ paddingHorizontal: space.l, marginTop: -space.l }}>
        Dark line: download. Grey line: upload.
      </Txt>
      <Group header="Now">
        <Row label="Download" value={bits(n.rx_rate)} />
        <Row label="Upload" value={bits(n.tx_rate)} />
      </Group>
      {tr && (
        <Group header="Traffic">
          {tr.today && <Row label="Today" value={`${bytes(tr.today.rx)} down`} sub={`${bytes(tr.today.tx)} up`} />}
          {tr.month && <Row label="This month" value={`${bytes(tr.month.rx)} down`} sub={`${bytes(tr.month.tx)} up`} />}
        </Group>
      )}
      <Group header="Interface">
        <Row label="Name" value={n.iface ?? '–'} />
        {n.rx_total != null && <Row label="Downloaded since boot" value={bytes(n.rx_total)} />}
        {n.tx_total != null && <Row label="Uploaded since boot" value={bytes(n.tx_total)} />}
      </Group>
    </>
  )
}

function Power({ s, h }: P) {
  const b = s.battery
  if (!b) {
    return (
      <Group header="Uptime" footer="This machine has no battery, so a power cut turns it off.">
        <Row label="Up for" value={span(s.uptime)} />
        <Row label="Last boot" value={when(s.boot)} />
      </Group>
    )
  }
  return (
    <>
      <MetricChart metric={h('battery')} format={(v) => pct(v)} now={b.percent} zero={false} span={20} big initial="7d" />
      <Group footer="The battery is the server’s UPS: if the power goes out, it keeps running and Hearth tells you.">
        <Row label="Power" value={b.ac === false ? 'On battery' : 'Plugged in'} />
        <Row label="Battery" value={b.status === 'Not charging' ? 'Holding (charge limit)' : b.status ?? '–'} />
        {b.health != null && <Row label="Capacity left" value={pct(b.health)} sub="Compared to when it was new" />}
        {b.ac === false && b.watts ? <Row label="Drawing" value={`${b.watts} W`} /> : null}
      </Group>
      <Group header="Uptime">
        <Row label="Up for" value={span(s.uptime)} />
        <Row label="Last boot" value={when(s.boot)} />
      </Group>
    </>
  )
}

function Gpu({ s, h }: P) {
  const g = s.gpus?.[0]
  if (!g) return <Txt variant="callout" tone="label2">This machine has no GPU Hearth can read.</Txt>
  return (
    <>
      <MetricChart metric={h('gpu')} format={fmtPct} now={g.util} span={20} big />
      <Group header={g.name}>
        <Row label="Busy" value={pct(g.util)} />
        <Row label="Temperature" value={temp(g.temp)} />
        {g.mem_used != null && g.mem_total != null && <Row label="Memory" value={`${bytes(g.mem_used)} of ${bytes(g.mem_total, 0)}`} />}
        {g.watts != null && <Row label="Power" value={`${Math.round(g.watts)} W`} sub={g.watts_limit ? `Limit ${Math.round(g.watts_limit)} W` : undefined} />}
        {g.fan != null && <Row label="Fan" value={pct(g.fan)} />}
      </Group>
      <MetricChart title="Temperature" metric={h('gpu_temp')} format={(v) => temp(v)} now={g.temp} zero={false} span={15} />
      <MetricChart title="Memory in use" metric={h('gpu_mem')} format={fmtPct} now={g.mem_used != null && g.mem_total ? (100 * g.mem_used) / g.mem_total : null} span={20} />
    </>
  )
}

/** One disk's SMART health, as hearth-smart.timer last read it. */
function SmartGroup({ d }: { d: Smart }) {
  const title = d.model ?? d.device
  if (d.error) return <Group header={title}><Row label="Health" value="Not read yet" sub={d.error} /></Group>
  const bad = d.kind === 'ata' ? (d.reallocated ?? 0) + (d.pending ?? 0) + (d.uncorrectable ?? 0) : 0
  return (
    <Group header={title} footer={d.checked ? `Checked ${ago(d.checked)}` : undefined}>
      <Row label="Health check" value={d.passed === false ? 'Failed' : d.passed ? 'Passed' : '–'} />
      {d.kind === 'nvme' && d.percent_used != null && <Row label="Wear" value={pct(d.percent_used)} sub="Of its rated write endurance" />}
      {d.kind === 'nvme' && d.available_spare != null && <Row label="Spare blocks left" value={pct(d.available_spare)} />}
      {d.kind === 'nvme' && !!d.media_errors && <Row label="Media errors" value={count(d.media_errors)} />}
      {d.kind === 'ata' && <Row label="Bad sectors" value={bad ? count(bad) : 'None'}
        sub={bad ? `${d.reallocated ?? 0} reallocated, ${d.pending ?? 0} pending, ${d.uncorrectable ?? 0} uncorrectable` : undefined} />}
      {d.power_on_hours != null && <Row label="Powered on" value={`${count(d.power_on_hours)} h`} sub={`About ${(d.power_on_hours / 8766).toFixed(1)} years`} />}
      {d.temp != null && <Row label="Temperature" value={temp(d.temp)} />}
      <Row label="Device" value={d.device} />
    </Group>
  )
}
