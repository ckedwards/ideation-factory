// An idea's overview: what it is, its reviews, and everything that happened
// to it, with its comments, status and verdicts live.
import { useState } from 'react'
import { ApiError, type Operations, type Output } from '@ideaf/api'
import { type RequirementCheck, Toast } from '@ideaf/ui'
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
import { ReviewPanel, type ReviewRow } from './-components/ReviewPanel.tsx'
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
      return {
        kind: 'comment',
        at: thread.createdAt,
        comment: {
          info: commentInfo(thread, people, titles),
          place: { kind: 'file' },
          pending: thread.id.startsWith('pending-'),
        },
        file,
        href: links.files(file ? { file } : {}),
      }
    }),
  ].sort((a, b) => a.at - b.at)

  return (
    <>
      <IdeaOverview
        title={idea.title}
        team={teamRef(idea, team.data, people, me.id)}
        status={statusOf(idea.status)}
        startedBy={actorOf(first?.by ?? { user: idea.owner, bot: null, purpose: 'me' }, people)}
        startedAt={idea.createdAt}
        description={idea.description}
        tabs={
          <IdeaTabs
            current="overview"
            overview={links.overview}
            files={links.files()}
            changes={idea.latest > 1 ? links.changes(idea.latest - 1) : null}
          />
        }
        review={
          <ReviewPanel
            status={statusOf(reviews.status)}
            latest={reviews.latest}
            reviewers={asked.map((s) => ({
              key: subjectKey(s),
              subject: s,
              label: names.get(subjectKey(s))?.label ?? '…',
            }))}
            reviews={reviews.reviews.map((r): ReviewRow => ({
              ...r,
              by: actorOf(r.by, people),
              dismissed: r.dismissed ? { ...r.dismissed, by: actorOf(r.dismissed.by, people) } : null,
            }))}
            requirements={reviews.requirements.checks.map(requirementWords)}
            canEdit={idea.you.edit}
            canReview={idea.owner !== me.id}
            onAsk={
              idea.you.share
                ? (subject, ask) => send(() => api.setReviewer({ idea: id, subject, reviewer: ask }))
                : undefined
            }
            onStatus={(status) =>
              noted(() =>
                api.setStatus({
                  idea: id,
                  // ui's words, as the api's
                  status: status.replace(/ /g, '-') as 'draft' | 'requesting-review' | 'changes-in-progress',
                }),
              )
            }
            onClose={(reason, note) => send(() => api.closeIdea({ idea: id, reason, ...(note ? { note } : {}) }))}
            onReopen={() => noted(() => api.reopenIdea({ idea: id }))}
            pending={reviews.pending}
            onReview={(verdict, body) =>
              send(async () => {
                await api.reviewIdea({
                  idea: id,
                  version: reviews.latest,
                  ...(verdict ? { verdict } : {}),
                  ...(body ? { body } : {}),
                })
                // your pending comments are out now
                await rereadComments(id)
              })
            }
            onDiscard={() =>
              noted(async () => {
                await api.discardReview({ idea: id })
                await rereadComments(id)
              })
            }
            onDismiss={(reviewer, reason) => send(() => api.dismissReview({ idea: id, reviewer, reason }))}
          />
        }
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

type Check = Output<Operations['listReviews']>['requirements']['checks'][number]

/** A requirement, checked, as ui's RequirementList shows it. */
function requirementWords(check: Check): RequirementCheck {
  if (check.kind === 'approvals') {
    return {
      text: check.need === 1 ? '1 approval from a person' : `${check.need} approvals from people`,
      met: check.met,
      ...(check.met ? {} : { progress: `${check.have} so far` }),
    }
  }
  if (check.kind === 'resolved') {
    return {
      text: 'Every discussion resolved',
      met: check.met,
      ...(check.met ? {} : { progress: `${check.open} open` }),
    }
  }
  const names = check.groups.map((g) => (g.deleted ? `${g.name} (deleted)` : g.name)).join(', ')
  return {
    text: `An approval from ${check.mode === 'each' ? 'each of' : 'any of'} ${names}`,
    met: check.met,
    ...(check.broken ? { broken: true } : {}),
    ...(!check.met && check.mode === 'each' && !check.broken
      ? { progress: `${check.groups.filter((g) => g.approvedBy.length > 0).length} of ${check.groups.length}` }
      : {}),
  }
}
