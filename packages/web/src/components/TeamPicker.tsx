// Pick a team by typing part of its name or handle.
import { useState } from 'react'
import { Combobox, type ComboboxOption } from '@ideaf/ui'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api.ts'

export interface TeamRefLite {
  archived?: boolean
  id: string
  handle: string
  name: string
}

export interface TeamPickerProps {
  label: string
  value: TeamRefLite | null
  onChange: (group: TeamRefLite | null) => void
  exclude?: string[]
}

export function TeamPicker({ label, value, onChange, exclude = [] }: TeamPickerProps) {
  const [query, setQuery] = useState('')
  const q = query.trim()
  const found = useQuery({
    queryKey: ['teams', 'pick', q],
    queryFn: () => api.listTeams({ q, limit: 8 }),
    enabled: q.length > 0,
    staleTime: 30_000,
  })
  const groups = (found.data?.items ?? []).filter((g) => !exclude.includes(g.id))
  const option = (g: TeamRefLite): ComboboxOption => ({ id: g.id, label: g.name, sub: g.handle })
  return (
    <Combobox
      label={label}
      value={value ? option(value) : null}
      onChange={(picked) => onChange(groups.find((g) => g.id === picked?.id) ?? (picked ? value : null))}
      query={query}
      onQueryChange={setQuery}
      options={groups.map(option)}
      placeholder="Team name or handle"
      loading={found.isFetching}
    />
  )
}
