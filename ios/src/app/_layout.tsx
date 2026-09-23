import { useEffect } from 'react'
import { useColorScheme } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { queryClient } from '@/lib/data'
import { loadServer, useServer } from '@/lib/server'
import { useTheme } from '@/theme'

SplashScreen.preventAutoHideAsync().catch(() => {})

// The last good answers are kept on the phone, so a cold start draws the last known state at once (and offline).
const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: 'hearth.cache', throttleTime: 1500 })

function RootStack() {
  const { c } = useTheme()
  const connected = useServer((s) => s.connected)
  // Connecting is a one-way door: the tabs don't exist until a server and token are saved, and Connect doesn't exist
  // after. Disconnecting in Settings flips it back.
  return (
    <Stack screenOptions={{ contentStyle: { backgroundColor: c.bg }, headerShown: false }}>
      <Stack.Protected guard={connected}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Protected guard={!connected}>
        <Stack.Screen name="connect" />
      </Stack.Protected>
    </Stack>
  )
}

export default function RootLayout() {
  const scheme = useColorScheme()
  const ready = useServer((s) => s.ready)
  useEffect(() => { loadServer().finally(() => SplashScreen.hideAsync().catch(() => {})) }, [])
  if (!ready) return null
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PersistQueryClientProvider client={queryClient}
        persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 24 * 7, buster: 'v1' }}>
        <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
          <RootStack />
        </ThemeProvider>
      </PersistQueryClientProvider>
    </GestureHandlerRootView>
  )
}
