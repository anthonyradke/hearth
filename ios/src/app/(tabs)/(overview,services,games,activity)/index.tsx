import { RefreshControl, ScrollView, View } from 'react-native'
import { router, Stack } from 'expo-router'
import { Dot } from '@/components/Dot'
import { Icon } from '@/components/Icon'
import { Group, Row } from '@/components/Row'
import { StaleBanner, StateView } from '@/components/StateView'
import { Tile } from '@/components/Tile'
import { Txt } from '@/components/Txt'
import type { HostSummary, Issue, Overview } from '@/lib/api'
import { useOverview, usePull } from '@/lib/data'
import { ago, bits, bytes, count, pct, span, temp, when } from '@/lib/format'
import { gameLabel, healthColor, issueFor, levelColor, metricHref, remoteOf } from '@/lib/status'
import { space, useTheme } from '@/theme'

export default function OverviewScreen() {
  const q = useOverview()
  const pull = usePull(q)
  const { c } = useTheme()
  return (
    <>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="gearshape" accessibilityLabel="Settings" onPress={() => router.push('/settings')} />
      </Stack.Toolbar>
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: c.bg }}
        contentContainerStyle={{ padding: space.l, paddingBottom: 120 }}
        refreshControl={<RefreshControl {...pull} />}>
        <StaleBanner q={q} />
        {q.data ? <Body o={q.data} /> : <StateView q={q} />}
      </ScrollView>
    </>
  )
}

/** Where an issue's row goes when tapped. A remote host's machine issues are "<host>:<rule>". */
function issueHref(i: Issue, local?: string): string | undefined {
  if (i.id.startsWith('unit:') || i.id.startsWith('flap:')) return `/service/${encodeURIComponent(i.target ?? '')}`
  const host = remoteOf(i, local)
  const rule = host && i.id.startsWith(`${host}:`) ? i.id.slice(host.length + 1) : i.id
  if (rule === 'unreachable') return undefined
  if (rule.startsWith('disk') || rule.startsWith('smart')) return metricHref('disk', host)
  if (rule === 'ram') return metricHref('ram', host)
  if (rule === 'temp') return metricHref('temp', host)
  if (rule.startsWith('gpu')) return metricHref('gpu', host)
  if (rule === 'power') return metricHref('battery', host)
  if (i.target === 'network') return '/network'
  if (i.target === 'backups') return '/backups'
  return undefined
}

function Body({ o }: { o: Overview }) {
  const { c } = useTheme()
  const issues = o.status.issues
  const color = levelColor(o.status.level, c)
  const alert = (...ids: string[]) => levelColor(issueFor(issues, ...ids)?.severity, c)
  const bat = o.battery
  const svc = o.services
  const running = svc.ok ?? 0
  const off = (svc.stopped ?? 0)
  const broken = (svc.down ?? 0) + (svc.failed ?? 0)
  const local = o.hosts?.[0]
  const remotes = o.hosts?.slice(1) ?? []
  const hostName = (id?: string) => o.hosts?.find((h) => h.id === id)?.name ?? id

  return (
    <View style={{ gap: space.section - 4 }}>
      {/* The one-second answer. */}
      <View style={{ gap: space.m }}>
        <View style={{ paddingHorizontal: space.xs, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
            <Icon sf={issues.length ? 'exclamationmark.triangle.fill' : 'checkmark.circle.fill'}
              md={issues.length ? 'warning' : 'check_circle'} size={28} color={color ?? c.pos} />
            <Txt variant="large" accessibilityRole="header">
              {issues.length === 0 ? 'All good' : issues.length === 1 ? '1 issue' : `${issues.length} issues`}
            </Txt>
          </View>
          <Txt variant="callout" tone="label2" num>
            {o.host.hostname} · up {span(o.host.uptime)} · updated {ago(o.ts)}
          </Txt>
        </View>
        {issues.length > 0 && (
          <Group>
            {issues.map((i) => (
              <Row key={i.id} label={remoteOf(i, local?.id) && !i.id.endsWith(':unreachable') ? `${hostName(i.host)}: ${i.title}` : i.title}
                sub={i.detail || undefined}
                leading={<Dot color={i.severity === 'critical' ? c.neg : c.warn} />} href={issueHref(i, local?.id) as never} />
            ))}
          </Group>
        )}
      </View>

      <View style={{ gap: space.m }}>
        {remotes.length > 0 && (
          <Txt variant="title2" accessibilityRole="header" style={{ paddingHorizontal: space.xs }}>{local?.name ?? o.host.hostname}</Txt>
        )}
        <View style={{ flexDirection: 'row', gap: space.m }}>
          <Tile label="CPU" sf="cpu" md="memory" value={pct(o.cpu?.percent)}
            caption={o.cpu ? `Load ${o.cpu.load[0].toFixed(2)}` : undefined}
            spark={o.spark.cpu} sparkMin={0} sparkSpan={25} href="/metric/cpu" />
          <Tile label="Memory" sf="memorychip" md="memory_alt" value={pct(o.memory?.percent)}
            caption={o.memory ? `${bytes(o.memory.used)} of ${bytes(o.memory.total, 0)}` : undefined}
            spark={o.spark.ram} sparkSpan={20} alert={alert('ram')} href="/metric/ram" />
        </View>
        <View style={{ flexDirection: 'row', gap: space.m }}>
          <Tile label="Disk" sf="internaldrive" md="hard_drive" value={pct(o.disk?.percent)}
            caption={o.disk ? `${bytes(o.disk.free, 0)} free` : undefined}
            spark={o.spark.disk} sparkSpan={10} alert={alert('disk')} href="/metric/disk" />
          <Tile label="Temperature" sf="thermometer.medium" md="thermostat" value={temp(o.temps?.cpu)}
            caption={o.temps?.fans.find((f) => f.rpm > 0) ? `Fan ${count(o.temps.fans.find((f) => f.rpm > 0)!.rpm)} rpm` : 'Fans idle'}
            spark={o.spark.temp} sparkSpan={15} alert={alert('temp')} href="/metric/temp" />
        </View>
        <View style={{ flexDirection: 'row', gap: space.m }}>
          <Tile label="Network" sf="arrow.up.arrow.down" md="swap_vert" value={bits(o.network?.rx_rate)}
            caption={`Up ${bits(o.network?.tx_rate)}`} spark={o.spark.net_rx} sparkMin={0} href="/metric/net" />
          <Tile label="Power" sf={bat?.ac === false ? 'battery.25' : 'powerplug'} md="power"
            value={bat ? pct(bat.percent) : '–'}
            caption={!bat ? 'No battery' : bat.ac === false ? 'On battery' : bat.status === 'Charging' ? 'Charging' : 'Plugged in'}
            spark={o.spark.battery} sparkSpan={20} alert={alert('power')} href="/metric/battery" />
        </View>
      </View>

      {remotes.map((h) => <RemoteHost key={h.id} h={h} />)}

      <View style={{ gap: space.s + 2 }}>
        <Txt variant="title2" accessibilityRole="header" style={{ paddingHorizontal: space.xs }}>Games</Txt>
        <Group>
          {o.games.map((g) => (
            <Row key={g.id} label={g.name} leading={<Dot color={healthColor(g.health, c)} />}
              sub={g.running
                ? `${gameLabel(g)} · up ${span(Date.now() / 1000 - (g.since ?? Date.now() / 1000))}`
                : 'Stopped'}
              value={g.running ? (g.players ? `${g.players} on` : 'Nobody on') : undefined}
              href={`/game/${encodeURIComponent(g.id)}` as never} />
          ))}
        </Group>
      </View>

      <View style={{ gap: space.s + 2 }}>
        <Txt variant="title2" accessibilityRole="header" style={{ paddingHorizontal: space.xs }}>{remotes.length ? 'Everything' : 'Server'}</Txt>
        <Group>
          <Row label="Services" sf="server.rack" md="dns" href="/services"
            value={broken ? `${broken} down` : `${running} running`}
            sub={off ? `${off} stopped on purpose` : undefined} />
          <Row label="Network" sf="network" md="lan" href="/network"
            value={o.dns.dns === false ? 'DNS down' : o.dns.percent_blocked != null ? `${pct(o.dns.percent_blocked)} blocked` : 'DNS OK'} />
          <Row label="Backups" sf="externaldrive.badge.icloud" md="backup" href="/backups"
            value={o.backups.result === 'failed' ? 'Failed' : o.backups.last_success ? ago(o.backups.last_success) : 'Never'}
            sub={o.backups.next ? `Next ${when(o.backups.next)}` : undefined} />
        </Group>
      </View>

      <Txt variant="foot" tone="label3" style={{ textAlign: 'center' }} selectable>
        {o.host.os} · {o.host.cores} threads
      </Txt>
    </View>
  )
}

/** Another machine the server watches: whether it answers, then its own tiles. */
function RemoteHost({ h }: { h: HostSummary }) {
  const { c } = useTheme()
  const issues = h.status.issues
  const alert = (...ids: string[]) => levelColor(issueFor(issues, ...ids.map((i) => `${h.id}:${i}`))?.severity, c)
  const gpu = h.gpus?.[0]
  const data = h.disks?.find((d) => d.mount !== '/')
  const off = h.reachable === false
  const svc = h.services
  const broken = (svc.down ?? 0) + (svc.failed ?? 0)
  return (
    <View style={{ gap: space.m }}>
      <View style={{ paddingHorizontal: space.xs, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <Txt variant="title2" accessibilityRole="header">{h.name}</Txt>
          <Dot color={off ? c.neg : levelColor(h.status.level, c) ?? c.pos} />
        </View>
        <Txt variant="callout" tone={off ? 'neg' : 'label2'} num>
          {off ? `Not answering${h.last_ok ? ` · last seen ${ago(h.last_ok)}` : ''}`
            : h.reachable == null ? 'Connecting…'
            : `up ${span(h.host.uptime ?? 0)} · ${broken ? `${broken} down` : `${svc.ok ?? 0} running`}`}
        </Txt>
      </View>
      {h.cpu && (
        <View style={{ gap: space.m, opacity: off ? 0.5 : 1 }}>
          <View style={{ flexDirection: 'row', gap: space.m }}>
            <Tile label="CPU" sf="cpu" md="memory" value={pct(h.cpu.percent)} caption={`Load ${h.cpu.load[0].toFixed(2)}`}
              spark={h.spark.cpu} sparkMin={0} sparkSpan={25} href={metricHref('cpu', h.id) as never} />
            <Tile label="Memory" sf="memorychip" md="memory_alt" value={pct(h.memory?.percent)}
              caption={h.memory ? `${bytes(h.memory.used)} of ${bytes(h.memory.total, 0)}` : undefined}
              spark={h.spark.ram} sparkSpan={20} alert={alert('ram')} href={metricHref('ram', h.id) as never} />
          </View>
          <View style={{ flexDirection: 'row', gap: space.m }}>
            <Tile label="Disk" sf="internaldrive" md="hard_drive" value={pct(h.disk?.percent)}
              caption={data ? `${data.mount} ${pct(data.percent)}` : h.disk ? `${bytes(h.disk.free, 0)} free` : undefined}
              spark={h.spark.disk} sparkSpan={10} alert={alert('disk', 'smart')} href={metricHref('disk', h.id) as never} />
            {gpu ? (
              <Tile label="GPU" sf="square.stack.3d.up" md="view_in_ar" value={pct(gpu.util)}
                caption={`${temp(gpu.temp)} · CPU ${temp(h.temps?.cpu)}`} spark={h.spark.gpu} sparkMin={0} sparkSpan={25}
                alert={alert('gpu_temp', 'temp')} href={metricHref('gpu', h.id) as never} />
            ) : (
              <Tile label="Temperature" sf="thermometer.medium" md="thermostat" value={temp(h.temps?.cpu)}
                spark={h.spark.temp} sparkSpan={15} alert={alert('temp')} href={metricHref('temp', h.id) as never} />
            )}
          </View>
        </View>
      )}
    </View>
  )
}
