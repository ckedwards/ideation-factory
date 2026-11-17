// The lists of ideas pages load: the ideas you can see (optionally searched,
// in one team, or one person's, and open or closed), 25 at a time with "Show
// more"; and the quick search's results.
import { type InfiniteData, infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import { api } from './api.ts'
import type { ListedIdea } from './ideas.ts'

type Page = { items: ListedIdea[]; next: string | null; incomplete?: boolean | undefined }

export type IdeaState = 'open' | 'closed'

/** What a list can be narrowed to: a search, a team, an author, who's asked to review, a status (by ID or handle). */
export type IdeaFilters = {
  /** Titles containing it: a word of at least 3 letters (searchable). */
  q?: string
  team?: string
  owner?: string
  reviewer?: string
  /** A group asked to review it. */
  reviewerGroup?: string
  status?: 'draft' | 'requesting-review'
}

/** How many ideas a list has, open and closed, for its tabs. */
export const countQuery = (filter: IdeaFilters = {}) =>
  queryOptions({
    queryKey: ['ideas', 'count', filter],
    queryFn: () => api.countIdeas(filter),
  })

export const ideasQuery = (filter: IdeaFilters & { state?: IdeaState } = {}) =>
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
