// A team's or a group's members, 25 at a time, as MemberList shows them.
import {
  infiniteQueryOptions,
  queryOptions,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { api, membershipsQuery } from './api.ts'
import type { MemberInfo } from './components/MemberList.tsx'

type Page = { items: MemberInfo[]; next: string | null }

export const membersQuery = (kind: 'team' | 'group', handle: string) =>
  infiniteQueryOptions({
    queryKey: [kind, handle, 'members'],
    queryFn: async ({ pageParam }: { pageParam: string | null }): Promise<Page> => {
      const cursor = pageParam ? { cursor: pageParam } : {}
      const page =
        kind === 'team'
          ? await api.listTeamMembers({ team: handle, ...cursor })
          : await api.listGroupMembers({ group: handle, ...cursor })
      return { items: page.items.map((m) => ({ person: m.user, role: m.role })), next: page.next }
    },
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.next,
  })

/** Your place in a team or group, for its header (Membership): your role, or asking to join. */
export function useMembership(kind: 'team' | 'group', container: { id: string; handle: string }) {
  const queryClient = useQueryClient()
  const { data: memberships } = useSuspenseQuery(membershipsQuery)
  const join = useMutation({
    mutationFn: () =>
      kind === 'team'
        ? api.requestToJoinTeam({ team: container.handle })
        : api.requestToJoinGroup({ group: container.handle }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: membershipsQuery.queryKey }),
  })
  const mine = (kind === 'team' ? memberships.teams : memberships.groups).find((c) => c.id === container.id)
  return {
    role: mine?.role ?? null,
    requested: memberships.requested.some((r) => r.kind === kind && r.id === container.id),
    onJoin: () => join.mutate(),
    joining: join.isPending,
  }
}

/** A team's or a group's join requests, for its maintainers and admins. */
export const joinRequestsQuery = (kind: 'team' | 'group', handle: string) =>
  queryOptions({
    queryKey: [kind, handle, 'join-requests'],
    queryFn: () =>
      kind === 'team' ? api.listTeamJoinRequests({ team: handle }) : api.listGroupJoinRequests({ group: handle }),
  })

type Role = 'admin' | 'maintainer' | 'member'

/** Managing a team's or a group's members; each write reads the members, requests and your teams again. */
export function useMemberWrites(kind: 'team' | 'group', handle: string, onProblem: (message: string) => void) {
  const queryClient = useQueryClient()
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: [kind, handle] }),
      queryClient.invalidateQueries({ queryKey: membershipsQuery.queryKey }),
    ])
  const write = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSettled: refresh,
    onError: (error) => onProblem(error.message),
  })
  const team = kind === 'team'
  return {
    add: (user: string, role: Role) =>
      write.mutate(() =>
        team ? api.addTeamMember({ team: handle, user, role }) : api.addGroupMember({ group: handle, user, role }),
      ),
    remove: (user: string) =>
      write.mutate(() =>
        team ? api.removeTeamMember({ team: handle, user }) : api.removeGroupMember({ group: handle, user }),
      ),
    decide: (user: string, approve: boolean) =>
      write.mutate(() =>
        team
          ? api.decideTeamJoinRequest({ team: handle, user, approve })
          : api.decideGroupJoinRequest({ group: handle, user, approve }),
      ),
  }
}
