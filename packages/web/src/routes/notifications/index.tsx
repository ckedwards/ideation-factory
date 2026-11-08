// Your notifications (/notifications): the ideas you hear about, one row per
// idea, newest first; the inbox, or (?done) the ones you've cleared. Filter
// by why you hear about them, or to those with something new.
import { type Caller, ideaPath, type Notification } from '@ideaf/api'
import { Page, PageHeader, SegmentedControl, Select, Stack } from '@ideaf/ui'
import { infiniteQueryOptions, useInfiniteQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { api, meQuery } from '../../api.ts'
import { statusOf } from '../../ideas.ts'
import { actorOf } from '../$place/idea/$number/-components/view.ts'
import { usePeople } from '../$place/idea/$number/-components/shared.tsx'
import { InboxList, type InboxRowView } from './-components/InboxList.tsx'

type Reason = Notification['reason']
type Filter = { done: boolean; reason?: Reason | undefined; unread: boolean }

export const notificationsQuery = (filter: Filter) =>
  infiniteQueryOptions({
    queryKey: ['notifications', filter],
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      api.listNotifications({
        ...(filter.done ? { done: true } : {}),
        ...(filter.reason ? { reason: filter.reason } : {}),
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

const REASONS = [
  { value: 'all', label: 'Every reason' },
  ...(Object.entries(WHY) as Array<[Reason, string]>).map(([value, label]) => ({ value, label })),
]

export const Route = createFileRoute('/notifications/')({
  validateSearch: (search: Record<string, unknown>): { done?: true; reason?: Reason; unread?: true } => ({
    ...(search['done'] === true || search['done'] === 'true' ? { done: true as const } : {}),
    ...(typeof search['reason'] === 'string' && search['reason'] in WHY ? { reason: search['reason'] as Reason } : {}),
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
  const filter: Filter = { done: search.done === true, reason: search.reason, unread: search.unread === true }
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
    actor: n.latest.actor.user ? actorOf(n.latest.actor as Caller, people) : null,
    update: updateWords(n),
    newCount: n.newCount,
    at: n.updatedAt,
  }))

  return (
    <Page>
      <PageHeader title="Notifications" sub="What’s happened to the ideas you hear about, one row each." />
      <Stack gap={4}>
        <div className="inbox-filters">
          <SegmentedControl
            label="Inbox or done"
            options={[
              { value: 'inbox', label: 'Inbox' },
              { value: 'done', label: 'Done' },
            ]}
            value={filter.done ? 'done' : 'inbox'}
            onChange={(v) => go({ done: v === 'done' })}
          />
          <Select
            aria-label="Why you hear about it"
            options={REASONS}
            value={filter.reason ?? 'all'}
            onChange={(v) => go({ reason: v === 'all' ? undefined : (v as Reason) })}
          />
          <label className="inbox-unread">
            <input type="checkbox" checked={filter.unread} onChange={(e) => go({ unread: e.target.checked })} />
            Unread only
          </label>
        </div>
        <InboxList
          rows={rows}
          showing={filter.done ? 'done' : 'inbox'}
          onRead={mark({ read: true })}
          onDone={mark({ done: true })}
          onBack={mark({ done: false })}
          empty={filter.done ? 'Nothing marked done.' : 'Nothing new. You’re all caught up.'}
          more={list.hasNextPage ? { loading: list.isFetchingNextPage, onMore: () => void list.fetchNextPage() } : null}
        />
      </Stack>
    </Page>
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
