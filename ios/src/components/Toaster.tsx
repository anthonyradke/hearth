// Result toasts ("Valheim restarted"): a glass capsule floating above the tab bar. Glass is for floating chrome only.
import { Pressable, View } from 'react-native'
import Animated, { Easing, FadeOut, SlideInDown } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect'
import * as Haptics from 'expo-haptics'
import { useToast } from '@/lib/toast'
import { radius, space, useTheme } from '@/theme'
import { Txt } from './Txt'

const glass = isLiquidGlassAvailable()

export function Toaster() {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const { toast: t, hide } = useToast()
  if (!t) return null
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, paddingLeft: space.xl, paddingRight: t.action ? space.s : space.xl, paddingVertical: space.s, minHeight: 48 }}>
      <Txt variant="callout" tone={t.tone === 'error' ? 'neg' : 'label'} numberOfLines={2} style={{ flex: 1, fontWeight: '500' }}>{t.text}</Txt>
      {t.action && (
        <Pressable
          onPress={async () => { hide(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); await t.action!.run() }}
          hitSlop={8}
          style={({ pressed }) => ({ paddingHorizontal: space.l, height: 34, borderRadius: radius.pill, justifyContent: 'center', backgroundColor: c.ink, opacity: pressed ? 0.7 : 1 })}>
          <Txt variant="sub" tone="onInk" style={{ fontWeight: '600', fontSize: 15 }}>{t.action.label}</Txt>
        </Pressable>
      )}
    </View>
  )
  return (
    <Animated.View key={t.id} entering={SlideInDown.duration(260).easing(Easing.bezier(0.23, 1, 0.32, 1))} exiting={FadeOut.duration(160)}
      pointerEvents="box-none" accessibilityLiveRegion="polite"
      style={{ position: 'absolute', left: space.l, right: space.l, bottom: insets.bottom + 62 }}>
      {glass ? (
        <GlassView glassEffectStyle="regular" isInteractive style={{ borderRadius: radius.pill }}>{body}</GlassView>
      ) : (
        <View style={{ borderRadius: radius.pill, backgroundColor: c.panelRaised, boxShadow: '0 6px 24px rgba(0,0,0,0.18)' }}>{body}</View>
      )}
    </Animated.View>
  )
}
