import { useState } from 'react'
import { RefreshControl, ScrollView, View } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { Controls } from '@/components/Controls'
import { Dot } from '@/components/Dot'
import { Icon } from '@/components/Icon'
import { MetricChart } from '@/components/MetricChart'
import { Group, Row } from '@/components/Row'
import { StaleBanner, StateView } from '@/components/StateView'
import { Txt } from '@/components/Txt'
import type { GameDetail } from '@/lib/api'
import { useGame, usePull, useServices } from '@/lib/data'
import { bytes, span, when } from '@/lib/format'
import { gameLabel, healthColor } from '@/lib/status'
import { space, useTheme } from '@/theme'

export default function GameScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const q = useGame(id)
  const pull = usePull(q)
  const { c } = useTheme()
  return (
    <>
      <Stack.Screen options={{ title: q.data?.name ?? '' }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: c.bg }}
        contentContainerStyle={{ padding: space.l, paddingBottom: 120 }} refreshControl={<RefreshControl {...pull} />}>
        <StaleBanner q={q} />
        {q.data ? <Body g={q.data} /> : <StateView q={q} shape="detail" />}
      </ScrollView>
    </>
  )
}

function Body({ g }: { g: GameDetail }) {
  const { c } = useTheme()
  const svc = useServices().data?.services.find((s) => s.unit === g.unit)
  const [copied, setCopied] = useState(false)
  const copy = () => {
    if (!g.address) return
    Clipboard.setStringAsync(g.address).catch(() => {})
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <View style={{ gap: space.section - 4 }}>
      <View style={{ gap: 4, paddingHorizontal: space.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <Dot color={healthColor(g.health, c)} size={12} />
          <Txt variant="title">{g.running ? 'Running' : g.health === 'stopped' ? 'Stopped' : 'Down'}</Txt>
        </View>
        <Txt variant="callout" tone="label2">
          {gameLabel(g)}{g.running && g.since ? ` · up ${span(Date.now() / 1000 - g.since)}` : ''}
        </Txt>
      </View>

      {svc && <Controls unit={g.unit} name={g.name} actions={svc.actions} health={g.health} players={g.players.map((p) => p.name)} />}

      {g.kind === 'minecraft' && (
        <Group>
          <Row label="Console" sf="terminal" md="terminal" href={`/console/${g.id}` as never}
            sub={g.running ? 'Run server commands: whitelist, op, time, weather' : 'Start the server to use it'} />
        </Group>
      )}
      {g.kind === 'valheim' && (
        <Group header="Player lists" footer="Valheim reads these lists when it starts, so changes can need a restart to take effect.">
          <Row label="Admins" sf="star" md="star" href={`/lists/${g.id}?list=admin` as never} />
          <Row label="Allowed players" sf="checkmark.shield" md="verified_user" href={`/lists/${g.id}?list=permitted` as never}
            sub="If anyone is listed, only they can join" />
          <Row label="Banned" sf="nosign" md="block" href={`/lists/${g.id}?list=banned` as never} />
        </Group>
      )}

      <Group header={g.running ? `Online now${g.max_players ? ` (max ${g.max_players})` : ''}` : 'Players'}>
        {!g.running ? <Row label="The server is stopped" /> :
          g.players.length === 0 ? <Row label="Nobody’s on" sub={g.error ?? undefined} /> :
          g.players.map((p) => (
            <Row key={p.id ?? p.name} label={p.name} leading={<Icon sf="person.fill" md="person" size={16} color={c.label2} />}
              value={p.id && g.kind === 'valheim' ? <Txt variant="foot" tone="label3" selectable>{p.id}</Txt> : undefined} />
          ))}
      </Group>

      <MetricChart title="Players over time" metric={`players:${g.id}`} format={(v) => (Math.round(v * 10) / 10).toString()}
        now={g.running ? g.players.length : null} span={3} initial="7d" />

      <Group header="Server">
        {g.address && (
          <Row label="Address" onPress={copy} chevron={false}
            value={<Txt variant="body" tone="label2" num selectable>{copied ? 'Copied' : g.address}</Txt>}
            trailing={<Icon sf={copied ? 'checkmark' : 'doc.on.doc'} md={copied ? 'check' : 'content_copy'} size={15} color={c.label2} />} />
        )}
        {g.world && <Row label="World" value={g.world} />}
        {g.running && <Row label="Memory" value={bytes(g.memory)} />}
        <Row label="Service" value={g.unit} href={`/service/${encodeURIComponent(g.unit)}` as never} />
      </Group>

      {g.events.length > 0 && (
        <Group header="Recently">
          {g.events.slice(0, 12).map((e) => (
            <Row key={e.id} label={`${e.detail} ${e.kind === 'join' ? 'joined' : 'left'}`}
              leading={<Icon sf={e.kind === 'join' ? 'arrow.right.circle' : 'arrow.left.circle'} md={e.kind === 'join' ? 'login' : 'logout'} size={16} color={c.label2} />}
              value={when(e.ts)} />
          ))}
        </Group>
      )}
    </View>
  )
}
