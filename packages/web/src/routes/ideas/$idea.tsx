// An idea by its ID (/ideas/i1b2…), as the API and the cli name it: on to its
// address (/mobile/idea/9).
import { ApiError } from '@ideaf/api'
import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { ideaLinks } from '../$place/idea/$number/-components/links.ts'
import { ideaQuery } from '../$place/idea/$number/-components/queries.ts'

export const Route = createFileRoute('/ideas/$idea')({
  beforeLoad: async ({ context: { queryClient }, params }) => {
    try {
      const idea = await queryClient.ensureQueryData(ideaQuery(params.idea))
      throw redirect({ href: ideaLinks(idea.place, idea.number).overview, replace: true })
    } catch (error) {
      if (error instanceof ApiError && error.code === 'not_found') {
        throw notFound()
      }
      throw error
    }
  },
})
