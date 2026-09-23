import { View } from 'react-native'
import type { Href } from 'expo-router'
import type { SFSymbol } from 'expo-symbols'
import { radius, space, useTheme } from '@/theme'
import { Icon } from './Icon'
import { Sparkline } from './Sparkline'
import { Tap } from './Tap'
import { Txt } from './Txt'

/** Health-style metric tile: symbol and label, one big number, a caption and a sparkline. Neutral unless `alert`. */
export function Tile({ label, sf, md, value, caption, spark, sparkMin, sparkMax, sparkSpan, alert, href }: {
  label: string; sf: SFSymbol; md: string; value: string; caption?: string
  spark?: number[]; sparkMin?: number; sparkMax?: number; sparkSpan?: number; alert?: string; href?: Href
}) {
  const { c } = useTheme()
  const tone = alert ?? c.label2
  return (
    <Tap href={href} accessibilityLabel={`${label}, ${value}${caption ? `, ${caption}` : ''}`}
      style={{ flex: 1, backgroundColor: c.panel, borderRadius: radius.tile, borderCurve: 'continuous', padding: space.m + 2, gap: space.s }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon sf={sf} md={md} size={14} color={alert ?? c.label2} />
        <Txt variant="sub" tone="label2" style={alert ? { color: alert } : undefined}>{label}</Txt>
        <View style={{ flex: 1 }} />
        <Icon sf="chevron.right" md="chevron_right" size={11} color={c.label3} weight="bold" />
      </View>
      <View>
        <Txt variant="title" num style={alert ? { color: alert } : undefined}>{value}</Txt>
        <Txt variant="foot" tone="label2" num numberOfLines={1}>{caption ?? ' '}</Txt>
      </View>
      <Sparkline values={spark ?? []} color={tone} min={sparkMin} max={sparkMax} span={sparkSpan} height={28} />
    </Tap>
  )
}
