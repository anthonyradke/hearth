import { RefreshControl, ScrollView, View } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { Controls } from '@/components/Controls'
import { Dot } from '@/components/Dot'
import { Journal } from '@/components/Journal'
import { MetricChart } from '@/components/MetricChart'
import { Group, Row } from '@/components/Row'
import { StaleBanner, StateView } from '@/components/StateView'
import { Txt } from '@/components/Txt'
import type { ServiceDetail } from '@/lib/api'
import { usePull, useService } from '@/lib/data'
import { ago, bytes, pct, span, when } from '@/lib/format'
import { healthColor, healthLabel } from '@/lib/status'
import { mono, space, useTheme } from '@/theme'

const EVENT_WORDS: Record<string, string> = {
  ok: 'Started', restarted: 'Restarted', stopped: 'Stopped', down: 'Stopped unexpectedly', failed: 'Failed',
  starting: 'Starting', stopping: 'Stopping',
}

export default function ServiceScreen() {
  const { unit } = useLocalSearchParams<{ unit: string }>()
  const q = useService(unit)
  const pull = usePull(q)
  const { c } = useTheme()
  return (
    <>
      <Stack.Screen options={{ title: q.data?.name ?? '' }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: c.bg }}
        contentContainerStyle={{ padding: space.l, paddingBottom: 120 }} refreshControl={<RefreshControl {...pull} />}>
        <StaleBanner q={q} />
        {q.data ? <Body s={q.data} /> : <StateView q={q} shape="detail" />}
      </ScrollView>
    </>
  )
}

function Body({ s }: { s: ServiceDetail }) {
  const { c } = useTheme()
  const color = healthColor(s.health, c)
  const timer = s.type === 'timer'
  const running = s.health === 'ok' && !timer && s.type !== 'oneshot'
  return (
    <View style={{ gap: space.section - 4 }}>
      <View style={{ gap: 4, paddingHorizontal: space.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <Dot color={color} size={12} />
          <Txt variant="title" style={s.health === 'down' || s.health === 'failed' ? { color: c.neg } : undefined}>{healthLabel(s)}</Txt>
        </View>
        <Txt variant="callout" tone="label2">
          {timer ? (s.last_run ? `Last ran ${ago(s.last_run)}` : 'Hasn’t run yet')
            : s.since ? `${s.health === 'ok' ? 'Since' : 'Since'} ${when(s.since)} (${span(Date.now() / 1000 - s.since)})` : s.description}
        </Txt>
      </View>

      {!timer && <Controls unit={s.unit} name={s.name} actions={s.actions} health={s.health} />}

      {running && s.memory != null && <MetricChart title="Memory" metric={`mem:${s.unit}`} format={(v) => bytes(v)} now={s.memory} />}

      <Group header="Details">
        <Row label="Unit" value={<Txt variant="body" tone="label2" selectable style={mono}>{s.unit}</Txt>} />
        {running && <Row label="Memory" value={bytes(s.memory)} />}
        {running && <Row label="CPU" value={s.cpu == null ? '–' : pct(s.cpu, s.cpu < 10 ? 1 : 0)} sub="Of one core" />}
        {timer && <Row label="Next run" value={when(s.next_run)} />}
        {timer && <Row label="Last run" value={when(s.last_run)} />}
        <Row label="Starts at boot" value={s.enabled === 'enabled' ? 'Yes' : s.enabled === 'disabled' ? 'No' : s.enabled || '–'} />
        {s.restarts > 0 && <Row label="Automatic restarts" value={String(s.restarts)} />}
        {s.pid ? <Row label="Process ID" value={String(s.pid)} /> : null}
        <Row label="Description" sub={s.description} />
      </Group>

      {s.events.length > 0 && (
        <Group header="Recent changes">
          {s.events.slice(0, 8).map((e) => (
            <Row key={e.id} label={EVENT_WORDS[e.detail] ?? e.detail} value={when(e.ts)} />
          ))}
        </Group>
      )}

      <Journal lines={s.journal} />
    </View>
  )
}
