// Start / stop / restart with a native confirmation. Stopping or restarting something people are using says who,
// so nobody gets kicked by accident. Results come back as a toast; the lists refresh themselves.
import { useState } from 'react'
import { ActionSheetIOS, Alert } from 'react-native'
import * as Haptics from 'expo-haptics'
import { api, type Verb } from './api'
import { queryClient } from './data'
import { toast } from './toast'

const PAST: Record<Verb, string> = { start: 'started', stop: 'stopped', restart: 'restarted' }
const LABEL: Record<Verb, string> = { start: 'Start', stop: 'Stop', restart: 'Restart' }

export function confirm(title: string, message: string, action: string, destructive: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    if (process.env.EXPO_OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title, message, options: [action, 'Cancel'], destructiveButtonIndex: destructive ? 0 : undefined, cancelButtonIndex: 1 },
        (i) => resolve(i === 0))
    } else if (process.env.EXPO_OS === 'web') {
      resolve(window.confirm(`${title}\n\n${message}`))
    } else {
      Alert.alert(title, message, [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: action, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ])
    }
  })
}

function message(verb: Verb, name: string, players: string[]): string {
  const who = players.length === 0 ? '' : players.length === 1 ? `${players[0]} is on and will be disconnected. `
    : `${players.length} people are on (${players.join(', ')}) and will be disconnected. `
  if (verb === 'start') return `${name} will start. Game servers take a minute or two before anyone can join.`
  if (verb === 'stop') return `${who}${name} saves and shuts down. It stays off until you start it again.`
  return `${who}${name} saves, shuts down and starts again.`
}

export function useUnitAction() {
  const [busy, setBusy] = useState<Verb | null>(null)
  const run = async (unit: string, name: string, verb: Verb, players: string[] = []) => {
    if (players.length && verb !== 'start') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
    const ok = await confirm(`${LABEL[verb]} ${name}?`, message(verb, name, players), LABEL[verb], verb === 'stop' || players.length > 0)
    if (!ok) return
    setBusy(verb)
    try {
      await api.unitAction(unit, verb)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      toast({ text: `${name} ${PAST[verb]}` })
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {})
      toast({ text: e instanceof Error ? e.message : `Couldn’t ${verb} ${name}`, tone: 'error' })
    } finally {
      setBusy(null)
      for (const k of ['services', 'service', 'games', 'game', 'overview', 'audit', 'events']) {
        queryClient.invalidateQueries({ queryKey: [k] })
      }
    }
  }
  return { busy, run }
}
