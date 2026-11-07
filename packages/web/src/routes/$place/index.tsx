// A place's page: a team's at /mobile (what it is, its ideas, its members),
// or a person's at /@riley (their ideas you can see).
import { ApiError } from '@ideaf/api'
import { Page, PageHeader, Section } from '@ideaf/ui'
import { type QueryClient, useInfiniteQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { meQuery } from '../../api.ts'
import { IdeaList } from '../../components/IdeaList.tsx'
import { Membership } from '../../components/Membership.tsx'
import { MemberList } from '../../components/MemberList.tsx'
import { ideaInfo } from '../../ideas.ts'
import { ideasQuery } from '../../lists.ts'
import { membersQuery, useMembership } from '../../members.ts'
import { personByHandleQuery, teamByHandleQuery } from '../../places.ts'
import { plural } from '../../plural.ts'

/** A person's handle, from /@riley; null for a team's page. */
const personHandle = (place: string) => (place.startsWith('@') ? place.slice(1) : null)

async function load(queryClient: QueryClient, place: string) {
  const handle = personHandle(place)
  if (handle) {
    const person = await queryClient.query({ ...personByHandleQuery(handle), staleTime: 'static' })
    // an old handle: on to the current one
    if (person.handle !== handle) {
      throw redirect({ to: '/$place', params: { place: `@${person.handle}` }, replace: true })
    }
    await queryClient.infiniteQuery({ ...ideasQuery({ owner: person.id }), staleTime: 'static' })
  } else {
    const team = await queryClient.query({ ...teamByHandleQuery(place), staleTime: 'static' })
    if (team.handle !== place) {
      throw redirect({ to: '/$place', params: { place: team.handle }, replace: true })
    }
    await queryClient.infiniteQuery({ ...ideasQuery({ team: team.id }), staleTime: 'static' })
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
  const ideas = useInfiniteQuery(ideasQuery({ team: team.id }))
  const members = useInfiniteQuery(membersQuery('team', team.handle))
  const membership = useMembership('team', team)
  return (
    <Page>
      <PageHeader
        title={team.name}
        sub={`${team.handle} · team · ${plural(team.members, 'member')}${team.archived ? ' · archived' : ''}`}
        actions={<Membership {...membership} settingsHref={`/${team.handle}/settings`} />}
      />
      {team.description && <p>{team.description}</p>}
      <Section title="Ideas">
        <IdeaList
          ideas={(ideas.data?.pages.flatMap((p) => p.items) ?? []).map((row) => ideaInfo(row, me.id))}
          hide={{ team: true }}
          empty="No ideas you can see in this team yet."
          more={
            ideas.hasNextPage ? { loading: ideas.isFetchingNextPage, onMore: () => void ideas.fetchNextPage() } : null
          }
        />
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
  const ideas = useInfiniteQuery(ideasQuery({ owner: person.id }))
  const yours = person.id === me.id
  return (
    <Page>
      <PageHeader title={person.name} sub={`@${person.handle}${person.inactive ? ' · inactive' : ''}`} />
      <Section title={yours ? 'Your ideas' : 'Their ideas you can see'}>
        <IdeaList
          ideas={(ideas.data?.pages.flatMap((p) => p.items) ?? []).map((row) => ideaInfo(row, me.id))}
          hide={{ author: true }}
          empty={yours ? 'No ideas yet. Start one with ideaf start.' : 'None you can see.'}
          more={
            ideas.hasNextPage ? { loading: ideas.isFetchingNextPage, onMore: () => void ideas.fetchNextPage() } : null
          }
        />
      </Section>
    </Page>
  )
}
