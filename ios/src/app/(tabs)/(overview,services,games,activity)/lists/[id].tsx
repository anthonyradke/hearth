import { RefreshControl, ScrollView, View } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Icon } from '@/components/Icon'
import { Group, Row } from '@/components/Row'
import { StaleBanner, StateView } from '@/components/StateView'
import { Tap } from '@/components/Tap'
import { api, type ListName } from '@/lib/api'
import { confirm } from '@/lib/actions'
import { queryClient, usePull } from '@/lib/data'
import { LIST_TITLES, useLists } from '@/lib/lists'
import { toast } from '@/lib/toast'
import { space, useTheme } from '@/theme'

const FOOTERS: Record<ListName, string> = {
  admin: 'Admins can use devcommands in the F5 console. If a new admin gets “not admin”, restart the server.',
  permitted: 'When this list has anyone on it, only these players can join. Leave it empty to let anyone with the password in.',
  banned: 'Banned players can’t join, even with the password.',
}

export default function Lists() {
  const { id, list } = useLocalSearchParams<{ id: string; list: ListName }>()
  const q = useLists(id)
  const pull = usePull(q)
  const { c } = useTheme()
  const players = q.data?.lists[list] ?? []

  const remove = async (sid: string, name: string | null) => {
    const who = name ?? 'this player'
    if (!(await confirm(`Remove ${who}?`, `${who} comes off ${LIST_TITLES[list].toLowerCase()}.`, 'Remove', true))) return
    try {
      queryClient.setQueryData(['lists', id], await api.listRemove(id, list, sid))
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      toast({ text: `Removed ${who}` })
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : 'Couldn’t remove', tone: 'error' })
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: LIST_TITLES[list] ?? '' }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: c.bg }}
        contentContainerStyle={{ padding: space.l, paddingBottom: 120 }} refreshControl={<RefreshControl {...pull} />}>
        <StaleBanner q={q} />
        {!q.data ? <StateView q={q} shape="list" /> : (
          <View style={{ gap: space.xxl }}>
            <Group footer={FOOTERS[list]}>
              {players.length === 0 && <Row label="Nobody" />}
              {players.map((p) => (
                <Row key={p.id} label={p.name ?? 'Unknown player'} sub={p.id}
                  trailing={
                    <Tap feedback="opacity" hitSlop={10} onPress={() => remove(p.id, p.name)} accessibilityLabel={`Remove ${p.name ?? p.id}`}>
                      <Icon sf="minus.circle.fill" md="remove_circle" size={22} color={c.neg} />
                    </Tap>
                  } />
              ))}
            </Group>
            <Group>
              <Row label="Add a player" sf="plus.circle.fill" md="add_circle" href={`/add-player/${id}?list=${list}` as never} />
            </Group>
          </View>
        )}
      </ScrollView>
    </>
  )
}
