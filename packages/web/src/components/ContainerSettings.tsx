// A team's or a group's settings page, for its maintainers and admins: its
// members, people asking to join, and anything more the page brings (a
// team's rules for its ideas). Anyone else is told who can change them.
import { type ReactNode, useState } from 'react'
import { Empty, Link, Page, PageHeader, Section, Toast } from '@ideaf/ui'
import { useInfiniteQuery, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { meQuery } from '../api.ts'
import { joinRequestsQuery, membersQuery, useMemberWrites, useMembership } from '../members.ts'
import { JoinRequests } from './JoinRequests.tsx'
import { MemberManager } from './MemberManager.tsx'

export interface ContainerSettingsProps {
  kind: 'team' | 'group'
  container: { id: string; handle: string; name: string }
  /** Its page, to go back to. */
  href: string
  /** More sections, for its admins (a team's rules for its ideas). */
  children?: (tools: { onProblem: (message: string) => void }) => ReactNode
  /** More sections, for its maintainers and admins (a team's approval requirements). */
  managed?: (tools: { onProblem: (message: string) => void }) => ReactNode
}

export function ContainerSettings({ kind, container, href, children, managed }: ContainerSettingsProps) {
  const { data: me } = useSuspenseQuery(meQuery)
  const [problem, setProblem] = useState<string | null>(null)
  const { role } = useMembership(kind, container)
  const managing = role === 'admin' || role === 'maintainer'
  const members = useInfiniteQuery(membersQuery(kind, container.handle))
  const requests = useQuery({ ...joinRequestsQuery(kind, container.handle), enabled: managing })
  const writes = useMemberWrites(kind, container.handle, setProblem)

  return (
    <Page>
      <PageHeader title={`${container.name}: settings`} crumbs={<Link href={href}>← {container.name}</Link>} />
      {!managing ? (
        <Empty action={<Link href={href}>Back to {container.name}</Link>}>
          Only the {kind}’s maintainers and admins can change its settings.
        </Empty>
      ) : (
        <>
          <Section title="Members">
            <MemberManager
              members={members.data?.pages.flatMap((p) => p.items) ?? []}
              you={{ id: me.id, role: role! }}
              onRole={(person, next) => writes.add(person.id, next)}
              onRemove={(person) => writes.remove(person.id)}
              onAdd={(person, next) => writes.add(person.id, next)}
              more={
                members.hasNextPage
                  ? { loading: members.isFetchingNextPage, onMore: () => void members.fetchNextPage() }
                  : null
              }
            />
          </Section>
          <Section title="Asking to join">
            <JoinRequests
              people={requests.data?.items ?? []}
              onDecide={(person, approve) => writes.decide(person.id, approve)}
            />
          </Section>
          {managed?.({ onProblem: setProblem })}
          {role === 'admin' && children?.({ onProblem: setProblem })}
        </>
      )}
      <Toast message={problem} onDismiss={() => setProblem(null)} />
    </Page>
  )
}
