import { useMemo, useState } from 'react'
import { View } from 'react-native'
import Svg, { Path } from 'react-native-svg'

/** A small line with no axes, for tiles. Scaled to its own range, but never tighter than `span`, so a flat line
 *  with a 0.1% wobble stays flat instead of looking like a cliff. `min`/`max` pin the ends (percentages: 0–100). */
export function Sparkline({ values, color, height = 32, min, max, span = 0 }: {
  values: number[]; color: string; height?: number; min?: number; max?: number; span?: number
}) {
  const [w, setW] = useState(0)
  const d = useMemo(() => {
    const v = values.filter((x) => x != null && isFinite(x))
    if (v.length < 2 || w <= 0) return ''
    let lo = min ?? Math.min(...v)
    let hi = Math.max(max ?? -Infinity, ...v)
    if (hi - lo < span) { const mid = (hi + lo) / 2; lo = mid - span / 2; hi = mid + span / 2 }
    if (hi - lo < 1e-9) { hi = lo + 1 }
    const pad = 2
    return v.map((x, i) => {
      const px = (i / (v.length - 1)) * w
      const py = pad + (1 - (x - lo) / (hi - lo)) * (height - pad * 2)
      return `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`
    }).join('')
  }, [values, w, height, min, max, span])
  return (
    <View style={{ height }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {!!d && (
        <Svg width={w} height={height}>
          <Path d={d} stroke={color} strokeWidth={1.75} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      )}
    </View>
  )
}
