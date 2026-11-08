// An idea's address: /mobile/idea/9, or /@riley/idea/3 for someone's own.
// Finds the idea there, for the pages below (its overview, files and
// changes). An idea that moved is still found at its old address, and the
// page goes on to its new one, whatever was after it in the address.
// Opening it marks it read in your inbox.
import { useEffect } from 'react'
import { ApiError } from '@ideaf/api'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, notFound, Outlet, redirect } from '@tanstack/react-router'
import { api } from '../../../../api.ts'
import { ideaRefQuery } from './-components/queries.ts'

export const Route = createFileRoute('/$place/idea/$number')({
  beforeLoad: async ({ context: { queryClient }, params, location }) => {
    const number = Number(params.number)
    if (!Number.isInteger(number) || number < 1) {
      throw notFound()
    }
    let found
    try {
      found = await queryClient.query({ ...ideaRefQuery(params.place, number), staleTime: 'static' })
    } catch (error) {
      // missing, or not yours to see: the API doesn't say which, and neither does the page
      if (error instanceof ApiError && error.code === 'not_found') {
        throw notFound()
      }
      throw error
    }
    if (found.place !== params.place || found.number !== number) {
      const rest = location.pathname.split('/').slice(4).join('/')
      throw redirect({
        href: `/${found.place}/idea/${found.number}${rest ? `/${rest}` : ''}${location.searchStr}`,
        replace: true,
      })
    }
    return { idea: found.id, place: found.place, number: found.number }
  },
  component: Idea,
})

function Idea() {
  const { idea } = Route.useRouteContext()
  const queryClient = useQueryClient()
  useEffect(() => {
    // seen: its news in your inbox is read now
    void api
      .markNotifications({ ideas: [idea], read: true })
      .then(({ changed }) => {
        if (changed > 0) {
          void queryClient.invalidateQueries({ queryKey: ['notifications'] })
        }
      })
      .catch(() => {})
  }, [idea, queryClient])
  return <Outlet />
}
