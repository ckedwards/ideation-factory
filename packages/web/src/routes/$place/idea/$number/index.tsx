// An idea's overview: what it is, its reviews, and everything that happened
// to it, with its comments, status and verdicts live.
import { useState } from 'react'
import { ApiError } from '@ideaf/api'
import { Toast } from '@ideaf/ui'
import { useLiveSuspenseQuery } from '@tanstack/react-db'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { api, meQuery, teamQuery } from '../../../../api.ts'
import { type ActivityItem, IdeaOverview } from './-components/IdeaOverview.tsx'
import { IdeaTabs } from './-components/IdeaTabs.tsx'
import { ideaLinks } from './-components/links.ts'
import { commentsOf } from './-components/live.ts'
import { filesQuery, ideaQuery, outlineQuery, reviewsQuery } from './-components/queries.ts'
import { ReviewPanel, type ReviewRow } from './-components/ReviewPanel.tsx'
import { type Subject, subjectKey, useSubjectNames } from './-components/subjects.ts'
import { commentInfo, commentWrites, teamRef, usePeople } from './-components/shared.tsx'
import { actorOf, statusOf } from './-components/view.ts'

export const Route = createFileRoute('/$place/idea/$number/')({
  loader: async ({ context: { queryClient, idea } }) => {
    const summary = await queryClient.query({ ...ideaQuery(idea), staleTime: 'static' })
    await Promise.all([
      queryClient.query({ ...filesQuery(idea, summary.latest), staleTime: 'static' }),
      queryClient.query({ ...outlineQuery(idea, summary.latest), staleTime: 'static' }),
      commentsOf(idea, queryClient).preload(),
      queryClient.query(reviewsQuery(idea)),
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
            onReview={(verdict, body) =>
              send(() => api.reviewIdea({ idea: id, version: reviews.latest, verdict, ...(body ? { body } : {}) }))
            }
            onDismiss={(reviewer, reason) => send(() => api.dismissReview({ idea: id, reviewer, reason }))}
          />
        }
        sharingHref={links.sharing}
        activity={activity}
        canComment={idea.you.view}
        onReply={writes.reply}
        onResolve={writes.resolve}
      />
      <Toast message={note} onDismiss={() => setNote(null)} />
    </>
  )
}
