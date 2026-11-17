// Home: what's waiting on you first (the ideas you've been asked to review, by
// name or through a group, out for review and not approved by you yet), then
// your open ideas, then what's changed in the ideas you can see. Beside them:
// what's unread, join requests waiting on you, and your teams.
import { type IdeaInfo, Link, Page, PageHeader, Section, Tag } from '@ideaf/ui'
import { queryOptions, useInfiniteQuery, useQueries, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ideaPath } from '@ideaf/api'
import { api, membershipsQuery, meQuery, unreadQuery } from '../api.ts'
import { HomeSide } from '../components/HomeSide.tsx'
import { IdeaList } from '../components/IdeaList.tsx'
import { ideaInfo } from '../ideas.ts'
import { ideasQuery } from '../lists.ts'
import { joinRequestsQuery } from '../members.ts'
import { plural } from '../plural.ts'
import './-home.css'

const asked = (me: string) => ideasQuery({ reviewer: me, status: 'requesting-review' })

/** The latest ideas with unread news, for Home's second column. */
const unreadIdeasQuery = queryOptions({
  queryKey: ['notifications', 'home'],
  queryFn: () => api.listNotifications({ unread: true, limit: 5 }),
})

export const Route = createFileRoute('/')({
  staticData: { nav: 'home' },
  loader: async ({ context: { queryClient } }) => {
    const me = await queryClient.query({ ...meQuery, staleTime: 'static' })
    await Promise.all([
      queryClient.infiniteQuery({ ...asked(me.id), staleTime: 'static' }),
      queryClient.infiniteQuery({ ...ideasQuery({ owner: me.id, state: 'open' }), staleTime: 'static' }),
      queryClient.infiniteQuery({ ...ideasQuery(), staleTime: 'static' }),
    ])
  },
  component: Home,
})

function Home() {
  const { data: me } = useSuspenseQuery(meQuery)
  const { data: memberships } = useSuspenseQuery(membershipsQuery)
  const review = useInfiniteQuery(asked(me.id))
  const mine = useInfiniteQuery(ideasQuery({ owner: me.id, state: 'open' }))
  const recent = useInfiniteQuery(ideasQuery())
  const unreadCount = useQuery(unreadQuery).data ?? 0
  const unread = useQuery(unreadIdeasQuery).data?.items ?? []

  // asked, and not approved by you yet (an approval of an older version doesn't count, so it's back)
  const waiting = (review.data?.pages.flatMap((p) => p.items) ?? []).filter(
    (row) => !row.approvals.some((a) => a.id === me.id),
  )
  const yours = (mine.data?.pages[0]?.items ?? []).slice(0, 5)
  // what changed in others' ideas: yours are above
  const others = (recent.data?.pages[0]?.items ?? []).filter((row) => row.owner.id !== me.id).slice(0, 10)

  // why each is yours to review: by name, or which of your groups
  const myGroups = new Map(memberships.groups.map((g) => [g.id, g.name]))
  const why = new Map(
    waiting.map((row) => {
      const named = row.reviewers.some((r) => r.kind === 'user' && r.user.id === me.id)
      const group = row.reviewers.find((r) => r.kind === 'group' && myGroups.has(r.group.id))
      // by name, your own face under "Review:" says so already; a group's chip doesn't say it's yours
      return [row.id, !named && group?.kind === 'group' ? `Your group ${group.group.name}` : null]
    }),
  )

  // join requests, in the teams and groups you decide them for
  const deciding = [
    ...memberships.teams
      .filter((t) => t.role !== 'member' && !t.archived)
      .map((t) => ({ kind: 'team' as const, handle: t.handle, name: t.name })),
    ...memberships.groups
      .filter((g) => g.role !== 'member')
      .map((g) => ({ kind: 'group' as const, handle: g.handle, name: g.name })),
  ]
  const requests = useQueries({ queries: deciding.map((c) => joinRequestsQuery(c.kind, c.handle)) })
    .map((q, i) => ({ container: deciding[i]!, count: q.data?.items.length ?? 0 }))
    .filter((r) => r.count > 0)

  // the obvious things to click: each leads to its list
  const summary = (
    <>
      {waiting.length > 0 ? (
        <Link href={`/ideas?reviewer=${me.handle}`}>{plural(waiting.length, 'idea')} waiting on your review</Link>
      ) : (
        'Nothing waiting on your review'
      )}
      {unreadCount > 0 && (
        <>
          {' · '}
          <Link href="/notifications?unread=true">{plural(unreadCount, 'idea')} with unread updates</Link>
        </>
      )}
    </>
  )

  return (
    <Page width="wide">
      <PageHeader title="Home" sub={summary} />
      <div className="home">
        <div className="home-main">
          <Section
            title="Waiting on your review"
            action={<Link href={`/ideas?reviewer=${me.handle}`}>See all asked of you</Link>}
          >
            <IdeaList
              ideas={waiting.map((row) => ideaInfo(row, me.id))}
              extra={(idea: IdeaInfo) => {
                const reason = why.get(idea.id)
                return reason ? <Tag tone="warn">{reason}</Tag> : null
              }}
              empty="Nothing’s waiting on you. Ideas you’re asked to review, by name or through a group, show here."
              more={
                review.hasNextPage
                  ? { loading: review.isFetchingNextPage, onMore: () => void review.fetchNextPage() }
                  : null
              }
            />
          </Section>
          <Section title="Your open ideas" action={<Link href={`/@${me.handle}`}>See all</Link>}>
            <IdeaList
              ideas={yours.map((row) => ideaInfo(row, me.id))}
              hide={{ author: true }}
              empty="No open ideas. Start one with ideaf start."
            />
          </Section>
          <Section title="Recently changed" action={<Link href="/ideas">See all</Link>}>
            <IdeaList ideas={others.map((row) => ideaInfo(row, me.id))} empty="Nothing shared with you yet." />
          </Section>
        </div>
        <aside className="home-aside" aria-label="Unread, requests and your teams">
          <HomeSide
            unread={unread.map((n) => ({
              id: n.idea.id,
              title: n.idea.title,
              href: ideaPath(n.idea.place, n.idea.number),
              count: n.newCount,
            }))}
            unreadTotal={unreadCount}
            requests={requests.map((r) => ({
              key: `${r.container.kind}:${r.container.handle}`,
              name: r.container.name,
              href:
                r.container.kind === 'team'
                  ? `/${r.container.handle}/settings?tab=requests`
                  : `/groups/${r.container.handle}/settings?tab=requests`,
              count: r.count,
            }))}
            teams={memberships.teams.filter((t) => !t.archived)}
          />
        </aside>
      </div>
    </Page>
  )
}
