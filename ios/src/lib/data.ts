import { useCallback, useState } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import { focusManager, QueryClient, useQuery } from '@tanstack/react-query'
import { api, type Range } from './api'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, gcTime: 1000 * 60 * 60 * 24 * 7, retry: 1 },
  },
})

// Polling only happens while the app is in front: TanStack pauses intervals when "unfocused".
if (process.env.EXPO_OS !== 'web') {
  AppState.addEventListener('change', (s: AppStateStatus) => focusManager.setFocused(s === 'active'))
}

const LIVE = 15_000

export const useOverview = () => useQuery({ queryKey: ['overview'], queryFn: api.overview, refetchInterval: LIVE })
export const useSystem = () => useQuery({ queryKey: ['system'], queryFn: api.system, refetchInterval: LIVE })
export const useServices = () => useQuery({ queryKey: ['services'], queryFn: api.services, refetchInterval: LIVE })
export const useService = (unit: string) =>
  useQuery({ queryKey: ['service', unit], queryFn: () => api.service(unit), refetchInterval: LIVE })
export const useGames = () => useQuery({ queryKey: ['games'], queryFn: api.games, refetchInterval: LIVE })
export const useGame = (id: string) => useQuery({ queryKey: ['game', id], queryFn: () => api.game(id), refetchInterval: LIVE })
export const useNetwork = () => useQuery({ queryKey: ['network'], queryFn: api.network, refetchInterval: 30_000 })
export const useBackups = () => useQuery({ queryKey: ['backups'], queryFn: api.backups, refetchInterval: 60_000 })
export const useEvents = () => useQuery({ queryKey: ['events'], queryFn: () => api.events(), refetchInterval: 30_000 })
export const useAudit = () => useQuery({ queryKey: ['audit'], queryFn: api.audit, refetchInterval: 30_000 })

/** Short ranges refresh with the samples (30 s); long ones barely change. */
export const useHistory = (key: string, range: Range, enabled = true) =>
  useQuery({
    queryKey: ['history', key, range], queryFn: () => api.history(key, range), enabled,
    refetchInterval: range === '1h' ? 30_000 : range === '6h' || range === '24h' ? 120_000 : false,
    placeholderData: (prev) => (prev?.key === key ? prev : undefined),
  })

/** Pull to refresh that only spins for the pull, not for the background polling. */
export function usePull(...qs: { refetch: () => Promise<unknown> }[]) {
  const [refreshing, set] = useState(false)
  const onRefresh = useCallback(() => {
    set(true)
    Promise.allSettled(qs.map((q) => q.refetch())).finally(() => set(false))
  }, [qs])
  return { refreshing, onRefresh }
}
