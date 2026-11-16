// The lists of ideas pages load: the ideas you can see (optionally in one
// team, or one person's, and open or closed), 25 at a time with "Show more",
// or a search.
import { type InfiniteData, infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import { api } from './api.ts'
import type { ListedIdea } from './ideas.ts'

type Page = { items: ListedIdea[]; next: string | null }

export type IdeaState = 'open' | 'closed'

/** Open or closed, for a list's filter. */
export const STATES = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
] satisfies Array<{ value: IdeaState; label: string }>

export const ideasQuery = (
  filter: { team?: string; owner?: string; reviewer?: string; status?: 'requesting-review'; state?: IdeaState } = {},
) =>
  infiniteQueryOptions<Page, Error, InfiniteData<Page>, readonly unknown[], string | null>({
    queryKey: ['ideas', filter],
    queryFn: ({ pageParam }) => api.listIdeas({ ...filter, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: null,
    getNextPageParam: (page) => page.next,
  })

/** A search needs a word of at least 3 letters; shorter, it isn't run. */
export const searchable = (q: string) =>
  q
    .trim()
    .split(/\s+/)
    .some((word) => [...word].length >= 3)

export const searchQuery = (q: string) =>
  queryOptions({
    queryKey: ['ideas', 'search', q.trim()],
    queryFn: () => api.searchIdeas({ q: q.trim() }),
    enabled: searchable(q),
  })
