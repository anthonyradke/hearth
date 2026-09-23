import { useQuery } from '@tanstack/react-query'
import { api, type ListName } from './api'

export const LIST_TITLES: Record<ListName, string> = { admin: 'Admins', permitted: 'Allowed players', banned: 'Banned' }

export const useLists = (id: string) => useQuery({ queryKey: ['lists', id], queryFn: () => api.lists(id) })
