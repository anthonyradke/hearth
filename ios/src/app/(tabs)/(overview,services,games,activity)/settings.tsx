import { ActionSheetIOS, Alert, ScrollView, View } from 'react-native'
import Constants from 'expo-constants'
import { Group, Row } from '@/components/Row'
import { Txt } from '@/components/Txt'
import { queryClient, useOverview } from '@/lib/data'
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
        <Group header="Alerts" footer="Push alerts come through the free ntfy app, set up on the server. A free Apple ID can’t send its own notifications.">
          <Row label="Delivered by" value="ntfy" />
        </Group>
        <Txt variant="foot" tone="label3" style={{ textAlign: 'center' }}>
          Hearth {Constants.expoConfig?.version ?? ''}
        </Txt>
      </View>
    </ScrollView>
  )
}
