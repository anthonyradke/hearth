// The signature: every trend chart is touchable. Dragging moves a hairline cursor and dot, the line past the finger
// dims, and the figure above (ScrubFigure) is rewritten on the UI thread to the value under the finger. Releasing
// hands the chart back to "now". No axes: the figure is the axis.
import { useId, useMemo, useState } from 'react'
import { View } from 'react-native'
import Svg, { ClipPath, Defs, G, Line, Path, Rect } from 'react-native-svg'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  useAnimatedProps, useAnimatedStyle, useSharedValue, withTiming, type SharedValue,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import * as Haptics from 'expo-haptics'
import { useTheme } from '@/theme'

const ARect = Animated.createAnimatedComponent(Rect)

export interface Series { values: number[]; color: string; dashed?: boolean; dim?: boolean }

/** Monotone cubic path (Fritsch-Carlson): smooth, but never overshoots, so a flat stretch stays flat. */
function monotonePath(xs: number[], ys: number[]): string {
  const n = xs.length
  if (n === 0) return ''
  if (n === 1) return `M${xs[0]},${ys[0]}`
  const dx: number[] = [], m: number[] = []
  for (let i = 0; i < n - 1; i++) { dx.push(xs[i + 1] - xs[i]); m.push((ys[i + 1] - ys[i]) / (dx[i] || 1)) }
  const t: number[] = [m[0]]
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2)
  t.push(m[n - 2])
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i] }
  }
  let d = `M${xs[0].toFixed(1)},${ys[0].toFixed(1)}`
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3
    d += `C${(xs[i] + h).toFixed(1)},${(ys[i] + t[i] * h).toFixed(1)} ${(xs[i + 1] - h).toFixed(1)},${(ys[i + 1] - t[i + 1] * h).toFixed(1)} ${xs[i + 1].toFixed(1)},${ys[i + 1].toFixed(1)}`
  }
  return d
}

export function ScrubChart({ series, slots, height = 150, scrub, zero = false, guide, span = 0 }: {
  /** series[0] is the one the finger reads, one value per slot from the left. */
  series: Series[]
  /** Total slots across the width; series may be shorter. */
  slots: number
  height?: number
  /** -1 when idle, else the slot under the finger. */
  scrub: SharedValue<number>
  /** Pin the scale's floor at 0. */
  zero?: boolean
  /** A dashed horizontal reference (a threshold). */
  guide?: number | null
  /** The scale is never tighter than this, so a nearly flat line stays flat instead of magnifying noise. */
  span?: number
}) {
  const { c } = useTheme()
  const [w, setW] = useState(0)
  const clipId = `past${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const pad = 6
  const geo = useMemo(() => {
    const all = series.flatMap((s) => s.values).concat(guide ?? [])
    let lo = zero ? Math.min(0, ...all) : Math.min(...all)
    let hi = Math.max(...all)
    if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1 }
    if (hi - lo < span) { const mid = (hi + lo) / 2; lo = zero ? Math.max(0, Math.min(lo, mid - span / 2)) : mid - span / 2; hi = lo + span }
    if (hi === lo) { hi += 1; lo -= zero ? 0 : 1 }
    const inner = w - pad * 2 // keep the end dot inside the edges
    const X = (i: number) => (slots <= 1 ? w / 2 : pad + (i / (slots - 1)) * inner)
    const Y = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * (height - pad * 2)
    const paths = series.map((s) => monotonePath(s.values.map((_, i) => X(i)), s.values.map(Y)))
    const p = series[0]?.values ?? []
    return { X, Y, paths, xs: p.map((_, i) => X(i)), ys: p.map(Y), guideY: guide != null ? Y(guide) : null }
  }, [series, slots, w, height, zero, guide, span])

  // Pixel positions of the primary series, captured by the worklets below (re-created when the geometry changes).
  const xs = geo.xs
  const ys = geo.ys
  const shown = useSharedValue(0) // cursor opacity

  const toIndex = (x: number) => {
    'worklet'
    const n = xs.length
    if (n === 0 || slots <= 1 || w <= 0) return n - 1
    const i = Math.round((Math.max(0, Math.min(w - pad * 2, x - pad)) / (w - pad * 2)) * (slots - 1))
    return Math.min(i, n - 1)
  }
  const tick = () => { Haptics.selectionAsync().catch(() => {}) }
  const move = (x: number) => {
    'worklet'
    const i = toIndex(x)
    if (i !== scrub.get()) { scrub.set(i); scheduleOnRN(tick) }
  }
  const begin = (x: number) => {
    'worklet'
    shown.set(withTiming(1, { duration: 120 }))
    move(x)
  }
  const end = () => {
    'worklet'
    shown.set(withTiming(0, { duration: 180 }))
    scrub.set(-1)
  }
  // Two ways in: a horizontal drag starts at once; press-and-hold starts in place. Vertical movement scrolls.
  const drag = Gesture.Pan().activeOffsetX([-6, 6]).failOffsetY([-12, 12])
    .onStart((e) => begin(e.x)).onUpdate((e) => move(e.x)).onFinalize(() => end())
  const hold = Gesture.Pan().activateAfterLongPress(180)
    .onStart((e) => begin(e.x)).onUpdate((e) => move(e.x)).onFinalize(() => end())
  const gesture = Gesture.Race(drag, hold)

  const line = useAnimatedStyle(() => {
    const i = scrub.get()
    const x = i >= 0 && i < xs.length ? xs[i] : xs.length ? xs[xs.length - 1] : 0
    return { opacity: shown.get(), transform: [{ translateX: x - 0.5 }] }
  }, [xs])
  const dot = useAnimatedStyle(() => {
    const i = scrub.get()
    const k = i >= 0 && i < xs.length ? i : xs.length - 1
    return { transform: [{ translateX: (xs[k] ?? 0) - 5 }, { translateY: (ys[k] ?? 0) - 5 }] }
  }, [xs, ys])
  // Everything right of the finger fades back; at rest the full line shows.
  const clip = useAnimatedProps(() => {
    const i = scrub.get()
    return { width: i >= 0 && i < xs.length ? xs[i] : w + 10 }
  }, [xs, w])

  const primary = series[0]
  return (
    <GestureDetector gesture={gesture}>
      <View style={{ height }} onLayout={(e) => setW(e.nativeEvent.layout.width)} collapsable={false}
        accessibilityRole="adjustable" accessibilityLabel="Chart. Drag to read values.">
        {w > 0 && (
          <Svg width={w} height={height}>
            <Defs>
              <ClipPath id={clipId}><ARect x={0} y={0} height={height} animatedProps={clip} /></ClipPath>
            </Defs>
            {geo.guideY != null && (
              <Line x1={0} x2={w} y1={geo.guideY} y2={geo.guideY} stroke={c.label3} strokeWidth={1} strokeDasharray="2,4" />
            )}
            {series.slice(1).map((s, i) => (
              <Path key={i} d={geo.paths[i + 1]} stroke={s.color} strokeWidth={2} fill="none"
                strokeDasharray={s.dashed ? '1,5' : undefined} strokeLinecap="round" strokeLinejoin="round" />
            ))}
            {primary && (
              <>
                <Path d={geo.paths[0]} stroke={c.label3} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <G clipPath={`url(#${clipId})`}>
                  <Path d={geo.paths[0]} stroke={primary.color} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </G>
              </>
            )}
          </Svg>
        )}
        {w > 0 && primary && primary.values.length > 0 && (
          <>
            <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: c.label3 }, line]} />
            <Animated.View pointerEvents="none" style={[{
              position: 'absolute', left: 0, top: 0, width: 10, height: 10, borderRadius: 5,
              backgroundColor: primary.color, borderWidth: 2, borderColor: c.panel,
            }, dot]} />
          </>
        )}
      </View>
    </GestureDetector>
  )
}
