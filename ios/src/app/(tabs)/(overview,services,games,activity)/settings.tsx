import { useState } from 'react'
import { ActionSheetIOS, Alert, ScrollView, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import Constants from 'expo-constants'
import { Group, Row } from '@/components/Row'
import { Txt } from '@/components/Txt'
import { api } from '@/lib/api'
import { queryClient, useAlerts, useOverview } from '@/lib/data'
import { ago } from '@/lib/format'
import { useServer } from '@/lib/server'
import { space, useTheme } from '@/theme'

export default function Settings() {
  const { c } = useTheme()
  const url = useServer((s) => s.url)
  const disconnect = useServer((s) => s.disconnect)
  const host = useOverview().data?.host

  const confirm = () => {
    const go = () => { queryClient.clear(); disconnect() }
    const message = 'The token is removed from this phone. You’ll need it again to reconnect.'
    if (process.env.EXPO_OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: 'Disconnect from Hearth?', message, options: ['Disconnect', 'Cancel'], destructiveButtonIndex: 0, cancelButtonIndex: 1 },
        (i) => { if (i === 0) go() })
    } else {
      Alert.alert('Disconnect from Hearth?', message, [{ text: 'Cancel', style: 'cancel' }, { text: 'Disconnect', style: 'destructive', onPress: go }])
    }
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: c.bg }}
      contentContainerStyle={{ padding: space.l, paddingBottom: 120 }}>
      <View style={{ gap: space.section - 4 }}>
        <Group header="Server" footer="Hearth is only reachable over Tailscale, and only answers your own Tailscale login.">
          <Row label="Address" sub={url || 'Same origin (web preview)'} />
          {host && <Row label="Host" value={host.hostname} sub={`${host.os} · kernel ${host.kernel}`} />}
          {process.env.EXPO_OS !== 'web' && <Row label="Disconnect" destructive onPress={confirm} />}
        </Group>
        <AlertsGroup />
        <Txt variant="foot" tone="label3" style={{ textAlign: 'center' }}>
          Hearth {Constants.expoConfig?.version ?? ''}
        </Txt>
      </View>
    </ScrollView>
  )
}

/** "23:00-08:00" → "11 PM to 8 AM" */
function hours(q: string): string {
  const f = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    const d = new Date(2000, 0, 1, h, m)
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: m ? '2-digit' : undefined })
  }
  const [a, b] = q.split('-')
  return `${f(a)} to ${f(b)}`
}

function AlertsGroup() {
  const q = useAlerts()
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | string>('idle')
  const [copied, setCopied] = useState(false)
  const d = q.data
  const send = async () => {
    setState('sending')
    try {
      await api.testAlert()
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      setState('sent')
      queryClient.invalidateQueries({ queryKey: ['audit'] })
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {})
      setState(e instanceof Error ? e.message : 'Failed')
    }
  }
  const copy = () => {
    if (!d?.ntfy) return
    Clipboard.setStringAsync(d.ntfy.topic).catch(() => {})
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <Group header="Alerts" footer={d?.ntfy
      ? 'In the ntfy app, tap + and subscribe to this topic (server ntfy.sh). Anyone who knows the topic can read the alerts, so they never include names or addresses.'
      : 'Alerts go through the free ntfy app. Add a topic under [alerts] in the server’s config to turn them on.'}>
      {d?.ntfy ? (
        <Row label="ntfy topic" onPress={copy} chevron={false}
          sub={copied ? 'Copied' : d.ntfy.topic} />
      ) : <Row label="ntfy" value="Not set up" />}
      {d?.ntfy && (
        <Row label={state === 'sending' ? 'Sending…' : state === 'sent' ? 'Sent. Check your phone.' : 'Send a test notification'}
          onPress={state === 'sending' ? undefined : send} chevron={false}
          sub={state !== 'idle' && state !== 'sending' && state !== 'sent' ? state : undefined} />
      )}
      {d?.quiet_hours && <Row label="Quiet hours" value={hours(d.quiet_hours)} sub="Warnings wait until morning. Critical alerts always come through." />}
      <Row label="Server-down check" value={d?.heartbeat ? (d.heartbeat.ok ? `Pinged ${ago(d.heartbeat.ts)}` : 'Ping failing') : 'Not set up'}
        sub="healthchecks.io emails you if the server stops checking in." />
    </Group>
  )
}
