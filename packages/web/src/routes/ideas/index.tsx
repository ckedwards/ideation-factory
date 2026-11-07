// Every idea you can see, newest change first, 25 at a time; or a search of
// their titles (?q=), closest first.
import { useState } from 'react'
import { Page, PageHeader, SearchInput, Stack } from '@ideaf/ui'
import { useInfiniteQuery, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { meQuery } from '../../api.ts'
import { IdeaList } from '../../components/IdeaList.tsx'
import { ideaInfo } from '../../ideas.ts'
import { ideasQuery, searchable, searchQuery } from '../../lists.ts'

export const Route = createFileRoute('/ideas/')({
  validateSearch: (search: Record<string, unknown>): { q?: string } =>
    typeof search['q'] === 'string' && search['q'] ? { q: search['q'] } : {},
  staticData: { nav: 'ideas' },
  loader: ({ context: { queryClient } }) => queryClient.ensureInfiniteQueryData(ideasQuery()),
  component: Ideas,
})

function Ideas() {
  const { q = '' } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [text, setText] = useState(q)
  const { data: me } = useSuspenseQuery(meQuery)
  const all = useInfiniteQuery(ideasQuery())
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
                  : 'No ideas yet. Start one with ideaf start.'
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
