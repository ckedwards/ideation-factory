// Pick who to share with or ask for a review, in one box: people, groups and teams (by name or
// handle) found together, and everyone on the site where that's allowed.
import { useState } from 'react'
import { Combobox, type ComboboxOption } from '@ideaf/ui'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api.ts'

export type Picked = { kind: 'user' | 'group' | 'team'; id: string; name: string } | { kind: 'everyone'; name: string }

export interface SubjectPickerProps {
  label: string
  value: Picked | null
  onChange: (picked: Picked | null) => void
  /** What can be picked: people and groups for a review; teams and everyone too for sharing. */
  kinds: Array<Picked['kind']>
}

const EVERYONE: Picked = { kind: 'everyone', name: 'Everyone on the site' }

export function SubjectPicker({ label, value, onChange, kinds }: SubjectPickerProps) {
  const [query, setQuery] = useState('')
  const q = query.trim()
  const enabled = (kind: Picked['kind']) => q.length > 0 && kinds.includes(kind)
  const people = useQuery({
    queryKey: ['people', q],
    queryFn: () => api.findUsers({ q, limit: 5 }),
    enabled: enabled('user'),
    staleTime: 30_000,
  })
  const groups = useQuery({
    queryKey: ['groups', 'pick', q],
    queryFn: () => api.listGroups({ q, limit: 4 }),
    enabled: enabled('group'),
    staleTime: 30_000,
  })
  const teams = useQuery({
    queryKey: ['teams', 'pick', q],
    queryFn: () => api.listTeams({ q, limit: 4 }),
    enabled: enabled('team'),
    staleTime: 30_000,
  })
  const found: Array<ComboboxOption & { picked: Picked }> = [
    ...(enabled('user') ? (people.data?.items ?? []) : []).map((p) => ({
      id: `user:${p.id}`,
      label: p.name,
      sub: `@${p.handle} · person`,
      person: p,
      picked: { kind: 'user' as const, id: p.id, name: p.name },
    })),
    ...(enabled('group') ? (groups.data?.items ?? []) : []).map((g) => ({
      id: `group:${g.id}`,
      label: g.name,
      sub: `${g.handle} · group`,
      picked: { kind: 'group' as const, id: g.id, name: g.name },
    })),
    ...(enabled('team') ? (teams.data?.items ?? []) : []).map((t) => ({
      id: `team:${t.id}`,
      label: `${t.name}’s members`,
      sub: `${t.handle} · team`,
      picked: { kind: 'team' as const, id: t.id, name: `${t.name}’s members` },
    })),
  ]
  const pinned = kinds.includes('everyone')
    ? [{ id: 'everyone', label: EVERYONE.name, sub: 'View only', picked: EVERYONE }]
    : []
  const option = (p: Picked): ComboboxOption =>
    p.kind === 'everyone' ? { id: 'everyone', label: p.name } : { id: `${p.kind}:${p.id}`, label: p.name }
  return (
    <Combobox
      label={label}
      value={value ? option(value) : null}
      onChange={(choice) => onChange([...found, ...pinned].find((f) => f.id === choice?.id)?.picked ?? null)}
      query={query}
      onQueryChange={setQuery}
      options={found}
      pinned={pinned}
      placeholder={kinds.includes('team') ? 'A person, group or team' : 'A person or group'}
      loading={people.isFetching || groups.isFetching || teams.isFetching}
    />
  )
}
