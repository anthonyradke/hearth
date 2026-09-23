import { useRef, useState } from 'react'
import { KeyboardAvoidingView, ScrollView, TextInput, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { create } from 'zustand'
import { Icon } from '@/components/Icon'
import { Tap } from '@/components/Tap'
import { Txt } from '@/components/Txt'
import { api } from '@/lib/api'
import { queryClient, useGame } from '@/lib/data'
import { font, mono, radius, space, useTheme } from '@/theme'

interface Entry { command: string; output: string; error?: boolean }
// History lives for the app session, per server, so closing and reopening the sheet keeps it.
const useHistory = create<{ h: Record<string, Entry[]>; add: (id: string, e: Entry) => void }>((set) => ({
  h: {},
  add: (id, e) => set((s) => ({ h: { ...s.h, [id]: [...(s.h[id] ?? []), e].slice(-100) } })),
}))

const QUICK: [string, string][] = [
  ['Who’s on', 'list'], ['Save', 'save-all'], ['Whitelist', 'whitelist list'], ['Day', 'time set day'],
  ['Clear weather', 'weather clear'], ['Whitelist add…', 'whitelist add '], ['Op…', 'op '],
]

const EMPTY: Entry[] = []
const clean = (s: string) => s.replace(/§./g, '')

/** The Minecraft server console over RCON, as a sheet: commands and replies, newest at the bottom. */
export default function Console() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { c } = useTheme()
  const game = useGame(id).data
  const history = useHistory((s) => s.h[id] ?? EMPTY)
  const add = useHistory((s) => s.add)
  const input = useRef<TextInput>(null)
  const text = useRef('')
  const scroll = useRef<ScrollView>(null)
  const [busy, setBusy] = useState(false)

  const send = async (command: string) => {
    const cmd = command.trim().replace(/^\//, '')
    if (!cmd || busy) return
    setBusy(true)
    input.current?.clear()
    text.current = ''
    try {
      const r = await api.rcon(id, cmd)
      add(id, { command: cmd, output: clean(r.output) || 'Done.' })
      Haptics.selectionAsync().catch(() => {})
    } catch (e) {
      add(id, { command: cmd, output: e instanceof Error ? e.message : 'Failed', error: true })
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {})
    } finally {
      setBusy(false)
      queryClient.invalidateQueries({ queryKey: ['audit'] })
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50)
    }
  }

  const quick = (cmd: string) => {
    if (cmd.endsWith(' ')) {  // needs a name: put it in the field and let them finish it
      input.current?.setNativeProps({ text: cmd })
      text.current = cmd
      input.current?.focus()
    } else send(cmd)
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.bg }} keyboardVerticalOffset={0}>
      <View style={{ paddingHorizontal: space.l, paddingTop: space.xl, paddingBottom: space.s }}>
        <Txt variant="title2">{game?.name ?? 'Server'} console</Txt>
        <Txt variant="sub" tone="label2">{game?.running === false ? 'The server is stopped.' : 'Commands run as the server. Every one is logged in Activity.'}</Txt>
      </View>
      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ padding: space.l, gap: space.m }}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })} keyboardDismissMode="interactive">
        {history.length === 0 && (
          <Txt variant="callout" tone="label2">Try “list” to see who’s on, or “whitelist add Name” to let a friend in.</Txt>
        )}
        {history.map((e, i) => (
          <View key={i} style={{ gap: 4 }}>
            <Txt selectable style={[mono, { color: c.label2 }]}>› {e.command}</Txt>
            <Txt selectable style={[mono, { color: e.error ? c.neg : c.label }]}>{e.output}</Txt>
          </View>
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
        style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: space.l, gap: space.s, paddingBottom: space.s }}>
        {QUICK.map(([label, cmd]) => (
          <Tap key={cmd} onPress={() => quick(cmd)} disabled={busy}
            style={{ height: 34, paddingHorizontal: space.m + 2, borderRadius: radius.pill, backgroundColor: c.fill, justifyContent: 'center' }}>
            <Txt variant="sub">{label}</Txt>
          </Tap>
        ))}
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: space.s, paddingHorizontal: space.l, paddingBottom: space.xxl, paddingTop: space.xs }}>
        <TextInput ref={input} onChangeText={(t) => { text.current = t }} placeholder="Command"
          placeholderTextColor={c.label3} autoCapitalize="none" autoCorrect={false} returnKeyType="send"
          onSubmitEditing={() => send(text.current)} submitBehavior="submit"
          style={[font.body, mono, { fontSize: 16, flex: 1, height: 44, color: c.label, backgroundColor: c.panel, borderRadius: radius.pill, paddingHorizontal: space.l }]} />
        <Tap onPress={() => send(text.current)} disabled={busy} accessibilityLabel="Send"
          style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.4 : 1 }}>
          <Icon sf="arrow.up" md="arrow_upward" size={18} color={c.onInk} weight="bold" />
        </Tap>
      </View>
    </KeyboardAvoidingView>
  )
}
