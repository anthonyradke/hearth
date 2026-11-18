import { RefreshControl, ScrollView, View } from 'react-native'
import { Dot } from '@/components/Dot'
import { Group, Row } from '@/components/Row'
import { StaleBanner, StateView } from '@/components/StateView'
import { Txt } from '@/components/Txt'
import type { Service } from '@/lib/api'
import { useServices, usePull } from '@/lib/data'
import { bytes, span, until } from '@/lib/format'
import { healthColor, healthLabel } from '@/lib/status'
import { space, useTheme } from '@/theme'

/** "Running · 1.2 GB · 6 days", "Scheduled · in 8 h", "Stopped". */
export function serviceLine(s: Service): string {
  const parts = [healthLabel(s)]
  if (s.type === 'timer') {
    if (s.next_run) parts.push(`next ${until(s.next_run)}`)
    return parts.join(' · ')
  }
  if (s.health === 'ok' && s.type !== 'oneshot') {
    if (s.memory) parts.push(bytes(s.memory))
    if (s.since) parts.push(span(Date.now() / 1000 - s.since))
  }
  return parts.join(' · ')
}

function ServiceRow({ s }: { s: Service }) {
  const { c } = useTheme()
  return (
    <Row label={s.name} sub={serviceLine(s)} leading={<Dot color={healthColor(s.health, c)} />}
      href={`/service/${encodeURIComponent(s.unit)}` as never} />
  )
}

export default function Services() {
  const q = useServices()
  const pull = usePull(q)
  const { c } = useTheme()
  const d = q.data
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: c.bg }}
      contentContainerStyle={{ padding: space.l, paddingBottom: 120 }} refreshControl={<RefreshControl {...pull} />}>
      <StaleBanner q={q} />
      {!d ? <StateView q={q} shape="list" /> : !d.hosts || d.hosts.length < 2 ? (
        <View style={{ gap: space.xxl }}>
          {d.groups.map((g) => (
            <Group key={g} header={g}>
              {d.services.filter((s) => s.group === g).map((s) => <ServiceRow key={s.unit} s={s} />)}
            </Group>
          ))}
        </View>
      ) : (
        // One section per machine, then its groups. Older servers have no hosts: the flat list above.
        <View style={{ gap: space.section }}>
          {d.hosts.map((h) => {
            const mine = d.services.filter((s) => (s.host ?? d.hosts![0].id) === h.id)
            const sections = [...new Set(mine.map((s) => s.section ?? s.group))]
            return (
              <View key={h.id} style={{ gap: space.l }}>
                <View style={{ paddingHorizontal: space.xs, gap: 2 }}>
                  <Txt variant="title2" accessibilityRole="header">{h.name}</Txt>
                  {h.reachable === false && <Txt variant="callout" tone="neg">Not answering: showing the last known state</Txt>}
                </View>
                {sections.map((g) => (
                  <Group key={g} header={g}>
                    {mine.filter((s) => (s.section ?? s.group) === g).map((s) => <ServiceRow key={s.unit} s={s} />)}
                  </Group>
                ))}
              </View>
            )
          })}
        </View>
      )}
    </ScrollView>
  )
}
