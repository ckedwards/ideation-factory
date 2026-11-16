// A place's page: a team's at /mobile (what it is, its ideas, its members),
// or a person's at /@riley (their ideas you can see).
import { ApiError } from '@ideaf/api'
import { useState } from 'react'
import { Link, Page, PageHeader, Section } from '@ideaf/ui'
import {
  type QueryClient,
  useInfiniteQuery,
  useQueries,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { api, membershipsQuery, meQuery } from '../../api.ts'
import { IdeaList } from '../../components/IdeaList.tsx'
import { Membership } from '../../components/Membership.tsx'
import { MemberList } from '../../components/MemberList.tsx'
import { WatchSelect } from '../../components/WatchSelect.tsx'
import './-components/TeamPage.css'
import { ideaInfo } from '../../ideas.ts'
import { countQuery, type IdeaState, ideasQuery } from '../../lists.ts'
import { StateTabs } from '../../components/StateTabs.tsx'
import { membersQuery, useMembership } from '../../members.ts'
import { groupByHandleQuery, personByHandleQuery, teamByHandleQuery } from '../../places.ts'
import { requirementsSentence } from './-components/TeamRequirements.tsx'
import { plural } from '../../plural.ts'

/** A person's handle, from /@riley; null for a team's page. */
const personHandle = (place: string) => (place.startsWith('@') ? place.slice(1) : null)

async function load(queryClient: QueryClient, place: string) {
  const handle = personHandle(place)
  if (handle) {
    const person = await queryClient.query({ ...personByHandleQuery(handle), staleTime: 'static' })
    // an old handle: on to the current one
    if (person.handle !== handle) {
      // an address, not route params: the router would write the @ as %40
      throw redirect({ href: `/@${person.handle}`, replace: true })
    }
    await queryClient.infiniteQuery({ ...ideasQuery({ owner: person.id, state: 'open' }), staleTime: 'static' })
  } else {
    const team = await queryClient.query({ ...teamByHandleQuery(place), staleTime: 'static' })
    if (team.handle !== place) {
      throw redirect({ to: '/$place', params: { place: team.handle }, replace: true })
    }
    await queryClient.infiniteQuery({ ...ideasQuery({ team: team.id, state: 'open' }), staleTime: 'static' })
  }
}

export const Route = createFileRoute('/$place/')({
  loader: async ({ context: { queryClient }, params }) => {
    try {
      await load(queryClient, params.place)
    } catch (error) {
      if (error instanceof ApiError && error.code === 'not_found') {
        throw notFound()
      }
      throw error
    }
  },
  component: Place,
})

function Place() {
  const { place } = Route.useParams()
  const handle = personHandle(place)
  return handle ? <PersonPage handle={handle} /> : <TeamPage handle={place} />
}

function TeamPage({ handle }: { handle: string }) {
  const { data: team } = useSuspenseQuery(teamByHandleQuery(handle))
  const { data: me } = useSuspenseQuery(meQuery)
  const [state, setState] = useState<IdeaState>('open')
  const ideas = useInfiniteQuery(ideasQuery({ team: team.id, state }))
  const counts = useQuery(countQuery({ team: team.id }))
  const members = useInfiniteQuery(membersQuery('team', team.handle))
  const membership = useMembership('team', team)
  const queryClient = useQueryClient()
  // its approval requirements, with the groups they name by name, as a sentence
  const ruleIds = [...new Set(team.requirements.groups.flatMap((r) => r.groups))]
  const ruleGroups = useQueries({ queries: ruleIds.map((id) => groupByHandleQuery(id)) })
  const approving = requirementsSentence(
    {
      approvals: team.requirements.approvals,
      resolved: team.requirements.resolved,
      groups: team.requirements.groups.map((r) => ({
        mode: r.mode,
        request: r.request,
        groups: r.groups.map((id) => ruleGroups[ruleIds.indexOf(id)]?.data ?? { id, handle: id, name: 'a group' }),
      })),
    },
    true,
  )
  const manages = membership.role === 'admin' || membership.role === 'maintainer'
  const watch = useQuery({
    queryKey: ['team', team.id, 'watch'],
    queryFn: () => api.getTeamWatch({ team: team.id }),
  })
  return (
    <Page>
      <PageHeader
        title={team.name}
        sub={`${team.handle} · team · ${plural(team.members, 'member')}${team.archived ? ' · archived' : ''}`}
        actions={
          <span className="team-actions">
            {watch.data && (
              <WatchSelect
                value={watch.data.level}
                onChange={(level) =>
                  void api.setTeamWatch({ team: team.id, level }).then(() => {
                    void queryClient.invalidateQueries({ queryKey: ['team', team.id, 'watch'] })
                    void queryClient.invalidateQueries({ queryKey: membershipsQuery.queryKey })
                    void queryClient.invalidateQueries({ queryKey: ['notifications'] })
                  })
                }
              />
            )}
            <Membership {...membership} settingsHref={`/${team.handle}/settings`} />
          </span>
        }
      />
      {team.description && <p>{team.description}</p>}
      <Section
        title="How ideas are approved"
        action={manages ? <Link href={`/${team.handle}/settings?tab=requirements`}>Change</Link> : undefined}
      >
        <p className="team-approving">{approving}</p>
      </Section>
      <Section title="Ideas">
        <StateTabs value={state} onChange={setState} counts={counts.data}>
          <IdeaList
            ideas={(ideas.data?.pages.flatMap((p) => p.items) ?? []).map((row) => ideaInfo(row, me.id))}
            hide={{ team: true }}
            empty={
              state === 'closed'
                ? 'No closed ideas you can see in this team.'
                : 'No open ideas you can see in this team.'
            }
            more={
              ideas.hasNextPage ? { loading: ideas.isFetchingNextPage, onMore: () => void ideas.fetchNextPage() } : null
            }
          />
        </StateTabs>
      </Section>
      <Section title="Members">
        <MemberList
          members={members.data?.pages.flatMap((p) => p.items) ?? []}
          more={
            members.hasNextPage
              ? { loading: members.isFetchingNextPage, onMore: () => void members.fetchNextPage() }
              : null
          }
        />
      </Section>
    </Page>
  )
}

function PersonPage({ handle }: { handle: string }) {
  const { data: person } = useSuspenseQuery(personByHandleQuery(handle))
  const { data: me } = useSuspenseQuery(meQuery)
  const [state, setState] = useState<IdeaState>('open')
  const ideas = useInfiniteQuery(ideasQuery({ owner: person.id, state }))
  const counts = useQuery(countQuery({ owner: person.id }))
  const yours = person.id === me.id
  return (
    <Page>
      <PageHeader title={person.name} sub={`@${person.handle}${person.inactive ? ' · inactive' : ''}`} />
      <Section title={yours ? 'Your ideas' : 'Their ideas you can see'}>
        <StateTabs value={state} onChange={setState} counts={counts.data}>
          <IdeaList
            ideas={(ideas.data?.pages.flatMap((p) => p.items) ?? []).map((row) => ideaInfo(row, me.id))}
            hide={{ author: true }}
            empty={
              state === 'closed'
                ? 'No closed ideas.'
                : yours
                  ? 'No open ideas. Start one with ideaf start.'
                  : 'None open that you can see.'
            }
            more={
              ideas.hasNextPage ? { loading: ideas.isFetchingNextPage, onMore: () => void ideas.fetchNextPage() } : null
            }
          />
        </StateTabs>
      </Section>
    </Page>
  )
}
