// Pick a person by typing part of their name or handle: the server searches,
// and the first few matches are offered.
import { useState } from 'react'
import { Combobox, type ComboboxOption, type Person } from '@ideaf/ui'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api.ts'

export interface PersonPickerProps {
  label: string
  value: Person | null
  onChange: (person: Person | null) => void
  /** People not to offer (already members). */
  exclude?: string[]
}

export function PersonPicker({ label, value, onChange, exclude = [] }: PersonPickerProps) {
  const [query, setQuery] = useState('')
  const q = query.trim()
  const found = useQuery({
    queryKey: ['people', q],
    queryFn: () => api.findUsers({ q, limit: 8 }),
    enabled: q.length > 0,
    staleTime: 30_000,
  })
  const people = (found.data?.items ?? []).filter((p) => !exclude.includes(p.id))
  const option = (p: Person): ComboboxOption => ({ id: p.id, label: p.name, sub: `@${p.handle}`, person: p })
  return (
    <Combobox
      label={label}
      value={value ? option(value) : null}
      onChange={(picked) => onChange(picked?.person ?? null)}
      query={query}
      onQueryChange={setQuery}
      options={people.map(option)}
      placeholder="Name or handle"
      loading={found.isFetching}
    />
  )
}
