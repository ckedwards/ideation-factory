// An idea's overview: its files and details, what it is, everything that
// happened to it, and its review, with its comments, status and verdicts live.
// The idea's frame (route.tsx) has its title, status and actions above it.
import { useState } from 'react'
import { parseMarkdown } from '@ideaf/core'
import { Toast } from '@ideaf/ui'
import { useLiveSuspenseQuery } from '@tanstack/react-db'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { meQuery, teamQuery } from '../../../../api.ts'
import { type ActivityItem, IdeaOverview } from './-components/IdeaOverview.tsx'
import { ideaLinks } from './-components/links.ts'
import { commentsOf } from './-components/live.ts'
import { filesQuery, ideaQuery, loadIdeaPage, outlineQuery, reviewsQuery } from './-components/queries.ts'
import { ReviewPanel } from './-components/ReviewPanel.tsx'
import { useReview } from './-components/review.tsx'
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
  const review = useReview(id, setNote)
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
      const onIdea = thread.anchor?.kind === 'idea'
      const file = thread.anchor && thread.anchor.kind !== 'idea' ? pathOf(thread.anchor.file) : null
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
        // the comment where it is, not the top of the file; one on the idea is here already
        href: onIdea ? null : links.files({ ...(file ? { file } : {}), comment: thread.id }),
      }
    }),
  ].sort((a, b) => a.at - b.at)

  return (
    <>
      <IdeaOverview
        files={pulled.files.map((f) => ({ path: f.path, href: links.files({ file: f.path }) }))}
        team={teamRef(idea, team.data, people, me.id)}
        startedBy={actorOf(first?.by ?? { user: idea.owner, bot: null, purpose: 'me' }, people)}
        startedAt={idea.createdAt}
        latest={{
          number: idea.latest,
          at: idea.versions.find((v) => v.number === idea.latest)?.createdAt ?? idea.createdAt,
        }}
        address={links.overview.replace(/^\//, '')}
        description={idea.description}
        review={<ReviewPanel {...review} />}
        activity={activity}
        canComment={idea.you.view}
        onReply={writes.reply}
        onResolve={writes.resolve}
        onComment={(body, pending) => writes.comment({ kind: 'idea' }, body, pending)}
        addToReview={idea.owner !== me.id}
      />
      <Toast message={note} onDismiss={() => setNote(null)} />
    </>
  )
}
