import { useMemo, useState } from 'react'
import { View } from 'react-native'
import Animated, { FadeIn, useReducedMotion, useSharedValue } from 'react-native-reanimated'
import type { Range } from '@/lib/api'
import { useHistory } from '@/lib/data'
import { font, radius, space, useTheme } from '@/theme'
import { Figure } from './Figure'
import { Segmented } from './native/Segmented'
import { ScrubChart } from './ScrubChart'
import { Skel } from './StateView'
import { Txt } from './Txt'

const RANGES: [Range, string][] = [['1h', '1H'], ['6h', '6H'], ['24h', '24H'], ['7d', '7D'], ['30d', '30D']]

function stamp(ts: number, r: Range): string {
  const d = new Date(ts * 1000)
  const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (r === '1h' || r === '6h' || (r === '24h' && d.toDateString() === new Date().toDateString())) return t
  return `${d.toLocaleDateString('en-US', { weekday: r === '24h' ? 'short' : undefined, month: r === '24h' ? undefined : 'short', day: r === '24h' ? undefined : 'numeric' })}, ${t}`
}

/** A figure you can scrub over a chart with a range picker: the detail view for any history key. The figure shows
 *  `now` at rest and the average of each bucket under the finger. `zero` pins the floor at 0; `span` keeps a nearly flat
 *  line from being magnified into noise. */
export function MetricChart({ metric, title, format, now, zero = true, span = 0, second, initial = '24h', big = false }: {
  metric: string; title?: string; format: (v: number) => string; now: number | null | undefined
  zero?: boolean; span?: number; second?: string; initial?: Range; big?: boolean
}) {
  const { c } = useTheme()
  const reduce = useReducedMotion()
  const [range, setRange] = useState<Range>(initial)
  const q = useHistory(metric, range)
  const q2 = useHistory(second ?? '', range, !!second)
  const scrub = useSharedValue(-1)
  const pts = q.data?.key === metric && q.data.range === range ? q.data.points : q.data?.points ?? []
  const vals = useMemo(() => pts.map((p) => p[1]), [pts])
  const texts = useMemo(() => vals.map(format), [vals, format])
  const labels = useMemo(() => pts.map((p) => stamp(p[0], range)), [pts, range])
  const stats = useMemo(() => {
    if (!vals.length) return null
    return { avg: vals.reduce((a, b) => a + b, 0) / vals.length, peak: Math.max(...pts.map((p) => p[3])) }
  }, [vals, pts])
  const series = useMemo(() => {
    const s = [{ values: vals, color: c.ink }]
    if (second && q2.data) s.push({ values: q2.data.points.map((p) => p[1]), color: c.label3 })
    return s
  }, [vals, second, q2.data, c])

  return (
    <View style={{ gap: space.m }}>
      {title && <Txt variant="sub" tone="label2" style={{ paddingHorizontal: space.l }}>{title}</Txt>}
      <View style={{ backgroundColor: c.panel, borderRadius: radius.panel, borderCurve: 'continuous', padding: space.l, gap: space.m }}>
        <Figure value={now == null ? '–' : format(now)} texts={texts} labels={labels} scrub={scrub}
          style={big ? font.hero : font.title}
          caption={<Txt variant="callout" tone="label2" num>{stats ? `Average ${format(stats.avg)} · peak ${format(stats.peak)}` : ' '}</Txt>} />
        {vals.length > 1 ? (
          <Animated.View key={range} entering={reduce ? undefined : FadeIn.duration(150)}>
            <ScrubChart series={series} slots={vals.length} height={big ? 180 : 140} scrub={scrub} zero={zero} span={span} />
          </Animated.View>
        ) : q.isLoading ? <Skel w="100%" h={big ? 180 : 140} r={12} /> : (
          <View style={{ height: big ? 180 : 140, alignItems: 'center', justifyContent: 'center' }}>
            <Txt variant="sub" tone="label2">Not enough history yet</Txt>
          </View>
        )}
        <Segmented options={RANGES} value={range} onChange={setRange} />
      </View>
    </View>
  )
}
