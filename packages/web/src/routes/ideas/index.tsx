// Every idea you can see, open ones by default (?state=closed for the closed),
// newest change first, 25 at a time, with how many there are; narrowed by
// author, team, who's asked to review it, or to drafts (each in the address, so
// a filtered list can be linked to: Home's review list, say); or a search of
// their titles (?q=), closest first.
import { useState } from 'react'
import { Button, Page, PageHeader, type Person, SearchInput, Stack } from '@ideaf/ui'
import { useInfiniteQuery, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { api, meQuery } from '../../api.ts'
import { IdeaList } from '../../components/IdeaList.tsx'
import { PersonPicker } from '../../components/PersonPicker.tsx'
import { StateTabs } from '../../components/StateTabs.tsx'
import { TeamPicker, type TeamRefLite } from '../../components/TeamPicker.tsx'
import { ideaInfo } from '../../ideas.ts'
import { countQuery, type IdeaFilters, type IdeaState, ideasQuery, searchable, searchQuery } from '../../lists.ts'
import { plural } from '../../plural.ts'
import './-ideas.css'

interface Search {
  q?: string
  state?: 'closed'
  /** Handles. */
  author?: string
  team?: string
  reviewer?: string
  drafts?: true
}

const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined)

/** The filters, as the api takes them: handles are refs too. */
const filtersOf = (search: Search): IdeaFilters => ({
  ...(search.author ? { owner: search.author } : {}),
  ...(search.team ? { team: search.team } : {}),
  ...(search.reviewer ? { reviewer: search.reviewer } : {}),
  ...(search.drafts ? { status: 'draft' as const } : {}),
})

export const Route = createFileRoute('/ideas/')({
  validateSearch: (search: Record<string, unknown>): Search => {
    const out: Search = {}
    for (const key of ['q', 'author', 'team', 'reviewer'] as const) {
      const value = text(search[key])
      if (value) {
        out[key] = value
      }
    }
    if (search['state'] === 'closed') {
      out.state = 'closed'
    }
    if (search['drafts'] === true || search['drafts'] === '1' || search['drafts'] === 1) {
      out.drafts = true
    }
    return out
  },
  loaderDeps: ({ search }) => ({ state: search.state ?? ('open' as IdeaState), filters: filtersOf(search) }),
  staticData: { nav: 'ideas' },
  loader: ({ context: { queryClient }, deps }) =>
    queryClient.infiniteQuery({ ...ideasQuery({ ...deps.filters, state: deps.state }), staleTime: 'static' }),
  component: Ideas,
})

function Ideas() {
  const search = Route.useSearch()
  const { q = '', state = 'open' } = search
  const navigate = useNavigate({ from: Route.fullPath })
  const [query, setQuery] = useState(q)
  const { data: me } = useSuspenseQuery(meQuery)
  const filters = filtersOf(search)
  const all = useInfiniteQuery(ideasQuery({ ...filters, state }))
  const counts = useQuery(countQuery(filters))
  const found = useQuery(searchQuery(q))
  const searching = searchable(q)
  const rows = searching ? (found.data?.items ?? []) : (all.data?.pages.flatMap((p) => p.items) ?? [])
  const filtered = Object.keys(filters).length > 0

  // the pickers show who and which team, from the handles in the address
  const author = useQuery({
    queryKey: ['person', search.author],
    queryFn: () => api.getUser({ user: search.author! }),
    enabled: Boolean(search.author),
  })
  const reviewer = useQuery({
    queryKey: ['person', search.reviewer],
    queryFn: () => api.getUser({ user: search.reviewer! }),
    enabled: Boolean(search.reviewer),
  })
  const team = useQuery({
    queryKey: ['team', search.team],
    queryFn: () => api.getTeam({ team: search.team! }),
    enabled: Boolean(search.team),
  })

  const set = (change: { [K in keyof Search]?: Search[K] | undefined }) => {
    const merged: Record<string, unknown> = { ...search, ...change }
    for (const key of Object.keys(merged)) {
      if (merged[key] === undefined) {
        delete merged[key]
      }
    }
    void navigate({ search: merged as Search, replace: true })
  }
  const person = (p: Person | null) => (p ? p.handle : undefined)
  const total = counts.data ? counts.data[state] : null

  return (
    <Page>
      <PageHeader title="Ideas" sub="Every idea you can see, the most recently changed first." />
      <Stack gap={4}>
        <SearchInput
          label="Search ideas"
          placeholder="Search titles"
          value={query}
          onChange={(value) => {
            setQuery(value)
            set({ q: value.trim() ? value : undefined })
          }}
        />
        {searching ? (
          found.isPending ? (
            <p>Searching…</p>
          ) : (
            <IdeaList
              ideas={rows.map((row) => ideaInfo(row, me.id))}
              query={q}
              empty={`No ideas you can see match “${q.trim()}”.`}
            />
          )
        ) : (
          <>
            <div className="ideas-filters" role="group" aria-label="Filters">
              <div className="ideas-filter">
                <span className="ideas-filter-label" aria-hidden>
                  Author
                </span>
                <PersonPicker
                  label="Author"
                  value={author.data && search.author ? author.data : null}
                  onChange={(p) => set({ author: person(p) })}
                />
              </div>
              <div className="ideas-filter">
                <span className="ideas-filter-label" aria-hidden>
                  Team
                </span>
                <TeamPicker
                  label="Team"
                  value={team.data && search.team ? (team.data as TeamRefLite) : null}
                  onChange={(t) => set({ team: t ? t.handle : undefined })}
                />
              </div>
              <div className="ideas-filter">
                <div className="ideas-filter-label">
                  <span aria-hidden>Reviewer</span>
                  {search.reviewer !== me.handle && (
                    <Button size="sm" variant="link" onClick={() => set({ reviewer: me.handle })}>
                      Asked of me
                    </Button>
                  )}
                </div>
                <PersonPicker
                  label="Reviewer"
                  value={reviewer.data && search.reviewer ? reviewer.data : null}
                  onChange={(p) => set({ reviewer: person(p) })}
                />
              </div>
              <label className="ideas-filters-check">
                <input
                  type="checkbox"
                  checked={Boolean(search.drafts)}
                  onChange={(event) => set({ drafts: event.target.checked ? true : undefined })}
                />{' '}
                Drafts only
              </label>
              {filtered && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => set({ author: undefined, team: undefined, reviewer: undefined, drafts: undefined })}
                >
                  Clear filters
                </Button>
              )}
            </div>
            <StateTabs
              value={state}
              onChange={(next) => set({ state: next === 'closed' ? 'closed' : undefined })}
              counts={counts.data}
            >
              <Stack gap={3}>
                {total !== null && (
                  <p className="ideas-total">
                    {plural(total, state === 'closed' ? 'closed idea' : 'open idea')} · the most recently changed first
                  </p>
                )}
                <IdeaList
                  ideas={rows.map((row) => ideaInfo(row, me.id))}
                  empty={
                    q.trim()
                      ? 'A search needs a word of at least 3 letters.'
                      : filtered
                        ? 'No ideas you can see match these filters.'
                        : state === 'closed'
                          ? 'No closed ideas you can see.'
                          : 'No open ideas yet. Start one with ideaf start.'
                  }
                  more={
                    all.hasNextPage ? { loading: all.isFetchingNextPage, onMore: () => void all.fetchNextPage() } : null
                  }
                />
              </Stack>
            </StateTabs>
          </>
        )}
        {searching && found.data?.incomplete && (
          <p>More ideas match than one search looks through: add a word to narrow it.</p>
        )}
      </Stack>
    </Page>
  )
}
