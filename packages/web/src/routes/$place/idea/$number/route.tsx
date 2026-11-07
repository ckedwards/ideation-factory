// An idea's address: /mobile/idea/9, or /@riley/idea/3 for someone's own.
// Finds the idea there, for the pages below (its overview, files and
// changes). An idea that moved is still found at its old address, and the
// page goes on to its new one, whatever was after it in the address.
import { ApiError } from '@ideaf/api'
import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
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
})
