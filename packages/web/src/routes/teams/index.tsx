// Every team, by handle, or those matching a search (?q=).
import { useState } from 'react'
import { Button, Page, PageHeader, SearchInput, Stack } from '@ideaf/ui'
import { infiniteQueryOptions, useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { api } from '../../api.ts'
import { ContainerList } from '../../components/ContainerList.tsx'
import { NewContainer } from '../../components/NewContainer.tsx'

const teamsQuery = (q: string) =>
  infiniteQueryOptions({
    queryKey: ['teams', q],
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      api.listTeams({ ...(q ? { q } : {}), ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.next,
  })

export const Route = createFileRoute('/teams/')({
  validateSearch: (search: Record<string, unknown>): { q?: string } =>
    typeof search['q'] === 'string' && search['q'] ? { q: search['q'] } : {},
  staticData: { nav: 'teams' },
  component: Teams,
})

function Teams() {
  const { q = '' } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [text, setText] = useState(q)
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const teams = useInfiniteQuery(teamsQuery(q.trim()))
  return (
    <Page>
      <PageHeader
        title="Teams"
        sub="Where ideas are shared and reviewed."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            New team
          </Button>
        }
      />
      <NewContainer
        kind="team"
        open={creating}
        onClose={() => setCreating(false)}
        onCreate={async (container) => {
          const made = await api.createTeam(container)
          await queryClient.invalidateQueries({ queryKey: ['teams'] })
          await navigate({ href: `/${made.handle}` })
        }}
      />
      <Stack gap={4}>
        <SearchInput
          label="Search teams"
          placeholder="Search teams"
          value={text}
          onChange={(value) => {
            setText(value)
            void navigate({ search: value.trim() ? { q: value } : {}, replace: true })
          }}
        />
        {teams.isPending ? (
          <p>Loading…</p>
        ) : (
          <ContainerList
            label="Teams"
            items={(teams.data?.pages.flatMap((p) => p.items) ?? []).map((t) => ({ ...t, href: `/${t.handle}` }))}
            empty={q.trim() ? `No team matches “${q.trim()}”.` : 'No teams yet.'}
            more={
              teams.hasNextPage ? { loading: teams.isFetchingNextPage, onMore: () => void teams.fetchNextPage() } : null
            }
          />
        )}
      </Stack>
    </Page>
  )
}
