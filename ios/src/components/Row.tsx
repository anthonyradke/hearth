import type { ReactNode } from 'react'
import { View } from 'react-native'
import type { SFSymbol } from 'expo-symbols'
import type { Href } from 'expo-router'
import { radius, space, useTheme } from '@/theme'
import { Icon } from './Icon'
import { Hairline } from './Panel'
import { Tap } from './Tap'
import { Txt } from './Txt'

/** An inset grouped list, Settings-style: rows on one panel, hairlines inset to the text. */
export function Group({ children, header, footer }: { children: ReactNode; header?: string; footer?: string }) {
  const { c } = useTheme()
  const kids = (Array.isArray(children) ? children.flat() : [children]).filter(Boolean)
  return (
    <View style={{ gap: 6 }}>
      {header && <Txt variant="sub" tone="label2" style={{ paddingHorizontal: space.l }}>{header}</Txt>}
      <View style={{ backgroundColor: c.panel, borderRadius: radius.panel, borderCurve: 'continuous', overflow: 'hidden' }}>
        {kids.map((k, i) => <View key={i}>{i > 0 && <Hairline inset={space.l} />}{k}</View>)}
      </View>
      {footer && <Txt variant="foot" tone="label2" style={{ paddingHorizontal: space.l, lineHeight: 16 }}>{footer}</Txt>}
    </View>
  )
}

/** One row: optional leading mark or symbol, a label, a value on the right, and a chevron when it goes somewhere. */
export function Row({ label, value, leading, sf, md, onPress, href, chevron, destructive, trailing, sub }: {
  label: string; value?: ReactNode; leading?: ReactNode; sf?: SFSymbol; md?: string; onPress?: () => void; href?: Href
  chevron?: boolean; destructive?: boolean; trailing?: ReactNode; sub?: string
}) {
  const { c } = useTheme()
  const go = !!(onPress || href)
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 50, paddingHorizontal: space.l, paddingVertical: space.s }}>
      {leading ?? (sf ? <Icon sf={sf} md={md} size={18} color={destructive ? c.neg : c.label2} /> : null)}
      <View style={{ flex: 1, gap: 1 }}>
        <Txt variant="body" tone={destructive ? 'neg' : 'label'} numberOfLines={1}>{label}</Txt>
        {sub && <Txt variant="foot" tone="label2" numberOfLines={2}>{sub}</Txt>}
      </View>
      {typeof value === 'string' || typeof value === 'number'
        ? <Txt variant="body" tone="label2" numberOfLines={1} style={{ maxWidth: '55%', textAlign: 'right' }}>{value}</Txt>
        : value}
      {trailing}
      {(chevron ?? go) && !destructive && <Icon sf="chevron.right" md="chevron_right" size={13} color={c.label3} weight="bold" />}
    </View>
  )
  return go ? <Tap feedback="highlight" onPress={onPress} href={href}>{body}</Tap> : body
}
