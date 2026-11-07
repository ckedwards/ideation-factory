// The idea page's fetched data: the idea, and a version's files and their
// outline (each unit's ID, in the order core parses them). A version never
// changes, so its files and outline are kept for good. Comments are live, in
// comments.ts.
import { queryOptions } from '@tanstack/react-query'
import { api } from '../../../api.ts'

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
