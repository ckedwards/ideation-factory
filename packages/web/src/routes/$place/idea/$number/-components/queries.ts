// The idea page's fetched data: the idea, and a version's files and their
// outline (each unit's ID, in the order core parses them). A version never
// changes, so its files and outline are kept for good. The latest version's
// comments are live, in comments.ts; an older one's are read here.
import { queryOptions } from '@tanstack/react-query'
import { api } from '../../../../../api.ts'

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

/** The comments as of an older version, where they were then (the latest's are live, in comments.ts). */
export const commentsQuery = (idea: string, version: number) =>
  queryOptions({
    queryKey: ['idea', idea, 'comments', version],
    queryFn: () => api.listComments({ idea, version }),
  })
