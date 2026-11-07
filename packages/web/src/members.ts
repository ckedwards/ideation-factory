// A team's or a group's members, 25 at a time, as MemberList shows them.
import { infiniteQueryOptions } from '@tanstack/react-query'
import { api } from './api.ts'
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
