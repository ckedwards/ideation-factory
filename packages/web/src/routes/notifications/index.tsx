// Your notifications (/notifications): the ideas you hear about, one row per
// idea, newest first; the inbox, or (?done) the ones you've cleared. A column
// beside them filters, each with how many: the inbox, what's unread, done, why
// you hear about them, and which team they're in.
import { type Caller, ideaPath, type Notification } from '@ideaf/api'
import { Link, Page, PageHeader } from '@ideaf/ui'
import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { api, meQuery } from '../../api.ts'
import { statusOf } from '../../ideas.ts'
import { actorOf } from '../$place/idea/$number/-components/view.ts'
import { usePeople } from '../$place/idea/$number/-components/shared.tsx'
import { InboxList, type InboxRowView } from './-components/InboxList.tsx'

type Reason = Notification['reason']
type Filter = { done: boolean; reason?: Reason | undefined; unread: boolean; team?: string | undefined }

export const notificationsQuery = (filter: Filter) =>
  infiniteQueryOptions({
    queryKey: ['notifications', filter],
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      api.listNotifications({
        ...(filter.done ? { done: true } : {}),
        ...(filter.reason ? { reason: filter.reason } : {}),
        ...(filter.team ? { team: filter.team } : {}),
        ...(filter.unread ? { unread: true } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.next,
  })

const WHY: Record<Reason, string> = {
  author: 'Author',
  'review-requested': 'Review requested',
  'group-review': 'Via a group',
  participating: 'Participating',
  subscribed: 'Subscribed',
  watching: 'Watching a team',
}

/** How many of each, for the filter column. */
const countsQuery = queryOptions({
  queryKey: ['notifications', 'counts'],
  queryFn: () => api.countNotifications({}),
})

export const Route = createFileRoute('/notifications/')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { done?: true; reason?: Reason; unread?: true; team?: string } => ({
    ...(search['done'] === true || search['done'] === 'true' ? { done: true as const } : {}),
    ...(typeof search['reason'] === 'string' && search['reason'] in WHY ? { reason: search['reason'] as Reason } : {}),
    ...(typeof search['team'] === 'string' && search['team'] ? { team: search['team'] } : {}),
    ...(search['unread'] === true || search['unread'] === 'true' ? { unread: true as const } : {}),
  }),
  staticData: { nav: 'notifications' },
  component: Notifications,
})

function Notifications() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const queryClient = useQueryClient()
  const { data: me } = useSuspenseQuery(meQuery)
  const filter: Filter = {
    done: search.done === true,
    reason: search.reason,
    unread: search.unread === true,
    team: search.team,
  }
  const counts = useQuery(countsQuery).data
  const list = useInfiniteQuery(notificationsQuery(filter))
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  const people = usePeople(items.flatMap((n) => (n.latest.actor.user ? [n.latest.actor.user] : [])))
  const go = (next: Partial<Filter>) => {
    const f = { ...filter, ...next }
    void navigate({
      search: {
        ...(f.done ? { done: true as const } : {}),
        ...(f.reason ? { reason: f.reason } : {}),
        ...(f.unread ? { unread: true as const } : {}),
        ...(f.team ? { team: f.team } : {}),
      },
      replace: true,
    })
  }
  const mark = (change: { read?: true; done?: boolean }) => (ids: string[] | null) =>
    void api
      .markNotifications({ ...(ids ? { ideas: ids } : {}), ...change })
      .finally(() => void queryClient.invalidateQueries({ queryKey: ['notifications'] }))

  const rows = items.map((n): InboxRowView => ({
    id: n.idea.id,
    title: n.idea.title,
    href: ideaPath(n.idea.place, n.idea.number),
    where: n.idea.team ? n.idea.team.name : n.idea.owner.id === me.id ? 'Your ideas' : `${n.idea.owner.name}’s ideas`,
    status: statusOf(n.idea.status),
    reason: WHY[n.reason],
    asked: n.reason === 'review-requested' || n.reason === 'group-review',
    kind: n.latest.kind,
    actor: n.latest.actor.user ? actorOf(n.latest.actor as Caller, people) : null,
    update: updateWords(n),
    newCount: n.newCount,
    at: n.updatedAt,
  }))

  return (
    <Page width="wide">
      <PageHeader title="Notifications" sub="What’s happened to the ideas you hear about, one row each." />
      <div className="inbox-layout">
        <nav className="inbox-side" aria-label="Show">
          <ul>
            <Choice
              label="Inbox"
              count={counts?.all}
              current={!filter.done && !filter.unread && !filter.reason && !filter.team}
              onPick={() => go({ done: false, unread: false, reason: undefined, team: undefined })}
            />
            <Choice
              label="Unread"
              count={counts?.unread}
              current={!filter.done && filter.unread}
              onPick={() => go({ done: false, unread: true })}
            />
            <Choice label="Done" current={filter.done} onPick={() => go({ done: true, unread: false })} />
          </ul>
          <h3>Why</h3>
          <ul>
            {(Object.entries(WHY) as Array<[Reason, string]>)
              .filter(([reason]) => (counts?.reasons[reason] ?? 0) > 0 || filter.reason === reason)
              .map(([reason, label]) => (
                <Choice
                  key={reason}
                  label={label}
                  count={counts?.reasons[reason]}
                  current={filter.reason === reason}
                  asked={reason === 'review-requested' || reason === 'group-review'}
                  onPick={() => go({ reason: filter.reason === reason ? undefined : reason })}
                />
              ))}
          </ul>
          {(counts?.teams.length ?? 0) > 0 && (
            <>
              <h3>Teams</h3>
              <ul>
                {counts!.teams.map((t) => (
                  <Choice
                    key={t.id}
                    label={t.name}
                    count={t.count}
                    current={filter.team === t.handle}
                    onPick={() => go({ team: filter.team === t.handle ? undefined : t.handle })}
                  />
                ))}
              </ul>
            </>
          )}
        </nav>
        <InboxList
          rows={rows}
          showing={filter.done ? 'done' : 'inbox'}
          onRead={mark({ read: true })}
          onDone={mark({ done: true })}
          onBack={mark({ done: false })}
          empty={filter.done ? 'Nothing marked done.' : 'Nothing new. You’re all caught up.'}
          more={list.hasNextPage ? { loading: list.isFetchingNextPage, onMore: () => void list.fetchNextPage() } : null}
        />
      </div>
    </Page>
  )
}

/** One of the filters down the side, with how many it has; choosing the current one again clears it. */
function Choice(props: {
  label: string
  count?: number | undefined
  current: boolean
  asked?: boolean
  onPick: () => void
}) {
  return (
    <li>
      <Link
        href="#"
        className={`inbox-choice${props.asked ? ' is-asked' : ''}`}
        aria-current={props.current ? 'true' : undefined}
        onClick={(event) => {
          event.preventDefault()
          props.onPick()
        }}
      >
        <span>{props.label}</span>
        {props.count !== undefined && props.count > 0 && <span className="inbox-choice-count">{props.count}</span>}
      </Link>
    </li>
  )
}

/** The latest update, in words (after who did it). */
function updateWords(n: Notification): string {
  const { kind, detail, actor } = n.latest
  const said = typeof detail.body === 'string' && detail.body ? `: “${detail.body}”` : ''
  switch (kind) {
    case 'version':
      return `made v${String(detail.version)}`
    case 'comment':
      return `commented${said}`
    case 'suggestion':
      return `suggested an edit${said}`
    case 'reply':
      return `replied${said}`
    case 'review':
      return detail.verdict === 'approve'
        ? 'approved it'
        : detail.verdict === 'reject'
          ? 'rejected it'
          : 'requested changes'
    case 'dismissed':
      return 'dismissed a review'
    case 'status':
      return `moved it to ${String(detail.status).replace(/-/g, ' ')}`
    case 'decided':
      return detail.decision === 'accepted' ? 'accepted a suggestion' : 'rejected a suggestion'
    case 'requested':
      return actor.user ? 'asked for your review' : 'Its team’s rules asked for your review'
    default:
      return 'updated it'
  }
}
