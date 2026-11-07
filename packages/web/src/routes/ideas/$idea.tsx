// An idea's page: its latest version, one file at a time (?file=), with its
// comments live. Versions and compare come in step 8's third part.
import { useState } from 'react'
import { ApiError } from '@ideaf/api'
import { markdownTree, parseMarkdown } from '@ideaf/core'
import { type CommentInfo, MarkdownView, type Person, type TeamRef, Toast } from '@ideaf/ui'
import { useLiveSuspenseQuery } from '@tanstack/react-db'
import { type QueryClient, useQueries, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { api, meQuery, personQuery, teamQuery } from '../../api.ts'
import { accessToken } from '../../session.ts'
import { sectionAt, toPlain } from './-components/anchors.ts'
import { type CommentsCollection, commentsCollection, pendingId } from './-components/comments.ts'
import { IdeaPage } from './-components/IdeaPage.tsx'
import { filesQuery, ideaQuery, outlineQuery } from './-components/queries.ts'
import { actorOf, type FileView, place, statusOf, type Thread } from './-components/view.ts'

/** Each idea's live comments, kept while the page is open and for a minute after (the collection's gcTime). */
const collections = new Map<string, CommentsCollection>()
function commentsOf(idea: string, queryClient: QueryClient): CommentsCollection {
  let found = collections.get(idea)
  if (!found) {
    found = commentsCollection(idea, {
      api,
      open: (path) => new WebSocket(`${location.origin.replace(/^http/, 'ws')}${path}`),
      token: accessToken,
      // a new version: read the idea again, and the page moves on to it
      onVersion: () => void queryClient.invalidateQueries({ queryKey: ideaQuery(idea).queryKey, exact: true }),
    })
    collections.set(idea, found)
  }
  return found
}

export const Route = createFileRoute('/ideas/$idea')({
  validateSearch: (search: Record<string, unknown>): { file?: string } =>
    typeof search['file'] === 'string' ? { file: search['file'] } : {},
  loader: async ({ context: { queryClient }, params }) => {
    try {
      const idea = await queryClient.ensureQueryData(ideaQuery(params.idea))
      await Promise.all([
        queryClient.ensureQueryData(filesQuery(params.idea, idea.latest)),
        queryClient.ensureQueryData(outlineQuery(params.idea, idea.latest)),
        commentsOf(params.idea, queryClient).preload(),
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
  const comments = commentsOf(id, queryClient)
  const { data: threads } = useLiveSuspenseQuery((q) =>
    q.from({ thread: comments }).orderBy(({ thread }) => thread.createdAt, 'asc'),
  )
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

  // a write shows at once; if the server refuses it, it goes away and the page says why
  const settle = (tx: { when(state: 'settled'): Promise<unknown> }) =>
    tx
      .when('settled')
      .catch((error: unknown) =>
        setProblem(
          error instanceof ApiError && error.code === 'stale_version'
            ? 'The idea has a new version. Read it, then comment again.'
            : `That didn’t work: ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
  const caller = { user: me.id, bot: null, purpose: 'me' as const }
  const newThread = (anchor: Thread['anchor'], body: string): Thread => ({
    id: pendingId(),
    author: caller,
    createdAt: Date.now(),
    body,
    version,
    resolved: false,
    state: 'exact',
    anchor,
    lastVersion: version,
    addressedIn: [],
    replies: [],
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
          return where
            ? [{ info: commentInfo(thread, people, titles), place: where, pending: thread.id.startsWith('pending-') }]
            : []
        })}
        canComment={idea.you.view}
        onComment={(selection, body) => {
          const range = toPlain(file.source, selection)
          if (range) {
            const quote = parseMarkdown(file.source).plain.text.slice(range.start, range.end)
            void settle(comments.insert(newThread({ kind: 'text', file: file.id, ...range, quote }, body)))
          }
        }}
        onSectionComment={(heading, body) => {
          const section = sectionAt(file.source, file.unitIds, heading)
          if (section) {
            void settle(comments.insert(newThread({ kind: 'section', file: file.id, section }, body)))
          }
        }}
        onReply={(thread, body) =>
          void settle(
            comments.update(thread, (draft) => {
              draft.replies.push({ id: pendingId(), author: caller, createdAt: Date.now(), body, version })
            }),
          )
        }
        onResolve={(thread, resolved) =>
          void settle(
            comments.update(thread, (draft) => {
              draft.resolved = resolved
            }),
          )
        }
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
