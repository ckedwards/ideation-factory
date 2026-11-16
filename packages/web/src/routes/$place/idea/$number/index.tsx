// An idea's overview: what it is, its reviews, and everything that happened
// to it, with its comments, status and verdicts live.
import { useState } from 'react'
import { ApiError } from '@ideaf/api'
import { parseMarkdown } from '@ideaf/core'
import { requirementWords } from '../../../../ideas.ts'
import { Toast } from '@ideaf/ui'
import { useLiveSuspenseQuery } from '@tanstack/react-db'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { api, meQuery, teamQuery } from '../../../../api.ts'
import { type ActivityItem, IdeaOverview } from './-components/IdeaOverview.tsx'
import { IdeaTabs } from './-components/IdeaTabs.tsx'
import { ideaLinks } from './-components/links.ts'
import { rereadComments } from './-components/comments.ts'
import { commentsOf } from './-components/live.ts'
import {
  filesQuery,
  ideaQuery,
  loadIdeaPage,
  outlineQuery,
  reviewsQuery,
  subscriptionQuery,
} from './-components/queries.ts'
import { SubscribeButton } from './-components/SubscribeButton.tsx'
import {
  CloseOrReopen,
  IdeaStatus,
  ReviewPanel,
  type ReviewPanelProps,
  type ReviewRow,
} from './-components/ReviewPanel.tsx'
import { type Subject, subjectKey, useSubjectNames } from './-components/subjects.ts'
import { commentInfo, commentWrites, teamRef, usePeople } from './-components/shared.tsx'
import { actorOf, statusOf } from './-components/view.ts'

export const Route = createFileRoute('/$place/idea/$number/')({
  loader: async ({ context: { queryClient, idea } }) => {
    // the page in one read, then anything it didn't fill (an idea loaded already)
    await Promise.all([loadIdeaPage(queryClient, idea), commentsOf(idea, queryClient).preload()])
    const summary = await queryClient.query({ ...ideaQuery(idea), staleTime: 'static' })
    await Promise.all([
      queryClient.query({ ...filesQuery(idea, summary.latest), staleTime: 'static' }),
      queryClient.query({ ...outlineQuery(idea, summary.latest), staleTime: 'static' }),
      queryClient.query({ ...reviewsQuery(idea), staleTime: 5_000 }),
    ])
  },
  component: Overview,
})

function Overview() {
  const { idea: id, place, number } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const links = ideaLinks(place, number)
  const { data: idea } = useSuspenseQuery(ideaQuery(id))
  const { data: pulled } = useSuspenseQuery(filesQuery(id, idea.latest))
  const { data: outlines } = useSuspenseQuery(outlineQuery(id, idea.latest))
  const comments = commentsOf(id, queryClient)
  const { data: threads } = useLiveSuspenseQuery((q) =>
    q.from({ thread: comments }).orderBy(({ thread }) => thread.createdAt, 'asc'),
  )
  const { data: me } = useSuspenseQuery(meQuery)
  const { data: reviews } = useSuspenseQuery(reviewsQuery(id))
  const subscription = useQuery(subscriptionQuery(id))
  const [subscribing, setSubscribing] = useState(false)
  const team = useQuery({ ...teamQuery(idea.team ?? ''), enabled: idea.team !== null })
  const [note, setNote] = useState<string | null>(null)
  const people = usePeople([
    idea.owner,
    ...threads.flatMap((t) => [t, ...t.replies]).map((c) => c.author.user),
    ...idea.versions.map((v) => v.by.user),
    ...reviews.reviews.flatMap((r) => [r.by.user, ...(r.dismissed ? [r.dismissed.by.user] : [])]),
    ...reviews.history.map((h) => h.by.user),
    ...reviews.requests.flatMap((r) => (r.by ? [r.by] : [])),
  ])
  const asked = reviews.reviewers.filter(
    (s): s is Extract<Subject, { kind: 'user' | 'group' }> => s.kind === 'user' || s.kind === 'group',
  )
  const names = useSubjectNames(asked)
  const reread = () => {
    void queryClient.invalidateQueries({ queryKey: reviewsQuery(id).queryKey, exact: true })
    void queryClient.invalidateQueries({ queryKey: ideaQuery(id).queryKey, exact: true })
  }
  /** Sends a write, reading the reviews again after; its error goes to the form that sent it. */
  const send = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } finally {
      reread()
    }
  }
  const noted = (fn: () => Promise<unknown>) =>
    void send(fn).catch((error: unknown) => setNote(error instanceof ApiError ? error.message : String(error)))
  const writes = commentWrites(comments, me.id, idea.latest, setNote)
  // section titles across every file, for what a section comment is on
  const titles = new Map(
    outlines.flatMap((o) => o.entries.flatMap((e) => (e.kind === 'heading' ? [[e.id, e.path.at(-1) ?? '']] : []))),
  )
  const pathOf = (fileId: string | undefined) => pulled.files.find((f) => f.file === fileId)?.path ?? null
  /** The sections some text is in ("Proposal › Conflicts"), from where it starts in the file's plain text. */
  const sectionOf = (fileId: string, start: number): string | null => {
    const source = pulled.files.find((f) => f.file === fileId)?.content
    const entries = outlines.find((o) => o.id === fileId)?.entries
    if (source === undefined || !entries) {
      return null
    }
    const { unit } = parseMarkdown(source).plain
    // the unit the text starts in (past the line breaks between units)
    let index = -1
    for (let i = start; i < unit.length && index < 0; i++) {
      index = unit[i]!
    }
    let path = index >= 0 ? (entries[index]?.path ?? []) : []
    // a document's own title (its level-one heading) says nothing the idea's doesn't
    const title = entries.find((e) => e.kind === 'heading' && e.level === 1)
    if (path.length > 1 && title && path[0] === title.path[0]) {
      path = path.slice(1)
    }
    return path.length > 0 ? path.join(' › ') : null
  }
  const first = idea.versions[0]

  const activity: ActivityItem[] = [
    ...idea.versions.map((v): ActivityItem => ({
      kind: 'version',
      number: v.number,
      by: actorOf(v.by, people),
      at: v.createdAt,
      how: v.how,
      steps: v.steps,
      href: links.files({ v: v.number === idea.latest ? undefined : v.number }),
      changesHref: v.number > 1 ? links.changes(v.number - 1, v.number) : null,
    })),
    // the first is how it was created, which its first version already says
    // who was asked to review, when, and by whom (or by the team's rules)
    ...reviews.requests.flatMap((r): ActivityItem[] =>
      r.subject.kind === 'user' || r.subject.kind === 'group'
        ? [
            {
              kind: 'requested',
              at: r.at,
              by: r.by ? actorOf({ user: r.by, bot: null, purpose: 'me' }, people) : null,
              who: names.get(subjectKey(r.subject))?.label ?? '…',
            },
          ]
        : [],
    ),
    // each reviewer's latest verdict, when they gave it
    ...reviews.reviews.map((r): ActivityItem => ({
      kind: 'review',
      at: r.at,
      by: actorOf(r.by, people),
      verdict: r.verdict,
      version: r.version,
      body: r.body,
      dismissed: r.dismissed ? { by: actorOf(r.dismissed.by, people), reason: r.dismissed.reason } : null,
    })),
    ...reviews.history.slice(1).map((h, i): ActivityItem => ({
      kind: 'status',
      at: h.at,
      status: statusOf(h.status),
      by: actorOf(h.by, people),
      note: h.note,
      reopened: !h.status.startsWith('closed') && (reviews.history[i]?.status.startsWith('closed') ?? false),
    })),
    ...threads.map((thread): ActivityItem => {
      const file = pathOf(thread.anchor?.file)
      const info = commentInfo(thread, people, titles)
      // where the text is, while it's still there
      const section =
        info.target.kind === 'text' && thread.anchor?.kind === 'text' && thread.state !== 'outdated'
          ? sectionOf(thread.anchor.file, thread.anchor.start)
          : null
      return {
        kind: 'comment',
        at: thread.createdAt,
        comment: {
          info: section && info.target.kind === 'text' ? { ...info, target: { ...info.target, section } } : info,
          place: { kind: 'file' },
          pending: thread.id.startsWith('pending-'),
        },
        file,
        // the comment where it is, not the top of the file
        href: links.files({ ...(file ? { file } : {}), comment: thread.id }),
      }
    }),
  ].sort((a, b) => a.at - b.at)

  // the review: its panel, the status in the header, and closing it
  const review: ReviewPanelProps = {
    status: statusOf(reviews.status),
    latest: reviews.latest,
    reviewers: asked.map((s) => ({
      key: subjectKey(s),
      subject: s,
      label: names.get(subjectKey(s))?.label ?? '…',
    })),
    reviews: reviews.reviews.map((r): ReviewRow => ({
      ...r,
      by: actorOf(r.by, people),
      dismissed: r.dismissed ? { ...r.dismissed, by: actorOf(r.dismissed.by, people) } : null,
    })),
    requirements: reviews.requirements.checks.map(requirementWords),
    canEdit: idea.you.edit,
    canReview: idea.owner !== me.id,
    onAsk: idea.you.share
      ? (subject, ask) => send(() => api.setReviewer({ idea: id, subject, reviewer: ask }))
      : undefined,
    onStatus: (status) =>
      noted(() =>
        api.setStatus({
          idea: id,
          // ui's words, as the api's
          status: status.replace(/ /g, '-') as 'draft' | 'requesting-review' | 'changes-in-progress',
        }),
      ),
    onClose: (reason, note) => send(() => api.closeIdea({ idea: id, reason, ...(note ? { note } : {}) })),
    onReopen: () => noted(() => api.reopenIdea({ idea: id })),
    pending: reviews.pending,
    onReview: (verdict, body) =>
      send(async () => {
        await api.reviewIdea({
          idea: id,
          version: reviews.latest,
          ...(verdict ? { verdict } : {}),
          ...(body ? { body } : {}),
        })
        // your pending comments are out now
        await rereadComments(id)
      }),
    onDiscard: () =>
      noted(async () => {
        await api.discardReview({ idea: id })
        await rereadComments(id)
      }),
    onDismiss: (reviewer, reason) => send(() => api.dismissReview({ idea: id, reviewer, reason })),
  }

  return (
    <>
      <IdeaOverview
        title={idea.title}
        team={teamRef(idea, team.data, people, me.id)}
        status={statusOf(idea.status)}
        startedBy={actorOf(first?.by ?? { user: idea.owner, bot: null, purpose: 'me' }, people)}
        startedAt={idea.createdAt}
        description={idea.description}
        tabs={<IdeaTabs current="overview" overview={links.overview} files={links.files()} />}
        statusControl={<IdeaStatus {...review} />}
        actions={<CloseOrReopen {...review} />}
        review={<ReviewPanel {...review} />}
        sharingHref={links.sharing}
        subscribe={
          subscription.data && (
            <SubscribeButton
              subscribed={subscription.data.subscribed}
              reason={subscription.data.reason}
              busy={subscribing}
              onChange={(subscribed) => {
                setSubscribing(true)
                api
                  .setSubscription({ idea: id, subscribed })
                  .then((now) => queryClient.setQueryData(subscriptionQuery(id).queryKey, now))
                  .catch((error: unknown) => setNote(error instanceof Error ? error.message : String(error)))
                  .finally(() => setSubscribing(false))
              }}
            />
          )
        }
        activity={activity}
        canComment={idea.you.view}
        onReply={writes.reply}
        onResolve={writes.resolve}
      />
      <Toast message={note} onDismiss={() => setNote(null)} />
    </>
  )
}
