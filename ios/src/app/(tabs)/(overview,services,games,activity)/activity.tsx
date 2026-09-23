import { useMemo, useState } from 'react'
import { RefreshControl, SectionList, View } from 'react-native'
import type { SFSymbol } from 'expo-symbols'
import { Icon } from '@/components/Icon'
import { Segmented } from '@/components/native/Segmented'
import { StaleBanner, StateView } from '@/components/StateView'
import { Txt } from '@/components/Txt'
import type { Alert, Audit, Event } from '@/lib/api'
import { useAlerts, useAudit, useEvents, useGames, usePull, useServices } from '@/lib/data'
import { clock, dayLabel, span } from '@/lib/format'
import { radius, space, useTheme } from '@/theme'

type Tab = 'all' | 'alerts' | 'actions'
interface Item { key: string; ts: number; sf: SFSymbol; md: string; text: string; sub?: string; tone?: 'neg' | 'warn' }

const STATE: Record<string, string> = {
  ok: 'started', restarted: 'restarted', stopped: 'stopped', down: 'stopped unexpectedly', failed: 'failed',
  starting: 'is starting', stopping: 'is stopping',
}
const VERB: Record<string, string> = {
  start: 'Started', stop: 'Stopped', restart: 'Restarted', 'test-notification': 'Sent a test notification',
  rcon: 'Ran a console command on', 'list-add': 'Added to a list on', 'list-remove': 'Removed from a list on',
}

function fromEvent(e: Event, names: Map<string, string>): Item {
  const name = names.get(e.subject) ?? e.subject
  const base = { key: `e${e.id}`, ts: e.ts }
  switch (e.kind) {
    case 'join': return { ...base, sf: 'arrow.right.circle', md: 'login', text: `${e.detail} joined ${name}` }
    case 'leave': return { ...base, sf: 'arrow.left.circle', md: 'logout', text: `${e.detail} left ${name}` }
    case 'ip': return { ...base, sf: 'network', md: 'lan', text: 'Public IP changed', sub: e.detail, tone: 'warn' }
    case 'service': {
      const bad = e.detail === 'failed' || e.detail === 'down'
      return { ...base, sf: bad ? 'exclamationmark.octagon' : e.detail === 'ok' || e.detail === 'restarted' ? 'play.circle' : 'stop.circle',
        md: bad ? 'error' : 'play_circle', text: `${name} ${STATE[e.detail] ?? e.detail}`, tone: bad ? 'neg' : undefined }
    }
    default: return { ...base, sf: 'circle', md: 'circle', text: `${e.kind}: ${e.subject} ${e.detail}` }
  }
}

function fromAlert(a: Alert): Item {
  const open = a.ended == null
  const lasted = span((a.ended ?? Date.now() / 1000) - a.started)
  return {
    key: `a${a.id}`, ts: a.started, sf: open ? 'bell.badge.fill' : 'bell', md: 'notifications', text: a.title,
    sub: open ? `Ongoing for ${lasted}${a.notified ? '' : ' · not sent yet'}` : `Lasted ${lasted}${a.notified ? '' : ' · too short to send'}`,
    tone: open ? (a.severity === 'critical' ? 'neg' : 'warn') : undefined,
  }
}

function fromAudit(a: Audit, names: Map<string, string>): Item {
  const failed = a.result !== 'ok'
  const target = names.get(a.target) ?? a.target
  return {
    key: `u${a.id}`, ts: a.ts, sf: failed ? 'xmark.circle' : 'hand.tap', md: failed ? 'cancel' : 'touch_app',
    text: `${VERB[a.action] ?? a.action} ${a.action === 'test-notification' ? '' : target}`.trim(),
    sub: [a.detail, failed ? `Failed: ${a.result}` : ''].filter(Boolean).join(' · ') || undefined,
    tone: failed ? 'neg' : undefined,
  }
}

export default function Activity() {
  const [tab, setTab] = useState<Tab>('all')
  const events = useEvents()
  const alerts = useAlerts()
  const audit = useAudit()
  const games = useGames().data?.games
  const services = useServices().data?.services
  const pull = usePull(events, alerts, audit)
  const { c } = useTheme()
  const names = useMemo(() => new Map<string, string>([
    ...(services ?? []).map((s) => [s.unit, s.name] as [string, string]),
    ...(games ?? []).map((g) => [g.id, g.name] as [string, string]),
  ]), [games, services])

  const q = tab === 'alerts' ? alerts : tab === 'actions' ? audit : events
  const sections = useMemo(() => {
    let items: Item[] = []
    if (tab === 'alerts') items = (alerts.data?.alerts ?? []).map(fromAlert)
    else if (tab === 'actions') items = (audit.data?.audit ?? []).map((a) => fromAudit(a, names))
    else {
      items = [
        ...(events.data?.events ?? []).map((e) => fromEvent(e, names)),
        ...(alerts.data?.alerts ?? []).filter((a) => a.notified).map(fromAlert),
      ].sort((a, b) => b.ts - a.ts)
    }
    const out: { title: string; data: Item[] }[] = []
    // Ongoing alerts sit on top, whatever day they started.
    if (tab === 'alerts') {
      const open = items.filter((i) => i.sf === 'bell.badge.fill')
      if (open.length) out.push({ title: 'Ongoing', data: open })
      items = items.filter((i) => i.sf !== 'bell.badge.fill')
    }
    for (const i of items) {
      const t = dayLabel(i.ts)
      if (out.at(-1)?.title !== t) out.push({ title: t, data: [] })
      out.at(-1)!.data.push(i)
    }
    return out
  }, [tab, events.data, alerts.data, audit.data, names])

  const empty = {
    all: ['Nothing yet', 'Players joining and leaving, services starting and stopping, and alerts show up here.'],
    alerts: ['No alerts', 'When something needs you, it’s listed here and sent to your phone through ntfy.'],
    actions: ['No actions yet', 'Restarts, console commands and list changes made from this app are logged here.'],
  }[tab]

  return (
    <SectionList contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: c.bg }}
      contentContainerStyle={{ padding: space.l, paddingBottom: 120 }}
      refreshControl={<RefreshControl {...pull} />}
      sections={q.data ? sections : []} keyExtractor={(i) => i.key} stickySectionHeadersEnabled={false}
      ListHeaderComponent={
        <View style={{ gap: space.s }}>
          <StaleBanner q={q} />
          <Segmented options={[['all', 'All'], ['alerts', 'Alerts'], ['actions', 'Actions']]} value={tab} onChange={setTab} />
        </View>
      }
      ListEmptyComponent={q.data ? (
        <View style={{ alignItems: 'center', paddingTop: 72, gap: space.s, paddingHorizontal: space.xxl }}>
          <Icon sf={tab === 'alerts' ? 'bell' : tab === 'actions' ? 'hand.tap' : 'clock'} md="history" size={32} color={c.label3} />
          <Txt variant="headline">{empty[0]}</Txt>
          <Txt variant="callout" tone="label2" style={{ textAlign: 'center' }}>{empty[1]}</Txt>
        </View>
      ) : <View style={{ paddingTop: space.xl }}><StateView q={q} shape="list" /></View>}
      renderSectionHeader={({ section }) => (
        <Txt variant="sub" tone="label2" style={{ paddingHorizontal: space.l, paddingTop: space.xl, paddingBottom: 6 }}>{section.title}</Txt>
      )}
      renderItem={({ item, index, section }) => {
        const first = index === 0, last = index === section.data.length - 1
        return (
          <View style={{
            backgroundColor: c.panel, flexDirection: 'row', alignItems: 'center', gap: space.m,
            paddingHorizontal: space.l, minHeight: 50, paddingVertical: space.s,
            borderTopLeftRadius: first ? radius.panel : 0, borderTopRightRadius: first ? radius.panel : 0,
            borderBottomLeftRadius: last ? radius.panel : 0, borderBottomRightRadius: last ? radius.panel : 0,
            borderCurve: 'continuous',
          }}>
            <Icon sf={item.sf} md={item.md} size={18} color={item.tone ? c[item.tone] : c.label2} />
            <View style={{ flex: 1, gap: 1 }}>
              <Txt variant="body" tone={item.tone ?? 'label'}>{item.text}</Txt>
              {item.sub && <Txt variant="foot" tone="label2">{item.sub}</Txt>}
            </View>
            <Txt variant="sub" tone="label2" num>{clock(item.ts)}</Txt>
            {!last && <View style={{ position: 'absolute', left: space.l + 18 + space.m, right: 0, bottom: 0, height: 0.5, backgroundColor: c.sep }} />}
          </View>
        )
      }}
    />
  )
}
