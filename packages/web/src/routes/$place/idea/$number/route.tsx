// An idea's address: /mobile/idea/9, or /@riley/idea/3 for someone's own.
// Finds the idea there, for the pages below (its overview, files and
// changes), and draws the frame they share (IdeaFrame): its bar and tabs, the
// same on every page, with the site's navigation stepped aside. An idea that
// moved is still found at its old address, and the page goes on to its new
// one, whatever was after it in the address. Opening it marks it read in your
// inbox. ?sharing opens its Sharing dialog over whichever page is shown.
import { useEffect } from 'react'
import { ApiError } from '@ideaf/api'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, notFound, Outlet, redirect, useMatches, useNavigate } from '@tanstack/react-router'
import { api } from '../../../../api.ts'
import { IdeaFrame } from './-components/IdeaFrame.tsx'
import { ideaLinks } from './-components/links.ts'
import { commentsOf } from './-components/live.ts'
import {
  filesQuery,
  ideaQuery,
  ideaRefQuery,
  loadIdeaPage,
  reviewsQuery,
  subscriptionQuery,
} from './-components/queries.ts'

export const Route = createFileRoute('/$place/idea/$number')({
  // its own side columns: the site's navigation steps aside on every page of it
  staticData: { wide: true },
  validateSearch: (search: Record<string, unknown>): { sharing?: true } =>
    search['sharing'] === true || search['sharing'] === 'true' ? { sharing: true } : {},
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
  // what the frame shows, whichever page is below it
  loader: async ({ context: { queryClient, idea } }) => {
    await Promise.all([loadIdeaPage(queryClient, idea), commentsOf(idea, queryClient).preload()])
    const summary = await queryClient.query({ ...ideaQuery(idea), staleTime: 'static' })
    await Promise.all([
      queryClient.query({ ...filesQuery(idea, summary.latest), staleTime: 'static' }),
      queryClient.query({ ...reviewsQuery(idea), staleTime: 5_000 }),
      queryClient.prefetchQuery(subscriptionQuery(idea)),
    ])
  },
  component: Idea,
})

function Idea() {
  const { idea, place, number } = Route.useRouteContext()
  const { sharing } = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // which tab the page below is
  const current = useMatches({
    select: (matches) => {
      const ids = matches.map((m) => m.routeId as string)
      return ids.includes('/$place/idea/$number/')
        ? ('overview' as const)
        : ids.some((r) => r.startsWith('/$place/idea/$number/files') || r.startsWith('/$place/idea/$number/changes'))
          ? ('files' as const)
          : null
    },
  })
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
  return (
    <IdeaFrame
      id={idea}
      links={ideaLinks(place, number)}
      current={current}
      sharing={sharing === true}
      onSharing={(open) =>
        void navigate({
          to: '.',
          // the page's own search kept, with or without the dialog
          search: (prev) => {
            const { sharing: _, ...rest } = prev as Record<string, unknown>
            return (open ? { ...rest, sharing: true } : rest) as never
          },
          replace: true,
        })
      }
    >
      <Outlet />
    </IdeaFrame>
  )
}
