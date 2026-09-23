// Where Hearth lives and the token it wants. The URL defaults to EXPO_PUBLIC_HEARTH_URL (.env.local, never committed)
// and the token is typed once on the Connect screen; both are kept in the keychain (SecureStore). The web preview is
// served next to the API by scripts/preview.mjs, which adds the credentials itself, so it's always "connected".
import * as SecureStore from 'expo-secure-store'
import { create } from 'zustand'

const WEB = process.env.EXPO_OS === 'web'
const DEFAULT = WEB ? '' : (process.env.EXPO_PUBLIC_HEARTH_URL ?? '').replace(/\/+$/, '')
const URL_KEY = 'hearth.url'
const TOKEN_KEY = 'hearth.token'

interface ServerState {
  url: string
  token: string
  ready: boolean
  connected: boolean
  save: (url: string, token: string) => Promise<void>
  disconnect: () => Promise<void>
}

export const clean = (url: string) => {
  let u = url.trim().replace(/\/+$/, '')
  if (u && !/^https?:\/\//.test(u)) u = `https://${u}`
  return u
}

export const useServer = create<ServerState>((set) => ({
  url: DEFAULT,
  token: '',
  ready: WEB,
  connected: WEB,
  save: async (url, token) => {
    const u = clean(url)
    await SecureStore.setItemAsync(URL_KEY, u)
    await SecureStore.setItemAsync(TOKEN_KEY, token.trim())
    set({ url: u, token: token.trim(), connected: true })
  },
  disconnect: async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {})
    set({ token: '', connected: false })
  },
}))

export const defaultServer = DEFAULT

/** Loads the saved address and token before the first request. */
export async function loadServer() {
  if (WEB) return
  const [url, token] = await Promise.all([
    SecureStore.getItemAsync(URL_KEY).catch(() => null),
    SecureStore.getItemAsync(TOKEN_KEY).catch(() => null),
  ])
  useServer.setState({ url: url || DEFAULT, token: token ?? '', connected: !!(token && (url || DEFAULT)), ready: true })
}
