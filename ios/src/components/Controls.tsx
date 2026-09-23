import { ActivityIndicator, View } from 'react-native'
import type { Actions, Health, Verb } from '@/lib/api'
import { useUnitAction } from '@/lib/actions'
import { radius, space, useTheme } from '@/theme'
import { Icon } from './Icon'
import { Tap } from './Tap'
import { Txt } from './Txt'

const SF = { start: 'play.fill', stop: 'stop.fill', restart: 'arrow.clockwise' } as const
const MD = { start: 'play_arrow', stop: 'stop', restart: 'restart_alt' } as const
const LABEL = { start: 'Start', stop: 'Stop', restart: 'Restart' } as const

/** The buttons a unit allows (from the server config), as a row of equal pills. Running: Restart + Stop; stopped:
 *  Start. `none` shows a line saying why there are no buttons. */
export function Controls({ unit, name, actions, health, players = [] }: {
  unit: string; name: string; actions: Actions; health: Health; players?: string[]
}) {
  const { c } = useTheme()
  const { busy, run } = useUnitAction()
  if (actions === 'none') {
    return (
      <Txt variant="foot" tone="label2" style={{ paddingHorizontal: space.l }}>
        This one can’t be controlled from the app: restarting it could cut the app off from the server.
      </Txt>
    )
  }
  const up = health === 'ok' || health === 'starting'
  const verbs: Verb[] = actions === 'restart' ? ['restart'] : up ? ['restart', 'stop'] : ['start']
  return (
    <View style={{ flexDirection: 'row', gap: space.m }}>
      {verbs.map((v) => (
        <Tap key={v} disabled={!!busy} onPress={() => run(unit, name, v, players)} accessibilityLabel={`${LABEL[v]} ${name}`}
          style={{ flex: 1, height: 50, borderRadius: radius.pill, flexDirection: 'row', gap: space.s, alignItems: 'center',
            justifyContent: 'center', backgroundColor: v === 'start' ? c.ink : c.panel, opacity: busy && busy !== v ? 0.4 : 1 }}>
          {busy === v ? <ActivityIndicator color={v === 'start' ? c.onInk : c.label} />
            : <Icon sf={SF[v]} md={MD[v]} size={16} color={v === 'start' ? c.onInk : v === 'stop' ? c.neg : c.label} />}
          <Txt variant="headline" tone={v === 'start' ? 'onInk' : v === 'stop' ? 'neg' : 'label'}>
            {busy === v ? `${LABEL[v].replace(/p$/, 'pp')}ing…` : LABEL[v]}
          </Txt>
        </Tap>
      ))}
    </View>
  )
}
