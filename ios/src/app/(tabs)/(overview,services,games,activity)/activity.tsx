import { useMemo } from 'react'
import { RefreshControl, SectionList, View } from 'react-native'
import { Icon } from '@/components/Icon'
import { StaleBanner, StateView } from '@/components/StateView'
import { Txt } from '@/components/Txt'
import type { Event } from '@/lib/api'
import { useEvents, useGames, usePull, useServices } from '@/lib/data'
import { clock, dayLabel } from '@/lib/format'
import { radius, space, useTheme } from '@/theme'
import type { SFSymbol } from 'expo-symbols'

interface Line { sf: SFSymbol; md: string; text: string; tone?: 'neg' | 'warn' }

const STATE: Record<string, string> = {
  ok: 'started', restarted: 'restarted', stopped: 'stopped', down: 'stopped unexpectedly', failed: 'failed',
  starting: 'is starting', stopping: 'is stopping',
}

function describe(e: Event, names: Map<string, string>): Line {
  const name = names.get(e.subject) ?? e.subject
  switch (e.kind) {
    case 'join': return { sf: 'arrow.right.circle', md: 'login', text: `${e.detail} joined ${name}` }
    case 'leave': return { sf: 'arrow.left.circle', md: 'logout', text: `${e.detail} left ${name}` }
    case 'ip': return { sf: 'network', md: 'lan', text: 'Public IP changed', tone: 'warn' }
    case 'service': {
      const bad = e.detail === 'failed' || e.detail === 'down'
      return { sf: bad ? 'exclamationmark.octagon' : e.detail === 'ok' || e.detail === 'restarted' ? 'play.circle' : 'stop.circle',
        md: bad ? 'error' : 'play_circle', text: `${name} ${STATE[e.detail] ?? e.detail}`, tone: bad ? 'neg' : undefined }
    }
    default: return { sf: 'circle', md: 'circle', text: `${e.kind}: ${e.subject} ${e.detail}` }
  }
}

export default function Activity() {
  const q = useEvents()
  const games = useGames().data?.games
  const services = useServices().data?.services
  const pull = usePull(q)
  const { c } = useTheme()
  const names = useMemo(() => new Map<string, string>([
    ...(services ?? []).map((s) => [s.unit, s.name] as [string, string]),
    ...(games ?? []).map((g) => [g.id, g.name] as [string, string]),
  ]), [games, services])
  const sections = useMemo(() => {
    const out: { title: string; data: Event[] }[] = []
    for (const e of q.data?.events ?? []) {
      const t = dayLabel(e.ts)
      if (out.at(-1)?.title !== t) out.push({ title: t, data: [] })
      out.at(-1)!.data.push(e)
    }
    return out
  }, [q.data])

  if (!q.data) {
    return <View style={{ flex: 1, backgroundColor: c.bg, padding: space.l, paddingTop: 140 }}><StateView q={q} shape="list" /></View>
  }
  return (
    <SectionList contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: c.bg }}
      contentContainerStyle={{ padding: space.l, paddingBottom: 120 }}
      refreshControl={<RefreshControl {...pull} />}
      sections={sections} keyExtractor={(e) => String(e.id)} stickySectionHeadersEnabled={false}
      ListHeaderComponent={<StaleBanner q={q} />}
      ListEmptyComponent={
        <View style={{ alignItems: 'center', paddingTop: 80, gap: space.s, paddingHorizontal: space.xxl }}>
          <Icon sf="clock" md="history" size={32} color={c.label3} />
          <Txt variant="headline">Nothing yet</Txt>
          <Txt variant="callout" tone="label2" style={{ textAlign: 'center' }}>
            Players joining and leaving, services starting and stopping, and alerts show up here.
          </Txt>
        </View>
      }
      renderSectionHeader={({ section }) => (
        <Txt variant="sub" tone="label2" style={{ paddingHorizontal: space.l, paddingTop: space.xl, paddingBottom: 6 }}>{section.title}</Txt>
      )}
      renderItem={({ item, index, section }) => {
        const l = describe(item, names)
        const first = index === 0, last = index === section.data.length - 1
        return (
          <View style={{
            backgroundColor: c.panel, flexDirection: 'row', alignItems: 'center', gap: space.m,
            paddingHorizontal: space.l, minHeight: 50, paddingVertical: space.s,
            borderTopLeftRadius: first ? radius.panel : 0, borderTopRightRadius: first ? radius.panel : 0,
            borderBottomLeftRadius: last ? radius.panel : 0, borderBottomRightRadius: last ? radius.panel : 0,
            borderCurve: 'continuous',
          }}>
            <Icon sf={l.sf} md={l.md} size={18} color={l.tone ? c[l.tone] : c.label2} />
            <Txt variant="body" style={{ flex: 1 }} tone={l.tone ?? 'label'}>{l.text}</Txt>
            <Txt variant="sub" tone="label2" num>{clock(item.ts)}</Txt>
            {!last && <View style={{ position: 'absolute', left: space.l + 18 + space.m, right: 0, bottom: 0, height: 0.5, backgroundColor: c.sep }} />}
          </View>
        )
      }}
    />
  )
}
