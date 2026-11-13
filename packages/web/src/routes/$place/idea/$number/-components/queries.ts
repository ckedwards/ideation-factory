// The idea page's fetched data: the idea, and a version's files and their
// outline (each unit's ID, in the order core parses them). A version never
// changes, so its files and outline are kept for good. The latest version's
// comments are live, in comments.ts; an older one's are read here.
import { type QueryClient, queryOptions } from '@tanstack/react-query'
import { api, teamQuery } from '../../../../../api.ts'

/** The idea at an address (mobile and 9), and where it is now, if it moved. */
export const ideaRefQuery = (place: string, number: number) =>
  queryOptions({
    queryKey: ['idea-at', place, number],
    queryFn: () => api.findIdea({ place, number }),
    staleTime: 5 * 60_000,
  })

export const ideaQuery = (idea: string) =>
  queryOptions({ queryKey: ['idea', idea], queryFn: () => api.getIdea({ idea }) })

export const filesQuery = (idea: string, version: number) =>
  queryOptions({
    queryKey: ['idea', idea, 'files', version],
    queryFn: () => api.pull({ idea, version }),
    staleTime: Infinity,
  })

export const outlineQuery = (idea: string, version: number) =>
  queryOptions({
    queryKey: ['idea', idea, 'outline', version],
    queryFn: async () => (await api.showBlocks({ idea, version })).files,
    staleTime: Infinity,
  })

/** The idea's status and its history, who's asked to review, and each reviewer's verdict: live (the socket's status and review events). */
export const reviewsQuery = (idea: string) =>
  queryOptions({ queryKey: ['idea', idea, 'reviews'], queryFn: () => api.listReviews({ idea }) })

/** Whether you hear about the idea in your inbox, and why. */
export const subscriptionQuery = (idea: string) =>
  queryOptions({ queryKey: ['idea', idea, 'subscription'], queryFn: () => api.getSubscription({ idea }) })

/** The comments as of an older version, where they were then (the latest's are live, in comments.ts). */
export const commentsQuery = (idea: string, version: number) =>
  queryOptions({
    queryKey: ['idea', idea, 'comments', version],
    queryFn: () => api.listComments({ idea, version }),
  })

/** The idea's draft, for people with edit access: changed by them and others, live (the socket's draft event). */
export const draftQuery = (idea: string) =>
  queryOptions({ queryKey: ['idea', idea, 'draft'], queryFn: () => api.getDraft({ idea }) })

/** Who has access to an idea, and what you can do with it. */
export const accessQuery = (idea: string) =>
  queryOptions({ queryKey: ['idea', idea, 'access'], queryFn: () => api.getAccess({ idea }) })

/**
 * Loads an idea's page in one read (open_idea) and fills the queries above
 * from it: the idea, its latest files and outline, its reviews, your
 * subscription and its team. One access check in the directory instead of one
 * per query. Nothing if the idea is loaded already: moving between its pages
 * reads only what changed.
 */
export async function loadIdeaPage(queryClient: QueryClient, idea: string): Promise<void> {
  if (queryClient.getQueryData(ideaQuery(idea).queryKey)) {
    return
  }
  const page = await api.openIdea({ idea })
  queryClient.setQueryData(ideaQuery(idea).queryKey, page.idea)
  queryClient.setQueryData(filesQuery(idea, page.files.version).queryKey, page.files)
  queryClient.setQueryData(outlineQuery(idea, page.outline.version).queryKey, page.outline.files)
  queryClient.setQueryData(reviewsQuery(idea).queryKey, page.reviews)
  queryClient.setQueryData(subscriptionQuery(idea).queryKey, page.subscription)
  if (page.team) {
    queryClient.setQueryData(teamQuery(page.team.id).queryKey, page.team)
  }
}
