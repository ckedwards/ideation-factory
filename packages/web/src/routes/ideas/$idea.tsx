// An idea's page: its latest version, one file at a time (?file=), with its
// comments. Versions and compare come in step 8's third part.
import { useState } from 'react'
import { ApiError } from '@ideaf/api'
import { markdownTree } from '@ideaf/core'
import { type CommentInfo, MarkdownView, type Person, type TeamRef, Toast } from '@ideaf/ui'
import { useMutation, useQueries, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { api, meQuery, personQuery, teamQuery } from '../../api.ts'
import { sectionAt, toPlain } from './-components/anchors.ts'
import { IdeaPage } from './-components/IdeaPage.tsx'
import { commentsQuery, filesQuery, ideaQuery, outlineQuery } from './-components/queries.ts'
import { actorOf, type FileView, place, statusOf, type Thread } from './-components/view.ts'

export const Route = createFileRoute('/ideas/$idea')({
  validateSearch: (search: Record<string, unknown>): { file?: string } =>
    typeof search['file'] === 'string' ? { file: search['file'] } : {},
  loader: async ({ context: { queryClient }, params }) => {
    try {
      const idea = await queryClient.ensureQueryData(ideaQuery(params.idea))
      await Promise.all([
        queryClient.ensureQueryData(filesQuery(params.idea, idea.latest)),
        queryClient.ensureQueryData(outlineQuery(params.idea, idea.latest)),
        queryClient.ensureQueryData(commentsQuery(params.idea, idea.latest)),
      ])
    } catch (error) {
      // missing, or not yours to see: the API doesn't say which, and neither does the page
      if (error instanceof ApiError && error.code === 'not_found') {
        throw notFound()
      }
      throw error
    }
  },
  component: IdeaRoute,
})

function IdeaRoute() {
  const { idea: id } = Route.useParams()
  const { file: path } = Route.useSearch()
  const queryClient = useQueryClient()
  const { data: idea } = useSuspenseQuery(ideaQuery(id))
  const version = idea.latest
  const { data: pulled } = useSuspenseQuery(filesQuery(id, version))
  const { data: outlines } = useSuspenseQuery(outlineQuery(id, version))
  const { data: threads } = useSuspenseQuery(commentsQuery(id, version))
  const { data: me } = useSuspenseQuery(meQuery)
  const team = useQuery({ ...teamQuery(idea.team ?? ''), enabled: idea.team !== null })
  const [problem, setProblem] = useState<string | null>(null)

  const shown = pulled.files.find((f) => f.path === path) ?? pulled.files[0]!
  const entries = outlines.find((o) => o.id === shown.file)?.entries ?? []
  const file: FileView = { id: shown.file, path: shown.path, source: shown.content, unitIds: entries.map((e) => e.id) }
  // a section's title, by its heading's ID, for what a section comment is on
  const titles = new Map(entries.flatMap((e) => (e.kind === 'heading' ? [[e.id, e.path.at(-1) ?? '']] : [])))
  const made = idea.versions.find((v) => v.number === version)
  const people = usePeople([
    idea.owner,
    ...threads.flatMap((t) => [t, ...t.replies]).map((c) => c.author.user),
    ...(made ? [made.by.user] : []),
  ])

  // after a write, the comments as they now are
  const refresh = () => queryClient.invalidateQueries({ queryKey: commentsQuery(id, version).queryKey })
  const onError = (error: Error) => {
    setProblem(
      error instanceof ApiError && error.code === 'stale_version'
        ? 'The idea has a new version. Reload to comment on it.'
        : `That didn’t work: ${error.message}`,
    )
  }
  const comment = useMutation({
    mutationFn: (input: Parameters<typeof api.addComment>[0]) => api.addComment(input),
    onSettled: refresh,
    onError,
  })
  const reply = useMutation({
    mutationFn: (input: Parameters<typeof api.reply>[0]) => api.reply(input),
    onSettled: refresh,
    onError,
  })
  const resolve = useMutation({
    mutationFn: (input: Parameters<typeof api.resolveComment>[0]) => api.resolveComment(input),
    onSettled: refresh,
    onError,
  })

  return (
    <>
      <IdeaPage
        title={idea.title}
        team={teamRef(idea, team.data, people, me.id)}
        status={statusOf(idea.status)}
        version={{
          number: version,
          by: made ? actorOf(made.by, people) : actorOf({ user: idea.owner, bot: null, purpose: 'me' }, people),
          at: made?.createdAt ?? idea.createdAt,
        }}
        files={pulled.files.map((f) => ({
          path: f.path,
          href: `/ideas/${id}?file=${encodeURIComponent(f.path)}`,
          current: f.file === file.id,
        }))}
        source={file.source}
        comments={threads.flatMap((thread) => {
          const where = place(thread, file)
          return where ? [{ info: commentInfo(thread, people, titles), place: where }] : []
        })}
        canComment={idea.you.view}
        onComment={(selection, body) => {
          const range = toPlain(file.source, selection)
          if (range) {
            comment.mutate({ idea: id, version, anchor: { kind: 'text', file: file.id, ...range }, body })
          }
        }}
        onSectionComment={(heading, body) => {
          const section = sectionAt(file.source, file.unitIds, heading)
          if (section) {
            comment.mutate({ idea: id, version, anchor: { kind: 'section', section }, body })
          }
        }}
        onReply={(thread, body) => reply.mutate({ idea: id, comment: thread, body })}
        onResolve={(thread, resolved) => resolve.mutate({ idea: id, comment: thread, resolved })}
      />
      <Toast message={problem} onDismiss={() => setProblem(null)} />
    </>
  )
}

/** The idea's team as its chip shows it; someone's own idea is "Your ideas" or "Riley Park's ideas". */
function teamRef(
  idea: { team: string | null; owner: string },
  team: { name: string; archived: boolean } | undefined,
  people: Map<string, Person>,
  me: string,
): TeamRef {
  if (idea.team === null) {
    const owner = people.get(idea.owner)
    return { name: idea.owner === me ? 'Your ideas' : `${owner?.name ?? 'Someone'}’s ideas`, personal: true }
  }
  return team ? { name: team.name, archived: team.archived } : { name: 'Team' }
}

/** The people named on the page, loaded once each and kept; someone still loading shows by ID. */
function usePeople(ids: string[]): Map<string, Person> {
  const unique = [...new Set(ids)]
  const results = useQueries({ queries: unique.map((id) => personQuery(id)) })
  return new Map(
    results.flatMap(({ data }) =>
      data ? [[data.id, { id: data.id, name: data.name, handle: data.handle, inactive: data.inactive }]] : [],
    ),
  )
}

function commentInfo(thread: Thread, people: Map<string, Person>, titles: Map<string, string>): CommentInfo {
  const anchor = thread.anchor
  return {
    id: thread.id,
    author: actorOf(thread.author, people),
    at: thread.createdAt,
    body: <MarkdownView tree={markdownTree(thread.body)} variant="compact" />,
    target:
      anchor?.kind === 'text'
        ? { kind: 'text', quote: anchor.quote }
        : anchor?.kind === 'section'
          ? { kind: 'section', title: titles.get(anchor.section) ?? 'A section' }
          : { kind: 'file' },
    resolved: thread.resolved,
    outdated: thread.state === 'outdated',
    ...(thread.lastVersion !== null ? { lastSeenIn: thread.lastVersion } : {}),
    replies: thread.replies.map((r) => ({
      id: r.id,
      author: actorOf(r.author, people),
      at: r.createdAt,
      body: <MarkdownView tree={markdownTree(r.body)} variant="compact" />,
    })),
  }
}
