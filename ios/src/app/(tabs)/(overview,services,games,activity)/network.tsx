import { useState } from 'react'
import { RefreshControl, ScrollView, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { Dot } from '@/components/Dot'
import { Icon } from '@/components/Icon'
import { MetricChart } from '@/components/MetricChart'
import { Group, Row } from '@/components/Row'
import { StaleBanner, StateView } from '@/components/StateView'
import { Txt } from '@/components/Txt'
import type { Network as Net, Peer } from '@/lib/api'
import { useNetwork, usePull } from '@/lib/data'
import { ago, bytes, count, pct, until, when } from '@/lib/format'
import { space, useTheme } from '@/theme'
import type { SFSymbol } from 'expo-symbols'

const OS_ICON: Record<string, [SFSymbol, string]> = {
  iOS: ['iphone', 'smartphone'], macOS: ['laptopcomputer', 'laptop'], windows: ['desktopcomputer', 'desktop_windows'],
  linux: ['server.rack', 'dns'], android: ['smartphone', 'smartphone'],
}

export default function NetworkScreen() {
  const q = useNetwork()
  const pull = usePull(q)
  const { c } = useTheme()
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: c.bg }}
      contentContainerStyle={{ padding: space.l, paddingBottom: 120 }} refreshControl={<RefreshControl {...pull} />}>
      <StaleBanner q={q} />
      {q.data ? <Body n={q.data} /> : <StateView q={q} shape="list" />}
    </ScrollView>
  )
}

function PeerRow({ p }: { p: Peer }) {
  const { c } = useTheme()
  const [sf, md] = OS_ICON[p.os ?? ''] ?? ['desktopcomputer', 'devices']
  return (
    <Row label={p.name} leading={<Icon sf={sf} md={md} size={18} color={c.label2} />}
      sub={p.online ? (p.direct ? 'Online · direct' : 'Online') : p.last_seen ? `Last seen ${ago(p.last_seen)}` : 'Offline'}
      trailing={<Dot color={p.online ? c.pos : c.label3} />} />
  )
}

function Body({ n }: { n: Net }) {
  const { c } = useTheme()
  const [copied, setCopied] = useState(false)
  const ts = n.tailscale
  const ph = n.pihole
  const ip = n.public_ip
  const copyIp = () => {
    if (!ip?.ip) return
    Clipboard.setStringAsync(ip.ip).catch(() => {})
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  const expiry = ts?.self?.key_expiry
  return (
    <View style={{ gap: space.section - 4 }}>
      {ph && (
        <Group header="Pi-hole"
          footer={!ph.configured ? 'Stats need a Pi-hole app password in /etc/hearth/config.toml (Pi-hole → Settings → Web interface / API → Configure app password).' : ph.error ? `Stats unavailable: ${ph.error}` : 'Counts cover the last 24 hours.'}>
          <Row label="DNS" leading={<Dot color={ph.dns ? c.pos : c.neg} />}
            value={ph.dns ? `Answering${ph.dns_ms != null ? ` · ${ph.dns_ms} ms` : ''}` : 'Not answering'} />
          <Row label="Upstream (Cloudflare)" leading={<Dot color={ph.upstream ? c.pos : c.neg} />}
            value={ph.upstream ? `${ph.upstream_ms ?? '–'} ms` : 'Unreachable'} />
          {ph.configured && ph.queries != null && <Row label="Queries" value={count(ph.queries)} />}
          {ph.configured && ph.percent_blocked != null && <Row label="Blocked" value={`${count(ph.blocked)} (${pct(ph.percent_blocked, 1)})`} />}
          {ph.configured && ph.clients != null && <Row label="Active devices" value={String(ph.clients)} />}
          {ph.configured && ph.blocklist != null && <Row label="Blocklist" value={`${count(ph.blocklist)} domains`} />}
          {ph.configured && ph.blocking && <Row label="Blocking" value={ph.blocking === 'enabled' ? 'On' : ph.blocking === 'disabled' ? 'Off' : ph.blocking} />}
        </Group>
      )}
      {ph?.configured && (ph.top_clients?.length ?? 0) > 0 && (
        <Group header="Busiest devices">
          {ph.top_clients!.map((t) => <Row key={t.ip} label={t.name} value={count(t.count)} />)}
        </Group>
      )}
      <MetricChart title="DNS response time (local)" metric="dns_ms" format={(v) => `${v.toFixed(1)} ms`}
        now={ph?.dns_ms} span={2} />

      {ts && (
        <Group header="Tailscale" footer={ts.error}>
          <Row label="This server" leading={<Icon sf="server.rack" md="dns" size={18} color={c.label2} />}
            sub={`${ts.state === 'Running' ? 'Connected' : ts.state}${ts.version ? ` · ${ts.version}` : ''}`}
            value={<Txt variant="body" tone="label2" selectable num>{ts.self?.ip ?? '–'}</Txt>} />
          <Row label="Key expiry" value={expiry ? until(expiry) : 'Never'} sub={expiry ? when(expiry) : 'Key expiry is off for this machine'} />
        </Group>
      )}
      {ts && ts.peers.length > 0 && (
        <Group header="Devices">{ts.peers.map((p) => <PeerRow key={p.name} p={p} />)}</Group>
      )}

      <Group header="Internet" footer="The game servers’ addresses use this IP. The ISP changes it now and then, and Hearth notices.">
        <Row label="Public IP" onPress={copyIp} chevron={false}
          value={<Txt variant="body" tone="label2" selectable num>{copied ? 'Copied' : ip?.ip ?? '–'}</Txt>}
          trailing={ip?.ip ? <Icon sf={copied ? 'checkmark' : 'doc.on.doc'} md={copied ? 'check' : 'content_copy'} size={15} color={c.label2} /> : undefined} />
        {ip?.since && <Row label="Unchanged since" value={when(ip.since)} />}
        {ip && !ip.reachable && <Row label="Couldn’t check just now" sub="The lookup service didn’t answer." />}
      </Group>

      {n.traffic && (
        <Group header="Traffic">
          {n.traffic.today && <Row label="Today" value={`${bytes(n.traffic.today.rx)} down`} sub={`${bytes(n.traffic.today.tx)} up`} />}
          {n.traffic.month && <Row label="This month" value={`${bytes(n.traffic.month.rx)} down`} sub={`${bytes(n.traffic.month.tx)} up`} />}
        </Group>
      )}
    </View>
  )
}
