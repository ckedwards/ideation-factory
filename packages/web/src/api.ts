// The typed client from @ideaf/api, the same one the cli uses, on this site's
// API with the session's token, and the queries several pages share.
import { ApiError, createApiClient } from '@ideaf/api'
import { queryOptions } from '@tanstack/react-query'
import { batched } from './batch.ts'
import { accessToken } from './session.ts'

export const api = createApiClient({ baseUrl: location.origin, token: accessToken })

export type Api = typeof api

/** The signed-in person. */
export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: () => api.me({}),
  staleTime: 5 * 60_000,
})

/** People by ID: those asked for at once are fetched in one request. */
const loadPerson = batched(
  async (ids) => (await api.getPeople({ ids })).items,
  (person) => person.id,
  { missing: (id) => new ApiError('not_found', `no one has the ID ${id}`, 404) },
)

/** A person, by ID: their name and handle change rarely. */
export const personQuery = (id: string) =>
  queryOptions({
    queryKey: ['person', id],
    queryFn: () => loadPerson(id),
    staleTime: 10 * 60_000,
  })

/** A team, by ID. */
export const teamQuery = (id: string) =>
  queryOptions({
    queryKey: ['team', id],
    queryFn: () => api.getTeam({ team: id }),
    staleTime: 5 * 60_000,
  })

/** The teams and groups you're in, with your role, and those you've asked to join. */
export const membershipsQuery = queryOptions({
  queryKey: ['me', 'memberships'],
  queryFn: () => api.myMemberships({}),
})

/** How many ideas in your inbox have news: the nav's badge. Read again every minute, and on coming back to the page. */
export const unreadQuery = queryOptions({
  queryKey: ['notifications', 'unread'],
  queryFn: async () => (await api.unreadNotifications({})).count,
  refetchInterval: 60_000,
})
