import { RefreshControl, ScrollView, View } from 'react-native'
import { router, Stack } from 'expo-router'
import { Dot } from '@/components/Dot'
import { Icon } from '@/components/Icon'
import { Group, Row } from '@/components/Row'
import { StaleBanner, StateView } from '@/components/StateView'
import { Tile } from '@/components/Tile'
import { Txt } from '@/components/Txt'
import type { Issue, Overview } from '@/lib/api'
import { useOverview, usePull } from '@/lib/data'
import { ago, bits, bytes, count, pct, span, temp, when } from '@/lib/format'
import { gameLabel, healthColor, issueFor, levelColor } from '@/lib/status'
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

/** Where an issue's row goes when tapped. */
function issueHref(i: Issue): string | undefined {
  if (i.id.startsWith('unit:') || i.id.startsWith('flap:')) return `/service/${encodeURIComponent(i.target ?? '')}`
  if (i.id.startsWith('disk')) return '/metric/disk'
  if (i.id === 'ram') return '/metric/ram'
  if (i.id === 'temp') return '/metric/temp'
  if (i.id === 'power') return '/metric/battery'
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
              <Row key={i.id} label={i.title} sub={i.detail || undefined}
                leading={<Dot color={i.severity === 'critical' ? c.neg : c.warn} />} href={issueHref(i) as never} />
            ))}
          </Group>
        )}
      </View>

      <View style={{ gap: space.m }}>
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

      <View style={{ gap: space.s + 2 }}>
        <Txt variant="title2" accessibilityRole="header" style={{ paddingHorizontal: space.xs }}>Games</Txt>
        <Group>
          {o.games.map((g) => (
            <Row key={g.id} label={g.name} leading={<Dot color={healthColor(g.health, c)} />}
              sub={g.running
                ? `${gameLabel(g)} · up ${span(Date.now() / 1000 - (g.since ?? Date.now() / 1000))}`
                : 'Stopped'}
              value={g.running ? (g.players ? `${g.players} on` : 'Nobody on') : undefined}
              href={`/game/${g.id}` as never} />
          ))}
        </Group>
      </View>

      <View style={{ gap: space.s + 2 }}>
        <Txt variant="title2" accessibilityRole="header" style={{ paddingHorizontal: space.xs }}>Server</Txt>
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
