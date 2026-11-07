// An idea's files, read (/files) or compared (/changes/1..3): loads what the
// page shows, keeps the latest version's comments live, and writes comments.
// The routes say which version, which file and what to compare against.
import { useEffect, useRef, useState } from 'react'
import { parseMarkdown } from '@ideaf/core'
import { Toast } from '@ideaf/ui'
import { useLiveSuspenseQuery } from '@tanstack/react-db'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { meQuery, teamQuery } from '../../../../../api.ts'
import { sectionAt, toPlain } from './anchors.ts'
import { IdeaPage } from './IdeaPage.tsx'
import { IdeaTabs } from './IdeaTabs.tsx'
import type { IdeaLinks } from './links.ts'
import { commentsOf } from './live.ts'
import { commentsQuery, filesQuery, ideaQuery, outlineQuery } from './queries.ts'
import { commentInfo, commentWrites, teamRef, usePeople } from './shared.tsx'
import { VersionBanner } from './VersionBanner.tsx'
import { actorOf, type FileView, place, statusOf, type Thread } from './view.ts'

export interface IdeaViewProps {
  id: string
  links: IdeaLinks
  /** The version shown; without it, the latest, following new ones as they come. */
  v?: number | undefined
  /** Comparing: the version the changes are since. */
  base?: number | undefined
  file?: string | undefined
}

/** The version shown and the one compared against, as the idea has them: anything else is left out. */
export function versionsOf(at: { v?: number | undefined; base?: number | undefined }, latest: number) {
  const version = at.v && at.v <= latest ? at.v : latest
  return { version, base: at.base && at.base < version ? at.base : null }
}

export function IdeaView({ id, links, v, base: wantedBase, file: path }: IdeaViewProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: idea } = useSuspenseQuery(ideaQuery(id))
  const latest = idea.latest
  const { version, base } = versionsOf({ v, base: wantedBase }, latest)
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
    if (latest > seenLatest.current && !v) {
      setNote(`v${latest} just came in: now showing it.`)
    }
    seenLatest.current = latest
  }, [latest, v])

  const shown = pulled.files.find((f) => f.path === path) ?? pulled.files[0]!
  const entries = outlines.find((o) => o.id === shown.file)?.entries ?? []
  const file: FileView = { id: shown.file, path: shown.path, source: shown.content, unitIds: entries.map((e) => e.id) }
  // a section's title, by its heading's ID, for what a section comment is on
  const titles = new Map(entries.flatMap((e) => (e.kind === 'heading' ? [[e.id, e.path.at(-1) ?? '']] : [])))
  const made = idea.versions.find((n) => n.number === version)
  const people = usePeople([
    idea.owner,
    ...threads.flatMap((t) => [t, ...t.replies]).map((c) => c.author.user),
    ...idea.versions.map((n) => n.by.user),
  ])
  const writes = commentWrites(comments, me.id, version, setNote)
  const by = made ? actorOf(made.by, people) : actorOf({ user: idea.owner, bot: null, purpose: 'me' }, people)
  const at = made?.createdAt ?? idea.createdAt
  // the version in a link: none for the latest, so the link follows new ones
  const shownV = older ? version : undefined
  const baseFile = base !== null ? baseFiles.data?.files.find((f) => f.file === file.id) : undefined

  return (
    <>
      <IdeaPage
        title={idea.title}
        team={teamRef(idea, team.data, people, me.id)}
        status={statusOf(idea.status)}
        version={{ number: version, by, at }}
        tabs={
          <IdeaTabs
            current={base !== null ? 'changes' : 'files'}
            overview={links.overview}
            files={links.files({ file: path })}
            changes={latest > 1 ? links.changes(latest - 1, undefined, path) : null}
          />
        }
        files={pulled.files.map((f) => {
          const before = baseFiles.data?.files.find((b) => b.file === f.file)
          return {
            path: f.path,
            href: base !== null ? links.changes(base, shownV, f.path) : links.files({ v: shownV, file: f.path }),
            current: f.file === file.id,
            ...(base !== null && baseFiles.data ? { changed: before?.hash !== f.hash } : {}),
          }
        })}
        source={file.source}
        compare={base !== null && baseFiles.data ? { base, source: baseFile?.content ?? '' } : null}
        banner={
          base !== null ? (
            <VersionBanner
              kind="compare"
              version={version}
              base={base}
              stopHref={links.files({ v: shownV, file: path })}
            />
          ) : older ? (
            <VersionBanner
              kind="older"
              version={version}
              latest={latest}
              by={by}
              at={at}
              latestHref={links.files({ file: path })}
              changesHref={links.changes(version, undefined, path)}
            />
          ) : null
        }
        versions={{
          versions: [...idea.versions].reverse().map((n) => ({
            number: n.number,
            by: actorOf(n.by, people),
            at: n.createdAt,
            how: n.how,
            steps: n.steps,
          })),
          viewing: version,
          latest,
          base,
          viewHref: (n) => links.files({ v: n === latest ? undefined : n, file: path }),
          compareHref: (b) => links.changes(b, shownV, path),
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
            writes.comment({ kind: 'text', file: file.id, ...range, quote }, body)
          }
        }}
        onSectionComment={(heading, body) => {
          const section = sectionAt(file.source, file.unitIds, heading)
          if (section) {
            writes.comment({ kind: 'section', file: file.id, section }, body)
          }
        }}
        onReply={writes.reply}
        onResolve={writes.resolve}
        onViewInVersion={(n) => void navigate({ href: links.files({ v: n, file: path }) })}
      />
      <Toast message={note} onDismiss={() => setNote(null)} />
    </>
  )
}
