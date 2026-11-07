// Who a grant is for, by name: a person, a group, a team's members, or
// everyone. Each is read once and kept.
import { useQueries } from '@tanstack/react-query'
import { api } from '../../../../../api.ts'

export type Subject = { kind: 'user' | 'group' | 'team'; id: string } | { kind: 'everyone' }

export const subjectKey = (s: Subject) => (s.kind === 'everyone' ? 'everyone' : `${s.kind}:${s.id}`)

export interface Named {
  label: string
  /** Its page, if it has one. */
  href?: string
}

/** Each subject's name, by subjectKey; one still loading is named by its kind. */
export function useSubjectNames(subjects: Subject[]): Map<string, Named> {
  const unique = [...new Map(subjects.map((s) => [subjectKey(s), s])).values()].filter(
    (s): s is Exclude<Subject, { kind: 'everyone' }> => s.kind !== 'everyone',
  )
  const results = useQueries({
    queries: unique.map((s) => ({
      // its own key: the name, not the person, group or team it names
      queryKey: ['subject-name', s.kind, s.id],
      queryFn: async (): Promise<Named> => {
        if (s.kind === 'user') {
          const p = await api.getUser({ user: s.id })
          return { label: `${p.name} (@${p.handle})`, href: `/@${p.handle}` }
        }
        if (s.kind === 'group') {
          const g = await api.getGroup({ group: s.id })
          return { label: `${g.name} (group)`, href: `/groups/${g.handle}` }
        }
        const t = await api.getTeam({ team: s.id })
        return { label: `${t.name}’s members`, href: `/${t.handle}` }
      },
      staleTime: 5 * 60_000,
    })),
  })
  const names = new Map<string, Named>([['everyone', { label: 'Everyone on the site' }]])
  unique.forEach((s, i) => {
    names.set(subjectKey(s), results[i]?.data ?? { label: s.kind === 'user' ? 'Someone' : `A ${s.kind}` })
  })
  return names
}
