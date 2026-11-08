// Every idea you can see, open ones by default (?state=closed for the
// closed), newest change first, 25 at a time; or a search of their titles
// (?q=), closest first.
import { useState } from 'react'
import { Page, PageHeader, SearchInput, SegmentedControl, Stack } from '@ideaf/ui'
import { useInfiniteQuery, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { meQuery } from '../../api.ts'
import { IdeaList } from '../../components/IdeaList.tsx'
import { ideaInfo } from '../../ideas.ts'
import { type IdeaState, ideasQuery, STATES, searchable, searchQuery } from '../../lists.ts'

export const Route = createFileRoute('/ideas/')({
  validateSearch: (search: Record<string, unknown>): { q?: string; state?: 'closed' } => ({
    ...(typeof search['q'] === 'string' && search['q'] ? { q: search['q'] } : {}),
    ...(search['state'] === 'closed' ? { state: 'closed' as const } : {}),
  }),
  loaderDeps: ({ search }): { state: IdeaState } => ({ state: search.state ?? 'open' }),
  staticData: { nav: 'ideas' },
  loader: ({ context: { queryClient }, deps }) =>
    queryClient.infiniteQuery({ ...ideasQuery({ state: deps.state }), staleTime: 'static' }),
  component: Ideas,
})

function Ideas() {
  const { q = '', state = 'open' } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [text, setText] = useState(q)
  const { data: me } = useSuspenseQuery(meQuery)
  const all = useInfiniteQuery(ideasQuery({ state }))
  const found = useQuery(searchQuery(q))
  const searching = searchable(q)
  const rows = searching ? (found.data?.items ?? []) : (all.data?.pages.flatMap((p) => p.items) ?? [])

  return (
    <Page>
      <PageHeader title="Ideas" sub="Every idea you can see, the most recently changed first." />
      <Stack gap={4}>
        <SearchInput
          label="Search ideas"
          placeholder="Search titles"
          value={text}
          onChange={(value) => {
            setText(value)
            void navigate({ search: value.trim() ? { q: value } : {}, replace: true })
          }}
          shortcut="/"
        />
        {!searching && (
          <SegmentedControl<IdeaState>
            label="Open or closed"
            options={STATES}
            value={state}
            onChange={(next) => void navigate({ search: next === 'closed' ? { state: next } : {}, replace: true })}
          />
        )}
        {searching && found.isPending ? (
          <p>Searching…</p>
        ) : (
          <IdeaList
            ideas={rows.map((row) => ideaInfo(row, me.id))}
            query={searching ? q : undefined}
            empty={
              searching
                ? `No ideas you can see match “${q.trim()}”.`
                : q.trim()
                  ? 'A search needs a word of at least 3 letters.'
                  : state === 'closed'
                    ? 'No closed ideas you can see.'
                    : 'No open ideas yet. Start one with ideaf start.'
            }
            more={
              !searching && all.hasNextPage
                ? { loading: all.isFetchingNextPage, onMore: () => void all.fetchNextPage() }
                : null
            }
          />
        )}
        {searching && found.data?.incomplete && (
          <p>More ideas match than one search looks through: add a word to narrow it.</p>
        )}
      </Stack>
    </Page>
  )
}
