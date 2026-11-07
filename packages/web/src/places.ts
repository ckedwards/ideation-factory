// Teams and people by handle, as their pages (/mobile, /@riley) load them.
import { queryOptions } from '@tanstack/react-query'
import { api } from './api.ts'

export const teamByHandleQuery = (team: string) =>
  queryOptions({ queryKey: ['team', team], queryFn: () => api.getTeam({ team }) })

export const personByHandleQuery = (user: string) =>
  queryOptions({ queryKey: ['person', user], queryFn: () => api.getUser({ user }), staleTime: 10 * 60_000 })

export const groupByHandleQuery = (group: string) =>
  queryOptions({ queryKey: ['group', group], queryFn: () => api.getGroup({ group }) })
