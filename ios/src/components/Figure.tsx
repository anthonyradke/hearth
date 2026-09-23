import type { ReactNode } from 'react'
import { StyleSheet, TextInput, View, type TextStyle } from 'react-native'
import Animated, { useAnimatedProps, useAnimatedStyle, type SharedValue } from 'react-native-reanimated'
import { tabular, useTheme } from '@/theme'

const AText = Animated.createAnimatedComponent(TextInput)

/** The big number over a chart. At rest it shows `value`; while the chart is scrubbed it shows `texts[i]` and the
 *  point's time from `labels[i]`, written on the UI thread so it keeps up with the finger. */
export function Figure({ value, texts, labels, scrub, style, caption }: {
  value: string; texts: string[]; labels: string[]; scrub: SharedValue<number>; style: TextStyle; caption?: ReactNode
}) {
  const { c } = useTheme()
  const rest = useAnimatedStyle(() => ({ opacity: scrub.get() < 0 ? 1 : 0 }))
  const live = useAnimatedStyle(() => ({ opacity: scrub.get() < 0 ? 0 : 1 }))
  const fig = useAnimatedProps(() => {
    const i = scrub.get()
    const text = i >= 0 && i < texts.length ? texts[i] : value
    return { text, defaultValue: text } as never
  })
  const cap = useAnimatedProps(() => {
    const i = scrub.get()
    const text = i >= 0 && i < labels.length ? labels[i] : ''
    return { text, defaultValue: text } as never
  })
  const h = Math.round((style.fontSize ?? 17) * 1.2)
  return (
    <View>
      <View>
        <Animated.Text style={[style, tabular, { color: c.label }, rest]}>{value}</Animated.Text>
        <Animated.View style={[StyleSheet.absoluteFill, live]} pointerEvents="none">
          <AText editable={false} underlineColorAndroid="transparent" animatedProps={fig}
            style={[style, tabular, { padding: 0, margin: 0, height: h, lineHeight: h, color: c.label }]} />
        </Animated.View>
      </View>
      <View style={{ minHeight: 20, justifyContent: 'center' }}>
        <Animated.View style={rest}>{caption}</Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, { justifyContent: 'center' }, live]} pointerEvents="none">
          <AText editable={false} animatedProps={cap}
            style={{ padding: 0, margin: 0, fontSize: 15, fontWeight: '500', letterSpacing: -0.2, color: c.label2 }} />
        </Animated.View>
      </View>
    </View>
  )
}
