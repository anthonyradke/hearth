import { RefreshControl, ScrollView, View } from 'react-native'
import { Dot } from '@/components/Dot'
import { Group, Row } from '@/components/Row'
import { StaleBanner, StateView } from '@/components/StateView'
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

export default function Services() {
  const q = useServices()
  const pull = usePull(q)
  const { c } = useTheme()
  const d = q.data
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: c.bg }}
      contentContainerStyle={{ padding: space.l, paddingBottom: 120 }} refreshControl={<RefreshControl {...pull} />}>
      <StaleBanner q={q} />
      {!d ? <StateView q={q} shape="list" /> : (
        <View style={{ gap: space.xxl }}>
          {d.groups.map((g) => (
            <Group key={g} header={g}>
              {d.services.filter((s) => s.group === g).map((s) => (
                <Row key={s.unit} label={s.name} sub={serviceLine(s)} leading={<Dot color={healthColor(s.health, c)} />}
                  href={`/service/${encodeURIComponent(s.unit)}` as never} />
              ))}
            </Group>
          ))}
        </View>
      )}
    </ScrollView>
  )
}
