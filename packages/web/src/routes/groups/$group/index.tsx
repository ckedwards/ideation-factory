// A group: what it's for, and who's in it.
import { ApiError } from '@ideaf/api'
import { Page, PageHeader, Section } from '@ideaf/ui'
import { useInfiniteQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { Membership } from '../../../components/Membership.tsx'
import { MemberList } from '../../../components/MemberList.tsx'
import { membersQuery, useMembership } from '../../../members.ts'
import { groupByHandleQuery } from '../../../places.ts'
import { plural } from '../../../plural.ts'

export const Route = createFileRoute('/groups/$group/')({
  staticData: { nav: 'groups' },
  loader: async ({ context: { queryClient }, params }) => {
    try {
      await queryClient.query({ ...groupByHandleQuery(params.group), staleTime: 'static' })
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
  const { data: group } = useSuspenseQuery(groupByHandleQuery(handle))
  const members = useInfiniteQuery(membersQuery('group', handle))
  const membership = useMembership('group', group)
  return (
    <Page>
      <PageHeader
        title={group.name}
        sub={`${group.handle} · group · ${plural(group.members, 'member')}${group.deleted ? ' · deleted' : ''}`}
        actions={<Membership {...membership} settingsHref={`/groups/${group.handle}/settings`} />}
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
