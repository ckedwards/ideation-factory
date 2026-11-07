// An idea's overview: what it is, and everything that happened to it, with
// its comments live.
import { useState } from 'react'
import { Toast } from '@ideaf/ui'
import { useLiveSuspenseQuery } from '@tanstack/react-db'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { meQuery, teamQuery } from '../../../../api.ts'
import { type ActivityItem, IdeaOverview } from './-components/IdeaOverview.tsx'
import { IdeaTabs } from './-components/IdeaTabs.tsx'
import { ideaLinks } from './-components/links.ts'
import { commentsOf } from './-components/live.ts'
import { filesQuery, ideaQuery, outlineQuery } from './-components/queries.ts'
import { commentInfo, commentWrites, teamRef, usePeople } from './-components/shared.tsx'
import { actorOf, statusOf } from './-components/view.ts'

export const Route = createFileRoute('/$place/idea/$number/')({
  loader: async ({ context: { queryClient, idea } }) => {
    const summary = await queryClient.query({ ...ideaQuery(idea), staleTime: 'static' })
    await Promise.all([
      queryClient.query({ ...filesQuery(idea, summary.latest), staleTime: 'static' }),
      queryClient.query({ ...outlineQuery(idea, summary.latest), staleTime: 'static' }),
      commentsOf(idea, queryClient).preload(),
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
  const team = useQuery({ ...teamQuery(idea.team ?? ''), enabled: idea.team !== null })
  const [note, setNote] = useState<string | null>(null)
  const people = usePeople([
    idea.owner,
    ...threads.flatMap((t) => [t, ...t.replies]).map((c) => c.author.user),
    ...idea.versions.map((v) => v.by.user),
  ])
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
        activity={activity}
        canComment={idea.you.view}
        onReply={writes.reply}
        onResolve={writes.resolve}
      />
      <Toast message={note} onDismiss={() => setNote(null)} />
    </>
  )
}
