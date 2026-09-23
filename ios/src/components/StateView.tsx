import { useEffect } from 'react'
import { router } from 'expo-router'
import { Pressable, View } from 'react-native'
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import type { UseQueryResult } from '@tanstack/react-query'
import { ApiError } from '@/lib/api'
import { ago } from '@/lib/format'
import { radius, space, useTheme } from '@/theme'
import { Icon } from './Icon'
import { Txt } from './Txt'

/** A block the shape of what's coming. Pulses gently unless Reduce Motion is on. */
export function Skel({ w, h, r = 8, style }: { w: number | `${number}%`; h: number; r?: number; style?: object }) {
  const { c } = useTheme()
  const reduce = useReducedMotion()
  const o = useSharedValue(1)
  useEffect(() => { if (!reduce) o.set(withRepeat(withTiming(0.55, { duration: 900 }), -1, true)) }, [o, reduce])
  const a = useAnimatedStyle(() => ({ opacity: o.get() }))
  return <Animated.View style={[{ width: w, height: h, borderRadius: r, backgroundColor: c.fill }, a, style]} />
}

function explain(e: unknown): { refused: boolean; title: string; body: string } {
  if (e instanceof ApiError && e.status === 401)
    return { refused: true, title: 'Token refused', body: 'Hearth didn’t accept the saved token. It may have been replaced with install.sh new-token. Enter the new one in Settings.' }
  if (e instanceof ApiError && e.status === 403)
    return { refused: true, title: 'Not your tailnet login', body: 'Hearth only answers the owner’s Tailscale login. Check which account Tailscale is signed in with on this phone.' }
  if (e instanceof ApiError && e.status < 500)
    return { refused: true, title: 'Hearth had a problem', body: e.message }
  return { refused: false, title: 'Can’t reach Hearth', body: 'It’s only reachable over Tailscale. Check that Tailscale is on, then try again.' }
}

/** First-load skeleton, or the full error state when there's nothing cached to show. */
export function StateView({ q, shape = 'overview' }: { q: UseQueryResult<unknown>; shape?: 'overview' | 'list' | 'detail' }) {
  const { c } = useTheme()
  if (q.isError) {
    const { refused, title, body } = explain(q.error)
    return (
      <View style={{ alignItems: 'center', paddingTop: 80, paddingHorizontal: space.xxl, gap: space.m }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' }}>
          <Icon sf={refused ? 'exclamationmark.triangle' : 'wifi.slash'} md={refused ? 'warning' : 'wifi_off'} size={24} color={c.label} />
        </View>
        <Txt variant="title2" style={{ textAlign: 'center' }}>{title}</Txt>
        <Txt variant="callout" tone="label2" style={{ textAlign: 'center' }}>{body}</Txt>
        <Pressable onPress={() => q.refetch()} style={({ pressed }) => ({ marginTop: space.s, height: 44, paddingHorizontal: space.xxl, borderRadius: radius.pill, backgroundColor: c.ink, justifyContent: 'center', transform: [{ scale: pressed ? 0.97 : 1 }] })}>
          <Txt variant="headline" tone="onInk">Try again</Txt>
        </Pressable>
        <Pressable onPress={() => router.push('/settings')} hitSlop={8} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: space.s })}>
          <Txt variant="callout" style={{ fontWeight: '600' }}>Settings</Txt>
        </Pressable>
      </View>
    )
  }
  if (shape === 'list') {
    return (
      <View style={{ gap: space.xxl }}>
        {[0, 1].map((g) => (
          <View key={g} style={{ gap: space.s }}>
            <Skel w={90} h={14} style={{ marginLeft: space.l }} />
            <View style={{ backgroundColor: c.panel, borderRadius: radius.panel, padding: space.l, gap: space.xl }}>
              {[0, 1, 2, 3].map((r) => (
                <View key={r} style={{ flexDirection: 'row', gap: space.m, alignItems: 'center' }}>
                  <Skel w={8} h={8} r={4} /><View style={{ flex: 1, gap: 6 }}><Skel w="45%" h={14} /><Skel w="60%" h={11} /></View>
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>
    )
  }
  if (shape === 'detail') {
    return (
      <View style={{ gap: space.xxl }}>
        <View style={{ gap: space.s }}><Skel w={140} h={36} r={10} /><Skel w={180} h={14} /></View>
        <View style={{ backgroundColor: c.panel, borderRadius: radius.panel, height: 200 }} />
        <View style={{ backgroundColor: c.panel, borderRadius: radius.panel, height: 160 }} />
      </View>
    )
  }
  const tile = <View style={{ flex: 1, height: 132, backgroundColor: c.panel, borderRadius: radius.tile, padding: space.m, gap: space.s }}><Skel w={60} h={12} /><Skel w={70} h={28} /><Skel w="100%" h={24} /></View>
  return (
    <View style={{ gap: space.m }}>
      <View style={{ gap: space.s, paddingHorizontal: space.xs, marginBottom: space.m }}><Skel w={160} h={34} r={10} /><Skel w={200} h={14} /></View>
      <View style={{ flexDirection: 'row', gap: space.m }}>{tile}{tile}</View>
      <View style={{ flexDirection: 'row', gap: space.m }}>{tile}{tile}</View>
      <View style={{ backgroundColor: c.panel, borderRadius: radius.panel, height: 160, marginTop: space.l }} />
    </View>
  )
}

/** Shown above cached data when the latest refresh failed: the data stays, with its age. */
export function StaleBanner({ q }: { q: UseQueryResult<unknown> }) {
  const { c } = useTheme()
  if (!q.isError || !q.data) return null
  const { title } = explain(q.error)
  return (
    <Pressable onPress={() => q.refetch()} accessibilityRole="button" accessibilityHint="Tries again"
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.s, backgroundColor: c.fill, borderRadius: radius.input, borderCurve: 'continuous', paddingHorizontal: space.m, paddingVertical: space.s + 2, marginBottom: space.l, opacity: pressed ? 0.6 : 1 })}>
      <Icon sf="wifi.slash" md="wifi_off" size={15} color={c.label2} />
      <Txt variant="sub" tone="label2" style={{ flex: 1 }}>{title}. Showing data from {ago(q.dataUpdatedAt / 1000)}.</Txt>
      <Txt variant="sub" style={{ fontWeight: '600' }}>Retry</Txt>
    </Pressable>
  )
}
