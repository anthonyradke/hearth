import { RefreshControl, ScrollView, View } from 'react-native'
import { Dot } from '@/components/Dot'
import { Icon } from '@/components/Icon'
import { StaleBanner, StateView } from '@/components/StateView'
import { Tap } from '@/components/Tap'
import { Txt } from '@/components/Txt'
import type { Game } from '@/lib/api'
import { useGames, usePull } from '@/lib/data'
import { span } from '@/lib/format'
import { gameLabel, healthColor } from '@/lib/status'
import { radius, space, useTheme } from '@/theme'

export default function Games() {
  const q = useGames()
  const pull = usePull(q)
  const { c } = useTheme()
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: c.bg }}
      contentContainerStyle={{ padding: space.l, paddingBottom: 120, gap: space.m }} refreshControl={<RefreshControl {...pull} />}>
      <StaleBanner q={q} />
      {q.data ? q.data.games.map((g) => <GameCard key={g.id} g={g} />) : <StateView q={q} shape="list" />}
    </ScrollView>
  )
}

function GameCard({ g }: { g: Game }) {
  const { c } = useTheme()
  const n = g.players.length
  return (
    <Tap href={`/game/${g.id}` as never} accessibilityLabel={`${g.name}, ${g.running ? `${n} online` : 'stopped'}`}
      style={{ backgroundColor: c.panel, borderRadius: radius.panel, borderCurve: 'continuous', padding: space.l, gap: space.m }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
        <View style={{ width: 40, height: 40, borderRadius: 12, borderCurve: 'continuous', backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' }}>
          <Icon sf={g.kind === 'minecraft' ? 'cube' : 'shield.lefthalf.filled'} md={g.kind === 'minecraft' ? 'deployed_code' : 'shield'} size={20} color={c.label} />
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <Txt variant="headline">{g.name}</Txt>
          <Txt variant="foot" tone="label2" numberOfLines={1}>{gameLabel(g)}</Txt>
        </View>
        <Icon sf="chevron.right" md="chevron_right" size={13} color={c.label3} weight="bold" />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <View>
          <Txt variant="title" num>{g.running ? String(n) : '–'}</Txt>
          <Txt variant="sub" tone="label2">
            {!g.running ? 'Stopped' : n === 0 ? 'Nobody’s on' : n === 1 ? 'player online' : 'players online'}
          </Txt>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Dot color={healthColor(g.health, c)} />
          <Txt variant="sub" tone="label2" num>
            {g.running ? (g.since ? `Up ${span(Date.now() / 1000 - g.since)}` : 'Running') : g.health === 'stopped' ? 'Off' : 'Down'}
          </Txt>
        </View>
      </View>
      {g.running && n > 0 && (
        <Txt variant="callout" numberOfLines={2}>{g.players.map((p) => p.name).join(', ')}</Txt>
      )}
      {g.error && g.running && <Txt variant="foot" tone="warn">{g.error}</Txt>}
    </Tap>
  )
}
