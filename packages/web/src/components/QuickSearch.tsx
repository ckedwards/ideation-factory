// Find one known thing from anywhere: the sidebar's search, over idea titles, teams and groups, the
// first few of each, and the way to search every idea. / focuses it from anywhere but a text field.
import { useEffect, useRef, useState } from 'react'
import { Combobox, type ComboboxOption } from '@ideaf/ui'
import { ideaPath } from '@ideaf/api'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { api } from '../api.ts'
import { searchable } from '../lists.ts'

export function QuickSearch() {
  const [query, setQuery] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const q = query.trim()
  const ideas = useQuery({
    queryKey: ['quick-search', 'ideas', q],
    queryFn: () => api.searchIdeas({ q, limit: 5 }),
    enabled: searchable(q),
    staleTime: 30_000,
  })
  const teams = useQuery({
    queryKey: ['quick-search', 'teams', q],
    queryFn: () => api.listTeams({ q, limit: 3 }),
    enabled: q.length > 0,
    staleTime: 30_000,
  })
  const groups = useQuery({
    queryKey: ['quick-search', 'groups', q],
    queryFn: () => api.listGroups({ q, limit: 3 }),
    enabled: q.length > 0,
    staleTime: 30_000,
  })

  // / from anywhere but somewhere you type
  useEffect(() => {
    const focus = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target?.closest('input, textarea, select, [contenteditable="true"]') !== null && target !== null
      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        box.current?.querySelector('input')?.focus()
      }
    }
    document.addEventListener('keydown', focus)
    return () => document.removeEventListener('keydown', focus)
  }, [])

  const found: Array<ComboboxOption & { href: string }> = [
    ...(ideas.data?.items ?? []).map((i) => ({
      id: `idea:${i.id}`,
      label: i.title,
      sub: i.team ? `Idea · ${i.team.name}` : `Idea · ${i.owner.name}`,
      href: ideaPath(i.place, i.number),
    })),
    ...(teams.data?.items ?? []).map((t) => ({
      id: `team:${t.id}`,
      label: t.name,
      sub: `Team · ${t.handle}`,
      href: `/${t.handle}`,
    })),
    ...(groups.data?.items ?? []).map((g) => ({
      id: `group:${g.id}`,
      label: g.name,
      sub: `Group · ${g.handle}`,
      href: `/groups/${g.handle}`,
    })),
    ...(searchable(q)
      ? [{ id: 'all', label: `Search all ideas for “${q}”`, href: `/ideas?q=${encodeURIComponent(q)}` }]
      : []),
  ]
  return (
    <div ref={box} className="quick-search">
      <Combobox
        label="Search ideas, teams and groups"
        placeholder="Search  /"
        value={null}
        query={query}
        onQueryChange={setQuery}
        options={found}
        loading={ideas.isFetching || teams.isFetching || groups.isFetching}
        emptyHint="Ideas are found by their titles, from 3 letters."
        onChange={(option) => {
          const pick = found.find((f) => f.id === option?.id)
          if (pick) {
            setQuery('')
            box.current?.querySelector('input')?.blur()
            void navigate({ href: pick.href })
          }
        }}
      />
    </div>
  )
}
