import type { ReactNode } from 'react'
import { View, type StyleProp, type ViewStyle } from 'react-native'
import type { Href } from 'expo-router'
import { radius, space, useTheme } from '@/theme'
import { Icon } from './Icon'
import { Tap } from './Tap'
import { Txt } from './Txt'

/** A solid grouped surface. No border, no shadow: the background contrast does the separating. */
export function Panel({ children, style, pad = true }: { children: ReactNode; style?: StyleProp<ViewStyle>; pad?: boolean }) {
  const { c } = useTheme()
  return (
    <View style={[{ backgroundColor: c.panel, borderRadius: radius.panel, borderCurve: 'continuous', overflow: 'hidden' },
      pad && { padding: space.l }, style]}>
      {children}
    </View>
  )
}

/** Section title above a panel, with an optional "See all" link on the right. */
export function Section({ title, href, action = 'See all', children, style }: {
  title: string; href?: Href; action?: string; children: ReactNode; style?: StyleProp<ViewStyle>
}) {
  const { c } = useTheme()
  return (
    <View style={[{ gap: space.s + 2, marginBottom: space.section - 4 }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xs }}>
        <Txt variant="title2" accessibilityRole="header">{title}</Txt>
        {href && (
          <Tap href={href} feedback="opacity" hitSlop={12} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <Txt variant="callout" tone="label2">{action}</Txt>
            <Icon sf="chevron.right" md="chevron_right" size={12} color={c.label2} />
          </Tap>
        )}
      </View>
      {children}
    </View>
  )
}

/** Hairline between rows, inset to the text column. */
export function Hairline({ inset = 0 }: { inset?: number }) {
  const { c } = useTheme()
  return <View style={{ height: 0.5, backgroundColor: c.sep, marginLeft: inset }} />
}
