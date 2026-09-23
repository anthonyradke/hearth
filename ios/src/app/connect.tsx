import { useRef, useState } from 'react'
import { KeyboardAvoidingView, ScrollView, TextInput, View } from 'react-native'
import * as Haptics from 'expo-haptics'
import { Icon } from '@/components/Icon'
import { Button } from '@/components/Tap'
import { Txt } from '@/components/Txt'
import { ApiError, call, unreachable, type Overview } from '@/lib/api'
import { queryClient } from '@/lib/data'
import { clean, defaultServer, useServer } from '@/lib/server'
import { font, radius, space, useTheme } from '@/theme'

/** The one screen before the tabs exist. Checks the address and token against the server before saving them. */
export default function Connect() {
  const { c } = useTheme()
  const save = useServer((s) => s.save)
  const [url, setUrl] = useState(useServer.getState().url || defaultServer)
  const token = useRef('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function connect() {
    const u = clean(url)
    if (!u || !token.current.trim()) { setError('Enter the address and the token.'); return }
    setBusy(true)
    setError(null)
    try {
      const o = await call<Overview>('GET', '/overview', undefined, 12_000, { url: u, token: token.current.trim() })
      queryClient.clear()
      queryClient.setQueryData(['overview'], o)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      await save(u, token.current)
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {})
      setError(e instanceof ApiError && e.status === 401 ? 'That token isn’t right. Copy it again from the server.'
        : e instanceof ApiError && e.status === 403 ? 'Hearth only answers its owner’s Tailscale login. Check the account Tailscale uses on this phone.'
        : unreachable(e) ? 'Couldn’t reach that address. Check it, and that Tailscale is on.'
        : e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const field = { ...font.body, color: c.label, backgroundColor: c.panel, borderRadius: radius.input, borderCurve: 'continuous' as const, paddingHorizontal: space.l, height: 50 }
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: space.xxl, gap: space.xxl }}>
        <View style={{ alignItems: 'center', gap: space.m }}>
          <View style={{ width: 72, height: 72, borderRadius: 18, borderCurve: 'continuous', backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}>
            <Icon sf="flame.fill" md="local_fire_department" size={34} color={c.onInk} />
          </View>
          <Txt variant="title" style={{ textAlign: 'center' }}>Connect to Hearth</Txt>
          <Txt variant="callout" tone="label2" style={{ textAlign: 'center' }}>
            Hearth runs on your server and is only reachable over Tailscale. The token is in /etc/hearth/token.
          </Txt>
        </View>
        <View style={{ gap: space.m }}>
          <View style={{ gap: 6 }}>
            <Txt variant="sub" tone="label2" style={{ paddingHorizontal: space.l }}>Address</Txt>
            <TextInput value={url} onChangeText={setUrl} placeholder="https://server.tailnet.ts.net:8446"
              placeholderTextColor={c.label3} autoCapitalize="none" autoCorrect={false} keyboardType="url"
              textContentType="URL" returnKeyType="next" style={field} />
          </View>
          <View style={{ gap: 6 }}>
            <Txt variant="sub" tone="label2" style={{ paddingHorizontal: space.l }}>Token</Txt>
            <TextInput onChangeText={(t) => { token.current = t }} placeholder="Paste the token"
              placeholderTextColor={c.label3} autoCapitalize="none" autoCorrect={false} secureTextEntry
              textContentType="password" returnKeyType="go" onSubmitEditing={connect} style={field} />
          </View>
          {error && (
            <View style={{ flexDirection: 'row', gap: space.s, paddingHorizontal: space.l, alignItems: 'flex-start' }}>
              <Icon sf="exclamationmark.circle.fill" md="error" size={15} color={c.neg} style={{ marginTop: 2 }} />
              <Txt variant="sub" tone="neg" style={{ flex: 1 }}>{error}</Txt>
            </View>
          )}
        </View>
        <Button label={busy ? 'Connecting…' : 'Connect'} onPress={connect} disabled={busy} />
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
