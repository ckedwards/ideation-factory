// The typed client from @ideaf/api, the same one the cli uses, on this site's
// API with the session's token, and the queries the pages share.
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
