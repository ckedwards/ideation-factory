// A group: what it's for, who's in it, the teams it's part of, the teams' approval requirements that
// name it, and the open ideas asking it to review.
import { ApiError } from '@ideaf/api'
import { Page, PageHeader, Section, Toast } from '@ideaf/ui'
import { useState } from 'react'
import { useInfiniteQuery, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { api, meQuery } from '../../../api.ts'
import { GroupRules } from '../../../components/GroupRules.tsx'
import { GroupTeams } from '../../../components/GroupTeams.tsx'
import { IdeaList } from '../../../components/IdeaList.tsx'
import { ideaInfo } from '../../../ideas.ts'
import { ideasQuery } from '../../../lists.ts'
import { Membership } from '../../../components/Membership.tsx'
import { MemberList } from '../../../components/MemberList.tsx'
import { groupTeamsQuery, membersQuery, useMembership, useTeamGroupWrites } from '../../../members.ts'
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
  const teams = useQuery(groupTeamsQuery(handle))
  const { data: me } = useSuspenseQuery(meQuery)
  const rules = useQuery({ queryKey: ['group', handle, 'rules'], queryFn: () => api.listGroupRules({ group: handle }) })
  const reviewing = useInfiniteQuery(ideasQuery({ reviewerGroup: group.id, state: 'open' }))
  const [problem, setProblem] = useState<string | null>(null)
  const writes = useTeamGroupWrites(setProblem)
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
      <Section title="Teams">
        <GroupTeams
          group={group}
          teams={teams.data?.items ?? []}
          admin={membership.role === 'admin'}
          onLeave={(team) => writes.remove(team.handle, group.handle)}
        />
      </Section>
      <Section title="Used in approval requirements">
        <GroupRules group={group} rules={rules.data?.items ?? []} />
      </Section>
      <Section title="Reviewing">
        <IdeaList
          ideas={(reviewing.data?.pages.flatMap((p) => p.items) ?? []).map((row) => ideaInfo(row, me.id))}
          empty={`No open idea has asked ${group.name} to review it.`}
          more={
            reviewing.hasNextPage
              ? { loading: reviewing.isFetchingNextPage, onMore: () => void reviewing.fetchNextPage() }
              : null
          }
        />
      </Section>
      <Toast message={problem} onDismiss={() => setProblem(null)} />
    </Page>
  )
}
