import { useRef, useState } from 'react'
import { ScrollView, TextInput, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Group, Row } from '@/components/Row'
import { Button } from '@/components/Tap'
import { Txt } from '@/components/Txt'
import { api, type ListName } from '@/lib/api'
import { queryClient } from '@/lib/data'
import { toast } from '@/lib/toast'
import { font, radius, space, useTheme } from '@/theme'
import { LIST_TITLES, useLists } from '@/lib/lists'

/** Add to a Valheim list: pick someone who has played here before, or paste a SteamID64. */
export default function AddPlayer() {
  const { id, list } = useLocalSearchParams<{ id: string; list: ListName }>()
  const { c } = useTheme()
  const q = useLists(id)
  const typed = useRef('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const on = new Set((q.data?.lists[list] ?? []).map((p) => p.id))
  const known = (q.data?.known ?? []).filter((p) => !on.has(p.id))

  const add = async (sid: string, name?: string | null) => {
    setBusy(true)
    setError(null)
    try {
      queryClient.setQueryData(['lists', id], await api.listAdd(id, list, sid.trim()))
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      toast({ text: `Added ${name ?? 'player'} to ${LIST_TITLES[list].toLowerCase()}` })
      router.back()
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {})
      setError(e instanceof Error ? e.message : 'Couldn’t add')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: space.l, paddingTop: space.xl, gap: space.xxl }}>
      <Txt variant="title2" style={{ paddingHorizontal: space.xs }}>Add to {LIST_TITLES[list]?.toLowerCase()}</Txt>
      {known.length > 0 && (
        <Group header="Has played here">
          {known.map((p) => <Row key={p.id} label={p.name ?? 'Unknown'} sub={p.id} onPress={busy ? undefined : () => add(p.id, p.name)} chevron={false} />)}
        </Group>
      )}
      <View style={{ gap: space.s }}>
        <Txt variant="sub" tone="label2" style={{ paddingHorizontal: space.l }}>Someone new</Txt>
        <TextInput onChangeText={(t) => { typed.current = t }} placeholder="SteamID64 (17 digits)" placeholderTextColor={c.label3}
          keyboardType="number-pad" autoCorrect={false} returnKeyType="done" onSubmitEditing={() => add(typed.current)}
          style={[font.body, { color: c.label, backgroundColor: c.panel, borderRadius: radius.input, borderCurve: 'continuous', height: 50, paddingHorizontal: space.l }]} />
        <Txt variant="foot" tone={error ? 'neg' : 'label2'} style={{ paddingHorizontal: space.l }}>
          {error ?? 'Their Steam profile’s address has it, or steamid.io can look it up from a profile name.'}
        </Txt>
      </View>
      <Button label={busy ? 'Adding…' : 'Add'} onPress={() => add(typed.current)} disabled={busy} />
    </ScrollView>
  )
}
