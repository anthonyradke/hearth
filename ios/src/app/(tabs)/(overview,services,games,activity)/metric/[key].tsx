import { RefreshControl, ScrollView, View } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { MetricChart } from '@/components/MetricChart'
import { Group, Row } from '@/components/Row'
import { StaleBanner, StateView } from '@/components/StateView'
import { Txt } from '@/components/Txt'
import type { System } from '@/lib/api'
import { usePull, useSystem } from '@/lib/data'
import { bits, bytes, count, pct, span, temp, when } from '@/lib/format'
import { radius, space, useTheme } from '@/theme'

type Key = 'cpu' | 'ram' | 'disk' | 'temp' | 'net' | 'battery'

const TITLES: Record<Key, string> = {
  cpu: 'CPU', ram: 'Memory', disk: 'Disk', temp: 'Temperature', net: 'Network', battery: 'Power',
}

const fmtPct = (v: number) => pct(v, v < 10 ? 1 : 0)

export default function Metric() {
  const { key } = useLocalSearchParams<{ key: Key }>()
  const q = useSystem()
  const pull = usePull(q)
  const { c } = useTheme()
  return (
    <>
      <Stack.Screen options={{ title: TITLES[key] ?? '' }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: c.bg }}
        contentContainerStyle={{ padding: space.l, paddingBottom: 120, gap: space.section - 4 }}
        refreshControl={<RefreshControl {...pull} />}>
        <StaleBanner q={q} />
        {q.data ? <Body k={key} s={q.data} /> : <StateView q={q} shape="detail" />}
      </ScrollView>
    </>
  )
}

function Body({ k, s }: { k: Key; s: System }) {
  switch (k) {
    case 'cpu': return <Cpu s={s} />
    case 'ram': return <Ram s={s} />
    case 'disk': return <Disk s={s} />
    case 'temp': return <Temp s={s} />
    case 'net': return <Net s={s} />
    case 'battery': return <Power s={s} />
    default: return null
  }
}

function Cpu({ s }: { s: System }) {
  const { c } = useTheme()
  return (
    <>
      <MetricChart metric="cpu" format={fmtPct} now={s.cpu.percent} span={20} big />
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
      <MetricChart title="Load, 1 minute" metric="load1" format={(v) => v.toFixed(2)} now={s.cpu.load[0]} />
    </>
  )
}

function Ram({ s }: { s: System }) {
  const m = s.memory
  return (
    <>
      <MetricChart metric="ram" format={fmtPct} now={m.percent} span={20} big />
      <Group footer="Available counts memory the system can free at once, like file caches.">
        <Row label="Used" value={bytes(m.used)} />
        <Row label="Available" value={bytes(m.available)} />
        <Row label="Total" value={bytes(m.total)} />
      </Group>
      <Group header="Swap" footer="Swap is disk used as overflow memory. A full swap with free memory is normal after a busy spell: Linux leaves idle pages there.">
        <Row label="Used" value={`${bytes(m.swap_used)} of ${bytes(m.swap_total)}`} />
      </Group>
      <MetricChart title="Swap" metric="swap" format={fmtPct} now={m.swap_percent} span={20} />
    </>
  )
}

function Disk({ s }: { s: System }) {
  const root = s.disks.find((d) => d.mount === '/') ?? s.disks[0]
  return (
    <>
      <MetricChart metric="disk" format={(v) => pct(v, 1)} now={root?.percent} zero={false} span={5} big initial="7d" />
      {s.disks.map((d) => (
        <Group key={d.mount} header={d.mount === '/' ? 'System disk' : d.mount}>
          <Row label="Used" value={bytes(d.used)} />
          <Row label="Free" value={bytes(d.free)} />
          <Row label="Size" value={bytes(d.size, 0)} />
        </Group>
      ))}
    </>
  )
}

function Temp({ s }: { s: System }) {
  const t = s.temps
  return (
    <>
      <MetricChart metric="temp" format={(v) => temp(v)} now={t.cpu} zero={false} span={15} big />
      <Group header="Sensors" footer="The CPU slows itself down at 100 °C.">
        <Row label="CPU package" value={temp(t.cpu)} />
        {t.cores_max != null && <Row label="Hottest core" value={temp(t.cores_max)} />}
        {t.others.map((o) => <Row key={o.name} label={o.name} value={temp(o.c)} />)}
      </Group>
      {t.fans.length > 0 && (
        <Group header="Fans">
          {t.fans.map((f) => <Row key={f.name} label={f.name} value={f.rpm ? `${count(f.rpm)} rpm` : 'Off'} />)}
        </Group>
      )}
    </>
  )
}

function Net({ s }: { s: System }) {
  const n = s.network
  const tr = s.traffic
  return (
    <>
      <MetricChart metric="net_rx" format={(v) => bits(v)} now={n.rx_rate} second="net_tx" big />
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

function Power({ s }: { s: System }) {
  const b = s.battery
  if (!b) return <Txt variant="callout" tone="label2">This machine has no battery.</Txt>
  return (
    <>
      <MetricChart metric="battery" format={(v) => pct(v)} now={b.percent} zero={false} span={20} big initial="7d" />
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
