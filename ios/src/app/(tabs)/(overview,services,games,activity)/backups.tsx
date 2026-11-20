import { useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { RefreshControl, ScrollView, View } from 'react-native'
import { Dot } from '@/components/Dot'
import { Segmented } from '@/components/native/Segmented'
import { Group, Row } from '@/components/Row'
import { StaleBanner, StateView } from '@/components/StateView'
import { Txt } from '@/components/Txt'
import type { Backups as B, Job } from '@/lib/api'
import { useBackups, usePull } from '@/lib/data'
import { ago, bytes, count, span, when } from '@/lib/format'
import { mono, space, useTheme } from '@/theme'

export default function Backups() {
  // host: open on another machine's backups (?host=h5, from one of its issues).
  const params = useLocalSearchParams<{ host?: string }>()
  const q = useBackups()
  const pull = usePull(q)
  const { c } = useTheme()
  const hosts = q.data?.hosts ?? []
  const [picked, setPicked] = useState<string | undefined>(params.host)
  const current = hosts.find((h) => h.id === picked) ?? hosts.find((h) => h.local)
  const b = current?.backups ?? q.data
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: c.bg }}
      contentContainerStyle={{ padding: space.l, paddingBottom: 120, gap: space.m }} refreshControl={<RefreshControl {...pull} />}>
      <StaleBanner q={q} />
      {hosts.length > 1 && (
        <Segmented options={hosts.map((h) => [h.id, h.name] as [string, string])} value={current?.id ?? hosts[0].id}
          onChange={setPicked} />
      )}
      {current && !current.local && current.reachable === false && (
        <Txt variant="callout" tone="label2" style={{ paddingHorizontal: space.xs }}>
          {current.name} isn’t answering; this is the last status it sent.
        </Txt>
      )}
      {b ? <Body b={b} /> : <StateView q={q} shape="detail" />}
    </ScrollView>
  )
}

const RESULT: Record<string, string> = { ok: 'Passed', partial: 'Partly done', failed: 'Failed', running: 'Running now' }
const took = (j?: Job | null) => (j?.started && j.finished ? span(j.finished - j.started) : null)

function Body({ b }: { b: B }) {
  const { c } = useTheme()
  if (!b.available) {
    return <Group footer={b.error}><Row label="Backup status unavailable" sub="The backup tool’s status file couldn’t be read." /></Group>
  }
  const last = b.backup
  const failed = last?.result === 'failed'
  const tone = failed ? c.neg : last?.result === 'partial' ? c.warn : c.pos
  return (
    <View style={{ gap: space.section - 4 }}>
      <View style={{ gap: 4, paddingHorizontal: space.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <Dot color={tone} size={12} />
          <Txt variant="title" style={failed ? { color: c.neg } : undefined}>
            {failed ? 'Last backup failed' : last?.result === 'running' ? 'Backing up now' : `Backed up ${ago(b.last_success)}`}
          </Txt>
        </View>
        <Txt variant="callout" tone="label2">
          {b.timers?.backup?.next ? `Next backup ${when(b.timers.backup.next)}` : 'No backup scheduled'}
        </Txt>
      </View>
      {failed && last?.error && (
        <Group header="Error"><View style={{ padding: 16 }}><Txt selectable style={[mono, { color: c.neg }]}>{last.error}</Txt></View></Group>
      )}

      {last && (
        <Group header="Last backup">
          <Row label="Started" value={when(last.started)} />
          {took(last) && <Row label="Took" value={took(last)!} />}
          {last.bytes_added != null && <Row label="New data" value={bytes(last.bytes_added)} sub={last.bytes_uploaded != null ? `${bytes(last.bytes_uploaded)} uploaded after compression` : undefined} />}
          {last.files_total != null && <Row label="Files" value={count(last.files_total)} sub={`${count(last.files_new ?? 0)} new, ${count(last.files_changed ?? 0)} changed`} />}
          {last.tag && <Row label="Kind" value={last.tag} />}
          {(last.missing_sources?.length ?? 0) > 0 && <Row label="Missing sources" sub={last.missing_sources!.join('\n')} />}
        </Group>
      )}

      <Group header="Storage">
        {b.repo && <Row label="Snapshots" value={String(b.repo.snapshots)} />}
        {b.repo && <Row label="Stored" value={bytes(b.repo.size_bytes)} sub="After compression and deduplication" />}
      </Group>

      {b.local && <LocalCopy l={b.local} drift={b.drift} />}

      <Group header="Checks" footer="The weekly check reads back a different 1/52 of the stored data, so all of it once a year. The monthly drill restores a few files and verifies them.">
        <Row label="Integrity check" leading={<Dot color={b.check?.result === 'failed' ? c.neg : b.check ? c.pos : c.label3} />}
          value={b.check ? RESULT[b.check.result] ?? b.check.result : 'Not run yet'}
          sub={[b.check?.finished && `Last ${when(b.check.finished)}`, b.timers?.check?.next && `next ${when(b.timers.check.next)}`].filter(Boolean).join(' · ') || undefined} />
        <Row label="Restore drill" leading={<Dot color={b.drill?.result === 'failed' ? c.neg : b.drill ? c.pos : c.label3} />}
          value={b.drill ? RESULT[b.drill.result] ?? b.drill.result : 'Not run yet'}
          sub={[b.drill?.finished && `Last ${when(b.drill.finished)}`, b.timers?.drill?.next && `next ${when(b.timers.drill.next)}`].filter(Boolean).join(' · ') || undefined} />
      </Group>

      {(b.sources?.length ?? 0) > 0 && (
        <Group header="What’s backed up">
          {b.sources!.filter((s) => s.bytes > 0).map((s) => (
            <Row key={s.path} label={s.path.split('/').filter(Boolean).slice(-2).join('/') || '/'} value={bytes(s.bytes)} />
          ))}
        </Group>
      )}
    </View>
  )
}

/** The second copy cellar keeps on the other machine's disk: same jobs, restores in minutes instead of days. */
function LocalCopy({ l, drift }: { l: NonNullable<B['local']>; drift?: B['drift'] }) {
  const { c } = useTheme()
  const dot = (j?: Job | null) => <Dot color={j?.result === 'failed' ? c.neg : j?.result === 'partial' ? c.warn : j ? c.pos : c.label3} />
  const line = (j?: Job | null) => (j ? RESULT[j.result] ?? j.result : 'Not run yet')
  return (
    <Group header="Local copy" footer="A second copy on another machine’s disk, written with every backup. The offsite copy is the one that survives the house; this one restores in minutes. The server can add to it but can’t delete it.">
      <Row label="Last copy" leading={dot(l.backup)} value={l.backup?.result === 'failed' ? 'Failed' : l.last_success ? ago(l.last_success) : 'Never'}
        sub={l.backup?.result === 'failed' ? l.backup.error ?? undefined : undefined} />
      <Row label="Half-hourly" leading={dot(l.frequent)} value={line(l.frequent)}
        sub={l.frequent?.result === 'failed' ? l.frequent.error ?? undefined : l.frequent?.finished ? `Last ${when(l.frequent.finished)}` : undefined} />
      <Row label="Integrity check" leading={dot(l.check)} value={line(l.check)} sub={l.check?.finished ? `Last ${when(l.check.finished)}` : undefined} />
      <Row label="Restore drill" leading={dot(l.drill)} value={line(l.drill)} sub={l.drill?.finished ? `Last ${when(l.drill.finished)}` : undefined} />
      {l.repo && <Row label="Stored" value={bytes(l.repo.size_bytes)} sub={`${l.repo.snapshots} snapshots`} />}
      {drift && (
        <Row label="Matches off-site" leading={<Dot color={drift.result === 'drift' ? c.warn : c.pos} />}
          value={drift.result === 'drift' ? 'Differs' : 'Yes'}
          sub={drift.result === 'drift'
            ? (drift.problems?.length ? drift.problems.join('\n') : drift.gap_hours != null ? `${Math.round(drift.gap_hours)} hours apart` : undefined)
            : drift.measured ? `Compared ${when(drift.measured)}` : undefined} />
      )}
    </Group>
  )
}
