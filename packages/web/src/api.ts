// The typed client from @ideaf/api, the same one the cli uses, on this site's
// API with the session's token, and the queries several pages share.
import { createApiClient } from '@ideaf/api'
import { queryOptions } from '@tanstack/react-query'
import { accessToken } from './session.ts'

export const api = createApiClient({ baseUrl: location.origin, token: accessToken })

export type Api = typeof api

/** The signed-in person. */
export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: () => api.me({}),
  staleTime: 5 * 60_000,
})

/** A person, by ID: their name and handle change rarely. */
export const personQuery = (id: string) =>
  queryOptions({
    queryKey: ['person', id],
    queryFn: () => api.getUser({ user: id }),
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
