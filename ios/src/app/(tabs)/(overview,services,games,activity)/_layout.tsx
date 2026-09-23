import { Stack } from 'expo-router'
import { useTheme } from '@/theme'

// One stack per tab. Detail screens (a metric, a service, a game, Network, Backups, Settings) are shared routes, so
// they push inside whichever tab you opened them from and back returns there.
export const unstable_settings = {
  anchor: 'index',
  services: { anchor: 'services' },
  games: { anchor: 'games' },
  activity: { anchor: 'activity' },
}

export default function TabStack() {
  const { c } = useTheme()
  return (
    <Stack screenOptions={{
      contentStyle: { backgroundColor: c.bg },
      headerLargeTitle: true,
      headerTransparent: process.env.EXPO_OS === 'ios',
      headerShadowVisible: false,
      headerLargeTitleShadowVisible: false,
      headerLargeStyle: { backgroundColor: 'transparent' },
      headerTintColor: c.ink,
      headerBackButtonDisplayMode: 'minimal',
    }}>
      <Stack.Screen name="index" options={{ title: 'Overview' }} />
      <Stack.Screen name="services" options={{ title: 'Services' }} />
      <Stack.Screen name="games" options={{ title: 'Games' }} />
      <Stack.Screen name="activity" options={{ title: 'Activity' }} />
      <Stack.Screen name="metric/[key]" options={{ headerLargeTitle: false, title: '' }} />
      <Stack.Screen name="service/[unit]" options={{ title: '' }} />
      <Stack.Screen name="game/[id]" options={{ title: '' }} />
      <Stack.Screen name="network" options={{ title: 'Network' }} />
      <Stack.Screen name="backups" options={{ title: 'Backups' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
    </Stack>
  )
}
