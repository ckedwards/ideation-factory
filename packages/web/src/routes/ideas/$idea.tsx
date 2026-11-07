// An idea's page, one file at a time (?file=). The latest version by default,
// with its comments live; an older one with ?v= (read only); and with
// ?compare= the changes since an earlier version, as a redline. Everything the
// page shows is in its URL, so every view is a link.
import { useEffect, useRef, useState } from 'react'
import { ApiError } from '@ideaf/api'
import { markdownTree, parseMarkdown } from '@ideaf/core'
import { type CommentInfo, MarkdownView, type Person, type TeamRef, Toast } from '@ideaf/ui'
import { useLiveSuspenseQuery } from '@tanstack/react-db'
import { type QueryClient, useQueries, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router'
import { api, meQuery, personQuery, teamQuery } from '../../api.ts'
import { accessToken } from '../../session.ts'
import { sectionAt, toPlain } from './-components/anchors.ts'
import { type CommentsCollection, commentsCollection, pendingId } from './-components/comments.ts'
import { IdeaPage } from './-components/IdeaPage.tsx'
import { commentsQuery, filesQuery, ideaQuery, outlineQuery } from './-components/queries.ts'
import { VersionBanner } from './-components/VersionBanner.tsx'
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
      // a new version: read the idea again, and the latest view moves on to it
      onVersion: () => void queryClient.invalidateQueries({ queryKey: ideaQuery(idea).queryKey, exact: true }),
    })
    collections.set(idea, found)
  }
  return found
}

interface Search {
  file?: string
  /** The version shown; the latest without it. */
  v?: number
  /** The version compared against: the page shows what changed since. */
  compare?: number
}

const positive = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isInteger(n) && n > 0 ? n : null
}

/** The version shown and the one compared against, as the idea has them: anything else is left out. */
function versionsOf(
  search: { v?: number | undefined; compare?: number | undefined },
  latest: number,
): { version: number; base: number | null } {
  const version = search.v && search.v <= latest ? search.v : latest
  return { version, base: search.compare && search.compare < version ? search.compare : null }
}

export const Route = createFileRoute('/ideas/$idea')({
  validateSearch: (search: Record<string, unknown>): Search => {
    const v = positive(search['v'])
    const compare = positive(search['compare'])
    return {
      ...(typeof search['file'] === 'string' ? { file: search['file'] } : {}),
      ...(v ? { v } : {}),
      ...(compare ? { compare } : {}),
    }
  },
  loaderDeps: ({ search }) => ({ v: search.v, compare: search.compare }),
  loader: async ({ context: { queryClient }, params, deps }) => {
    try {
      const idea = await queryClient.ensureQueryData(ideaQuery(params.idea))
      const { version, base } = versionsOf(deps, idea.latest)
      await Promise.all([
        queryClient.ensureQueryData(filesQuery(params.idea, version)),
        queryClient.ensureQueryData(outlineQuery(params.idea, version)),
        commentsOf(params.idea, queryClient).preload(),
        version < idea.latest ? queryClient.ensureQueryData(commentsQuery(params.idea, version)) : null,
        base ? queryClient.ensureQueryData(filesQuery(params.idea, base)) : null,
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
  const search = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: idea } = useSuspenseQuery(ideaQuery(id))
  const latest = idea.latest
  const { version, base } = versionsOf(search, latest)
  const older = version < latest
  const { data: pulled } = useSuspenseQuery(filesQuery(id, version))
  const { data: outlines } = useSuspenseQuery(outlineQuery(id, version))
  const baseFiles = useQuery({ ...filesQuery(id, base ?? 0), enabled: base !== null })
  const comments = commentsOf(id, queryClient)
  // the latest version's comments are live; an older one's are as they were read
  const { data: live } = useLiveSuspenseQuery((q) =>
    q.from({ thread: comments }).orderBy(({ thread }) => thread.createdAt, 'asc'),
  )
  const asOf = useQuery({ ...commentsQuery(id, version), enabled: older })
  const threads: Thread[] = older ? (asOf.data ?? []) : live
  const { data: me } = useSuspenseQuery(meQuery)
  const team = useQuery({ ...teamQuery(idea.team ?? ''), enabled: idea.team !== null })
  const [note, setNote] = useState<string | null>(null)

  // a new version arriving while the latest is shown: the page moves on to it, and says so
  const seenLatest = useRef(latest)
  useEffect(() => {
    if (latest > seenLatest.current && !search.v) {
      setNote(`v${latest} just came in: now showing it.`)
    }
    seenLatest.current = latest
  }, [latest, search.v])

  const shown = pulled.files.find((f) => f.path === search.file) ?? pulled.files[0]!
  const entries = outlines.find((o) => o.id === shown.file)?.entries ?? []
  const file: FileView = { id: shown.file, path: shown.path, source: shown.content, unitIds: entries.map((e) => e.id) }
  // a section's title, by its heading's ID, for what a section comment is on
  const titles = new Map(entries.flatMap((e) => (e.kind === 'heading' ? [[e.id, e.path.at(-1) ?? '']] : [])))
  const made = idea.versions.find((v) => v.number === version)
  const people = usePeople([
    idea.owner,
    ...threads.flatMap((t) => [t, ...t.replies]).map((c) => c.author.user),
    ...idea.versions.map((v) => v.by.user),
  ])

  /** A link to a view of this idea; the file stays unless it's changed. */
  const href = (to: Search) => {
    const query = new URLSearchParams()
    if (to.file ?? search.file) {
      query.set('file', (to.file ?? search.file)!)
    }
    if (to.v && to.v !== latest) {
      query.set('v', String(to.v))
    }
    if (to.compare) {
      query.set('compare', String(to.compare))
    }
    const rest = query.toString()
    return `/ideas/${id}${rest ? `?${rest}` : ''}`
  }

  // a write shows at once; if the server refuses it, it goes away and the page says why
  const settle = (tx: { when(state: 'settled'): Promise<unknown> }) =>
    tx
      .when('settled')
      .catch((error: unknown) =>
        setNote(
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
  const baseFile = base !== null ? baseFiles.data?.files.find((f) => f.file === file.id) : undefined
  const by = made ? actorOf(made.by, people) : actorOf({ user: idea.owner, bot: null, purpose: 'me' }, people)
  const at = made?.createdAt ?? idea.createdAt

  return (
    <>
      <IdeaPage
        title={idea.title}
        team={teamRef(idea, team.data, people, me.id)}
        status={statusOf(idea.status)}
        version={{ number: version, by, at }}
        files={pulled.files.map((f) => {
          const before = baseFiles.data?.files.find((b) => b.file === f.file)
          return {
            path: f.path,
            href: href({ file: f.path, v: version, ...(base ? { compare: base } : {}) }),
            current: f.file === file.id,
            ...(base !== null && baseFiles.data ? { changed: before?.hash !== f.hash } : {}),
          }
        })}
        source={file.source}
        compare={base !== null && baseFiles.data ? { base, source: baseFile?.content ?? '' } : null}
        banner={
          base !== null ? (
            <VersionBanner kind="compare" version={version} base={base} stopHref={href({ v: version })} />
          ) : older ? (
            <VersionBanner
              kind="older"
              version={version}
              latest={latest}
              by={by}
              at={at}
              latestHref={href({})}
              changesHref={href({ compare: version })}
            />
          ) : null
        }
        versions={{
          versions: [...idea.versions].reverse().map((v) => ({
            number: v.number,
            by: actorOf(v.by, people),
            at: v.createdAt,
            how: v.how,
            steps: v.steps,
          })),
          viewing: version,
          latest,
          base,
          viewHref: (n) => href({ v: n }),
          compareHref: (b) => href({ v: version, compare: b }),
        }}
        comments={threads.flatMap((thread) => {
          const where = place(thread, file)
          return where
            ? [{ info: commentInfo(thread, people, titles), place: where, pending: thread.id.startsWith('pending-') }]
            : []
        })}
        // comments go on the latest version only
        canComment={idea.you.view && !older}
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
        onViewInVersion={(n) => void navigate({ href: href({ v: n }) })}
      />
      <Toast message={note} onDismiss={() => setNote(null)} />
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
