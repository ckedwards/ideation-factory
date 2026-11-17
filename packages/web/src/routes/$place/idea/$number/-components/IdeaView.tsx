// An idea's files, read (/files) or compared (/changes/1..3): loads what the
// page shows, keeps the latest version's comments live, and writes comments
// and suggestions, and accepts and rejects them. Someone with edit access can
// open the idea's draft on the latest version here and change it (editing.tsx),
// and accept suggestions into it.
// The routes say which version, which file and what to compare against.
import { useEffect, useRef, useState } from 'react'
import { ApiError } from '@ideaf/api'
import { type Anchor, type DraftChange, parseMarkdown, suggestionSource } from '@ideaf/core'
import { Button, Dialog, Toast } from '@ideaf/ui'
import { useLiveSuspenseQuery } from '@tanstack/react-db'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { api, meQuery, teamQuery } from '../../../../../api.ts'
import { SiteLinks } from '../../../../../components/SiteLinks.tsx'
import { sectionAt, toPlain } from './anchors.ts'
import { IdeaPage } from './IdeaPage.tsx'
import { IdeaTabs } from './IdeaTabs.tsx'
import type { IdeaLinks } from './links.ts'
import { describe, useEditing } from './editing.tsx'
import { commentsOf } from './live.ts'
import { commentsQuery, draftQuery, filesQuery, ideaQuery, outlineQuery, reviewsQuery } from './queries.ts'
import { commentInfo, commentWrites, teamRef, usePeople } from './shared.tsx'
import { VersionBanner } from './VersionBanner.tsx'
import { DocToolbar } from './DocToolbar.tsx'
import { actorOf, type FileView, place, statusOf, type Thread } from './view.ts'

export interface IdeaViewProps {
  id: string
  links: IdeaLinks
  /** The version shown; without it, the latest, following new ones as they come. */
  v?: number | undefined
  /** Comparing: the version the changes are since. */
  base?: number | undefined
  file?: string | undefined
  /** A comment to open where it is: active, and its text scrolled to. */
  comment?: string | undefined
}

/** The version shown and the one compared against, as the idea has them: anything else is left out. */
export function versionsOf(at: { v?: number | undefined; base?: number | undefined }, latest: number) {
  const version = at.v && at.v <= latest ? at.v : latest
  return { version, base: at.base && at.base < version ? at.base : null }
}

export function IdeaView({ id, links, v, base: wantedBase, file: path, comment: opened }: IdeaViewProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: idea } = useSuspenseQuery(ideaQuery(id))
  const latest = idea.latest
  const [editing, setEditing] = useState(false)
  const [showSource, setShowSource] = useState(false)
  const wanted = versionsOf({ v, base: wantedBase }, latest)
  const version = wanted.version
  const base = editing ? null : wanted.base
  const older = version < latest
  // the idea's draft, for people who can edit it
  const draft = useQuery({ ...draftQuery(id), enabled: idea.you.edit })
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
  // your review, not submitted yet: comments and replies only you see
  const pendingCount = threads.flatMap((t) => [t, ...t.replies]).filter((c) => c.pending).length
  const { data: me } = useSuspenseQuery(meQuery)
  const team = useQuery({ ...teamQuery(idea.team ?? ''), enabled: idea.team !== null })
  const [note, setNote] = useState<string | null>(null)

  // a new version arriving while the latest is shown: the page moves on to it, and says so,
  // unless it's one this page made (accepting suggestions, committing the draft), which says so itself
  const seenLatest = useRef(latest)
  const accepting = useRef(0)
  const ours = useRef(new Set<number>())
  useEffect(() => {
    if (latest > seenLatest.current && !v && accepting.current === 0 && !ours.current.has(latest)) {
      setNote(`v${latest} just came in: now showing it.`)
    }
    seenLatest.current = latest
  }, [latest, v])

  // you've opened this version's document: reviewers' state says which version each has seen
  useEffect(() => {
    api
      .markSeen({ idea: id, version })
      .then(() => queryClient.invalidateQueries({ queryKey: reviewsQuery(id).queryKey, exact: true }))
      .catch(() => {})
  }, [id, version, queryClient])

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
    ...(draft.data?.changes.map((c) => c.by.user) ?? []),
  ])
  const writes = commentWrites(comments, me.id, version, setNote)
  const by = made ? actorOf(made.by, people) : actorOf({ user: idea.owner, bot: null, purpose: 'me' }, people)
  const at = made?.createdAt ?? idea.createdAt
  // the version in a link: none for the latest, so the link follows new ones
  const shownV = older ? version : undefined
  const baseFile = base !== null ? baseFiles.data?.files.find((f) => f.file === file.id) : undefined
  // a selection as a text anchor, in the plain text comments are matched in
  const anchorOf = (selection: { start: number; end: number }): Extract<Anchor, { kind: 'text' }> | null => {
    const range = toPlain(file.source, selection)
    if (!range) {
      return null
    }
    const quote = parseMarkdown(file.source).plain.text.slice(range.start, range.end)
    return { kind: 'text', file: file.id, ...range, quote }
  }
  // what a suggestion there replaces: the same widening the server does
  const suggestionOf = (selection: { start: number; end: number }) => {
    const anchor = anchorOf(selection)
    const one = { files: [{ id: file.id, path: file.path, source: file.source, unitIds: file.unitIds }], nextId: 0 }
    const found = anchor ? suggestionSource(one, anchor) : null
    return found?.ok ? found.old : null
  }
  /** Accepts suggestions as a version now, or into the draft. */
  // accepting as a version that would make changes in the draft outdated: asked first
  const [outdating, setOutdating] = useState<{ suggestions: string[]; changes: string[] } | null>(null)
  const accept = (suggestions: string[], into: 'version' | 'draft' = 'version', outdateDraft = false) => {
    accepting.current++
    void api
      .acceptSuggestions({ idea: id, suggestions, into, ...(outdateDraft ? { outdateDraft } : {}) })
      .then(
        (done) => {
          if (done.version !== null) {
            ours.current.add(done.version)
          }
          const said = done.version !== null ? `Accepted as v${done.version}.` : 'Added to the draft.'
          setNote([said, ...done.skipped.map((s) => `${s.id} stays open: ${s.message}.`)].join(' '))
          void queryClient.invalidateQueries({ queryKey: draftQuery(id).queryKey, exact: true })
        },
        (error: unknown) => {
          if (error instanceof ApiError && error.code === 'draft_outdated') {
            const { changes } = error.details as { changes: Array<{ change: DraftChange; by: { user: string } }> }
            setOutdating({
              suggestions,
              changes: changes.map((c) => `${describe(c.change)} · ${people.get(c.by.user)?.name ?? 'someone'}`),
            })
            return
          }
          setNote(`That didn’t work: ${error instanceof Error ? error.message : String(error)}`)
        },
      )
      .finally(() => accepting.current--)
  }

  // the suggestions in the draft, live, for people who can read it
  const drafted = draft.data
    ? new Set(draft.data.changes.flatMap((c) => (c.change.kind === 'suggestion' ? [c.change.comment] : [])))
    : undefined
  const editor = useEditing({
    idea: id,
    draft: draft.data,
    open: editing,
    setOpen: setEditing,
    file: file.id,
    latestFiles: pulled.files,
    threads,
    people,
    onNote: setNote,
    onCommitted: (committed) => {
      ours.current.add(committed)
      setNote(`Committed as v${committed}.`)
    },
  })
  const canEdit = idea.you.edit && !older && base === null && !editing
  const draftChanges = draft.data?.changes ?? []
  const drafters = [...new Set(draftChanges.map((c) => people.get(c.by.user)?.name ?? 'someone'))]

  return (
    <>
      <IdeaPage
        site={<SiteLinks />}
        opened={opened}
        editing={editor}
        title={idea.title}
        team={teamRef(idea, team.data, people, me.id)}
        status={statusOf(idea.status)}
        version={{ number: version, by, at }}
        tabs={<IdeaTabs current="files" overview={links.overview} files={links.files({ file: path })} />}
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
        showSource={showSource}
        banner={
          <>
            {!editing && (
              <DocToolbar
                path={file.path}
                version={version}
                latest={latest}
                compare={base !== null ? { base, stopHref: links.files({ v: shownV, file: path }) } : null}
                compareWith={[...idea.versions]
                  .reverse()
                  .filter((n) => n.number !== version)
                  .map((n) => ({ version: n.number, href: links.changes(n.number, shownV, path) }))}
                onCompare={(href) => void navigate({ href })}
                source={showSource}
                onSource={setShowSource}
                review={
                  !older && (idea.owner !== me.id || pendingCount > 0)
                    ? { href: links.overview, pending: pendingCount }
                    : null
                }
                edit={
                  canEdit
                    ? {
                        label: draftChanges.length > 0 ? 'Open the draft' : 'Edit',
                        disabled: !draft.data,
                        onEdit: () => setEditing(true),
                      }
                    : null
                }
              />
            )}
            {canEdit && draftChanges.length > 0 ? (
              <p className="idea-edit-start">
                The draft has {draftChanges.length === 1 ? '1 change' : `${draftChanges.length} changes`}, by{' '}
                {drafters.join(', ')}.
              </p>
            ) : base === null && older ? (
              <VersionBanner
                kind="older"
                version={version}
                latest={latest}
                by={by}
                at={at}
                latestHref={links.files({ file: path })}
                changesHref={links.changes(version, undefined, path)}
              />
            ) : null}
          </>
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
          onRange: (v, b) => {
            const at = v === latest ? undefined : v
            void navigate({ href: b === null ? links.files({ v: at, file: path }) : links.changes(b, at, path) })
          },
        }}
        comments={threads.flatMap((thread) => {
          const where = place(thread, file)
          return where
            ? [
                {
                  info: commentInfo(thread, people, titles, drafted),
                  place: where,
                  pending: thread.id.startsWith('pending-'),
                },
              ]
            : []
        })}
        // comments go on the latest version only, and so do decisions on suggestions
        canComment={idea.you.view && !older}
        canDecide={idea.you.edit && !older}
        addToReview
        onComment={(selection, body, pending) => {
          const anchor = anchorOf(selection)
          if (anchor) {
            writes.comment(anchor, body, pending)
          }
        }}
        suggestionOf={suggestionOf}
        onSuggest={(selection, replacement, body, pending) => {
          const anchor = anchorOf(selection)
          const old = suggestionOf(selection)
          if (anchor && old !== null) {
            writes.suggest(anchor, old, replacement, body, pending)
          }
        }}
        onAccept={(ids) => accept(ids)}
        onAddToDraft={(ids) => accept(ids, 'draft')}
        onReject={writes.reject}
        onFileComment={(body, pending) => writes.comment({ kind: 'file', file: file.id }, body, pending)}
        onSectionComment={(heading, body, pending) => {
          const section = sectionAt(file.source, file.unitIds, heading)
          if (section) {
            writes.comment({ kind: 'section', file: file.id, section }, body, pending)
          }
        }}
        onReply={writes.reply}
        onDelete={writes.remove}
        onResolve={writes.resolve}
        onViewInVersion={(n) => void navigate({ href: links.files({ v: n, file: path }) })}
      />
      <Dialog
        open={outdating !== null}
        title="This would make the draft’s changes outdated"
        onClose={() => setOutdating(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOutdating(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                accept(outdating?.suggestions ?? [], 'version', true)
                setOutdating(null)
              }}
            >
              Accept anyway
            </Button>
          </>
        }
      >
        <p>
          {outdating?.changes.length === 1
            ? 'Accepting it as a new version changes text this change in the idea’s draft was made on. It’d be outdated, and committing the draft would wait until it’s undone or redone. Adding the suggestion to the draft instead keeps it.'
            : 'Accepting it as a new version changes text these changes in the idea’s draft were made on. They’d be outdated, and committing the draft would wait until they’re undone or redone. Adding the suggestion to the draft instead keeps them.'}
        </p>
        <ul>
          {outdating?.changes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </Dialog>
      <Toast message={note} onDismiss={() => setNote(null)} />
    </>
  )
}
