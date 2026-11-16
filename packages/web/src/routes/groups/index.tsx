// Every group, by handle, or those matching a search (?q=). Groups are
// people to share and review with; their ideas live in teams.
import { useState } from 'react'
import { Button, Page, PageHeader, SearchInput, Stack } from '@ideaf/ui'
import { infiniteQueryOptions, useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { api } from '../../api.ts'
import { ContainerList } from '../../components/ContainerList.tsx'
import { NewContainer } from '../../components/NewContainer.tsx'

const groupsQuery = (q: string) =>
  infiniteQueryOptions({
    queryKey: ['groups', q],
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      api.listGroups({ ...(q ? { q } : {}), ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.next,
  })

export const Route = createFileRoute('/groups/')({
  validateSearch: (search: Record<string, unknown>): { q?: string } =>
    typeof search['q'] === 'string' && search['q'] ? { q: search['q'] } : {},
  staticData: { nav: 'groups' },
  component: Groups,
})

function Groups() {
  const { q = '' } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [text, setText] = useState(q)
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const groups = useInfiniteQuery(groupsQuery(q.trim()))
  return (
    <Page>
      <PageHeader
        title="Groups"
        sub="People to share ideas with and ask for reviews, across teams."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            New group
          </Button>
        }
      />
      <NewContainer
        kind="group"
        open={creating}
        onClose={() => setCreating(false)}
        onCreate={async (container) => {
          const made = await api.createGroup(container)
          await queryClient.invalidateQueries({ queryKey: ['groups'] })
          await navigate({ href: `/groups/${made.handle}` })
        }}
      />
      <Stack gap={4}>
        <SearchInput
          label="Search groups"
          placeholder="Search groups"
          value={text}
          onChange={(value) => {
            setText(value)
            void navigate({ search: value.trim() ? { q: value } : {}, replace: true })
          }}
        />
        {groups.isPending ? (
          <p>Loading…</p>
        ) : (
          <ContainerList
            label="Groups"
            items={(groups.data?.pages.flatMap((p) => p.items) ?? []).map((g) => ({
              ...g,
              href: `/groups/${g.handle}`,
            }))}
            empty={q.trim() ? `No group matches “${q.trim()}”.` : 'No groups yet.'}
            more={
              groups.hasNextPage
                ? { loading: groups.isFetchingNextPage, onMore: () => void groups.fetchNextPage() }
                : null
            }
          />
        )}
      </Stack>
    </Page>
  )
}
