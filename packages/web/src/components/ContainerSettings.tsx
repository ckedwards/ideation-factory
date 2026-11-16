// A team's or a group's settings page, for its maintainers and admins, in tabs: its members (a
// table to search, sort and manage), people asking to join, and the rest of its settings (a team's
// profile and rules for its ideas). Anyone else is told who can change them.
import { type ReactNode, useState } from 'react'
import { Empty, Link, Page, PageHeader, Stack, Tabs, Toast } from '@ideaf/ui'
import { keepPreviousData, useInfiniteQuery, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { meQuery } from '../api.ts'
import {
  joinRequestsQuery,
  membersQuery,
  teamGroupsQuery,
  useMemberWrites,
  useMembership,
  useTeamGroupWrites,
} from '../members.ts'
import { JoinRequests } from './JoinRequests.tsx'
import { MemberTable, type MemberView } from './MemberTable.tsx'
import { TeamGroups } from './TeamGroups.tsx'

export type SettingsTab = 'members' | 'groups' | 'requests' | 'settings'

export interface ContainerSettingsProps {
  kind: 'team' | 'group'
  container: { id: string; handle: string; name: string; members?: number }
  /** Its page, to go back to. */
  href: string
  /** The tab shown, kept in the page's address. */
  tab: SettingsTab
  onTab: (tab: SettingsTab) => void
  /** More settings, for its admins (a team's profile and rules for its ideas). */
  children?: (tools: { onProblem: (message: string) => void }) => ReactNode
  /** More settings, for its maintainers and admins (a team's approval requirements). */
  managed?: (tools: { onProblem: (message: string) => void }) => ReactNode
}

export function ContainerSettings({ kind, container, href, tab, onTab, children, managed }: ContainerSettingsProps) {
  const { data: me } = useSuspenseQuery(meQuery)
  const [problem, setProblem] = useState<string | null>(null)
  const [view, setView] = useState<MemberView>({})
  const { role } = useMembership(kind, container)
  const managing = role === 'admin' || role === 'maintainer'
  const members = useInfiniteQuery({
    ...membersQuery(kind, container.handle, view),
    // the last list stays while a new search or sort comes
    placeholderData: keepPreviousData,
  })
  const requests = useQuery({ ...joinRequestsQuery(kind, container.handle), enabled: managing })
  const teamGroups = useQuery({ ...teamGroupsQuery(container.handle), enabled: managing && kind === 'team' })
  const groupWrites = useTeamGroupWrites(setProblem)
  const writes = useMemberWrites(kind, container.handle, setProblem)
  const settings = managed !== undefined || (role === 'admin' && children !== undefined)
  const tabs = [
    {
      id: 'members' as const,
      label: 'Members',
      ...(container.members !== undefined ? { count: container.members } : {}),
    },
    ...(kind === 'team' ? [{ id: 'groups' as const, label: 'Groups', count: teamGroups.data?.items.length ?? 0 }] : []),
    { id: 'requests' as const, label: 'Requests', count: requests.data?.items.length ?? 0 },
    ...(settings ? [{ id: 'settings' as const, label: 'Settings' }] : []),
  ]
  const shown = tabs.some((t) => t.id === tab) ? tab : 'members'

  return (
    <Page>
      <PageHeader title={`${container.name}: settings`} crumbs={<Link href={href}>← {container.name}</Link>} />
      {!managing ? (
        <Empty action={<Link href={href}>Back to {container.name}</Link>}>
          Only the {kind}’s maintainers and admins can change its settings.
        </Empty>
      ) : (
        <Tabs label={`${container.name}’s settings`} tabs={tabs} value={shown} onChange={onTab}>
          {shown === 'members' && (
            <MemberTable
              members={members.data?.pages.flatMap((p) => p.items) ?? []}
              you={{ id: me.id, role: role! }}
              view={view}
              onView={setView}
              loading={members.isPending || members.isPlaceholderData}
              onRole={(person, next) => writes.add(person.id, next)}
              onRemove={(person) => writes.remove(person.id)}
              onAdd={(person, next) => writes.add(person.id, next)}
              more={
                members.hasNextPage
                  ? { loading: members.isFetchingNextPage, onMore: () => void members.fetchNextPage() }
                  : null
              }
            />
          )}
          {shown === 'groups' && (
            <TeamGroups
              team={container}
              groups={teamGroups.data?.items ?? []}
              admin={role === 'admin'}
              onAdd={(group, next) => groupWrites.add(container.handle, group.handle, next)}
              onRole={(group, next) => groupWrites.add(container.handle, group.handle, next)}
              onRemove={(group) => groupWrites.remove(container.handle, group.handle)}
            />
          )}
          {shown === 'requests' && (
            <JoinRequests
              people={requests.data?.items ?? []}
              onDecide={(person, approve) => writes.decide(person.id, approve)}
            />
          )}
          {shown === 'settings' && (
            <Stack gap={6}>
              {managed?.({ onProblem: setProblem })}
              {role === 'admin' && children?.({ onProblem: setProblem })}
            </Stack>
          )}
        </Tabs>
      )}
      <Toast message={problem} onDismiss={() => setProblem(null)} />
    </Page>
  )
}
