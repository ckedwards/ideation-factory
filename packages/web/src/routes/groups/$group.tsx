// A group: what it's for, and who's in it.
import { ApiError } from '@ideaf/api'
import { Page, PageHeader, Section } from '@ideaf/ui'
import { queryOptions, useInfiniteQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { api } from '../../api.ts'
import { MemberList } from '../../components/MemberList.tsx'
import { membersQuery } from '../../members.ts'
import { plural } from '../../plural.ts'

const groupQuery = (group: string) =>
  queryOptions({ queryKey: ['group', group], queryFn: () => api.getGroup({ group }) })

export const Route = createFileRoute('/groups/$group')({
  staticData: { nav: 'groups' },
  loader: async ({ context: { queryClient }, params }) => {
    try {
      await queryClient.ensureQueryData(groupQuery(params.group))
    } catch (error) {
      if (error instanceof ApiError && error.code === 'not_found') {
        throw notFound()
      }
      throw error
    }
  },
  component: Group,
})

function Group() {
  const { group: handle } = Route.useParams()
  const { data: group } = useSuspenseQuery(groupQuery(handle))
  const members = useInfiniteQuery(membersQuery('group', handle))
  return (
    <Page>
      <PageHeader
        title={group.name}
        sub={`${group.handle} · group · ${plural(group.members, 'member')}${group.deleted ? ' · deleted' : ''}`}
      />
      {group.description && <p>{group.description}</p>}
      <Section title="Members">
        <MemberList
          members={members.data?.pages.flatMap((p) => p.items) ?? []}
          more={
            members.hasNextPage
              ? { loading: members.isFetchingNextPage, onMore: () => void members.fetchNextPage() }
              : null
          }
        />
      </Section>
    </Page>
  )
}
