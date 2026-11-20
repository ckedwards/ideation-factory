// An idea's files, read (/files) or compared (/changes/1..3): loads what the
// page shows, keeps the latest version's comments live, and writes comments
// and suggestions, and accepts and rejects them. ?view=focus shows every file
// in the focus view (FocusView), over the page. Someone with edit access can
// open the idea's draft on the latest version here and change it (editing.tsx),
// and accept suggestions into it.
// The routes say which version, which file and what to compare against.
import { useEffect, useRef, useState } from 'react'
import { type Anchor, parseMarkdown, suggestionSource } from '@ideaf/core'
import { RelativeTime, Toast } from '@ideaf/ui'
import { useLiveSuspenseQuery } from '@tanstack/react-db'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { api, meQuery } from '../../../../../api.ts'
import { sectionAt, toPlain } from './anchors.ts'
import { IdeaPage } from './IdeaPage.tsx'
import type { IdeaLinks } from './links.ts'
import { useEditing } from './editing.tsx'
import { commentsOf } from './live.ts'
import { commentsQuery, draftQuery, filesQuery, ideaQuery, outlineQuery, reviewsQuery } from './queries.ts'
import { commentInfo, commentWrites, usePeople } from './shared.tsx'
import { VersionBanner } from './VersionBanner.tsx'
import { DocToolbar } from './DocToolbar.tsx'
import { type FocusPhase, FocusView } from './FocusView.tsx'
import { actorOf, type FileView, place, type Thread } from './view.ts'

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
  /** The focus view, over the page. */
  view?: 'focus' | undefined
}

/** The version shown and the one compared against, as the idea has them: anything else is left out. */
export function versionsOf(at: { v?: number | undefined; base?: number | undefined }, latest: number) {
  const version = at.v && at.v <= latest ? at.v : latest
  return { version, base: at.base && at.base < version ? at.base : null }
}

export function IdeaView({ id, links, v, base: wantedBase, file: path, comment: opened, view }: IdeaViewProps) {
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
  const { data: me } = useSuspenseQuery(meQuery)
  const [note, setNote] = useState<string | null>(null)

  // a new version arriving while the latest is shown: the page moves on to it, and says so,
  // unless it's one this page made (committing the draft), which says so itself
  const seenLatest = useRef(latest)
  const ours = useRef(new Set<number>())
  useEffect(() => {
    if (latest > seenLatest.current && !v && !ours.current.has(latest)) {
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

  // each file of the version, and its sections' titles by their headings' IDs, for what a section comment is on
  const views = pulled.files.map((f) => {
    const entries = outlines.find((o) => o.id === f.file)?.entries ?? []
    const view: FileView = { id: f.file, path: f.path, source: f.content, unitIds: entries.map((e) => e.id) }
    const titles = new Map(entries.flatMap((e) => (e.kind === 'heading' ? [[e.id, e.path.at(-1) ?? '']] : [])))
    return { view, titles }
  })
  const shown = views.find((f) => f.view.path === path) ?? views[0]!
  const file = shown.view
  const titles = shown.titles
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
  // a selection in a file as a text anchor, in the plain text comments are matched in
  const anchorIn = (
    at: FileView,
    selection: { start: number; end: number },
  ): Extract<Anchor, { kind: 'text' }> | null => {
    const range = toPlain(at.source, selection)
    if (!range) {
      return null
    }
    const quote = parseMarkdown(at.source).plain.text.slice(range.start, range.end)
    return { kind: 'text', file: at.id, ...range, quote }
  }
  // what a suggestion there replaces: the same widening the server does
  const suggestionIn = (at: FileView, selection: { start: number; end: number }) => {
    const anchor = anchorIn(at, selection)
    const one = { files: [{ id: at.id, path: at.path, source: at.source, unitIds: at.unitIds }], nextId: 0 }
    const found = anchor ? suggestionSource(one, anchor) : null
    return found?.ok ? found.old : null
  }
  const anchorOf = (selection: { start: number; end: number }) => anchorIn(file, selection)
  const suggestionOf = (selection: { start: number; end: number }) => suggestionIn(file, selection)
  const suggestIn = (
    at: FileView,
    selection: { start: number; end: number },
    replacement: string,
    body: string,
    pending: boolean,
  ) => {
    const anchor = anchorIn(at, selection)
    const old = suggestionIn(at, selection)
    if (anchor && old !== null) {
      writes.suggest(anchor, old, replacement, body, pending)
    }
  }
  /** Adds suggestions to the draft: committing it makes the version. */
  const addToDraft = (suggestions: string[]) => {
    void api.acceptSuggestions({ idea: id, suggestions }).then(
      (done) => {
        setNote(['Added to the draft.', ...done.skipped.map((s) => `${s.id} stays open: ${s.message}.`)].join(' '))
        void queryClient.invalidateQueries({ queryKey: draftQuery(id).queryKey, exact: true })
      },
      (error: unknown) => setNote(`That didn’t work: ${error instanceof Error ? error.message : String(error)}`),
    )
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

  // the focus view: open while the address says so, and not while editing or comparing. Opening it
  // here carries the text into it; its address opened directly shows it at once
  const focusing = view === 'focus' && base === null && !editing
  const [focusPhase, setFocusPhase] = useState<FocusPhase | null>(focusing ? 'still' : null)
  // each time it opens is a new one, so leaving and opening again don't share a half-run animation
  const [openings, setOpenings] = useState(0)
  const wasFocusing = useRef(focusing)
  // the file it was opened on from here: leaving on that file is going Back
  const enteredOn = useRef<string | null>(null)
  useEffect(() => {
    if (focusing && !wasFocusing.current) {
      setOpenings((n) => n + 1)
      setFocusPhase('entering')
    } else if (!focusing && wasFocusing.current) {
      setFocusPhase((was) => (was === null ? null : 'leaving'))
    }
    wasFocusing.current = focusing
  }, [focusing])
  // back to the button that opened it, once focus view's gone and the page can be reached again
  const returnFocus = useRef(false)
  useEffect(() => {
    if (focusPhase === null && returnFocus.current) {
      returnFocus.current = false
      window.document.querySelector<HTMLElement>('.doc-toolbar-focus')?.focus()
    }
  }, [focusPhase])
  const threadActions = {
    canComment: idea.you.view && !older,
    canDecide: idea.you.edit && !older,
    addToReview: true,
    onReply: writes.reply,
    onDelete: writes.remove,
    onResolve: writes.resolve,
    onAddToDraft: addToDraft,
    onReject: writes.reject,
  }
  const draftChanges = draft.data?.changes ?? []
  const drafters = [...new Set(draftChanges.map((c) => people.get(c.by.user)?.name ?? 'someone'))]

  return (
    <>
      <IdeaPage
        opened={opened}
        editing={editor}
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
              range={{
                versions: [...idea.versions].reverse().map((n) => n.number),
                onRange: (v, b) => {
                  const at = v === latest ? undefined : v
                  void navigate({ href: b === null ? links.files({ v: at, file: path }) : links.changes(b, at, path) })
                },
              }}
              source={showSource}
              onSource={setShowSource}
              edit={
                canEdit
                  ? {
                      label: draftChanges.length > 0 ? 'Open the draft' : 'Edit',
                      disabled: !draft.data,
                      onEdit: () => setEditing(true),
                    }
                  : null
              }
              editing={editing}
              onFocusView={
                base === null && !editing
                  ? () => {
                      enteredOn.current = file.path
                      void navigate({ href: links.files({ v: shownV, file: file.path, view: 'focus' }) })
                    }
                  : undefined
              }
            />
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
        onSuggest={(selection, replacement, body, pending) => suggestIn(file, selection, replacement, body, pending)}
        onAddToDraft={addToDraft}
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
      {focusPhase && (
        <FocusView
          key={openings}
          title={idea.title}
          version={
            <>
              v{version}
              {' · '}
              <RelativeTime at={at} />
            </>
          }
          pages={views.map(({ view: at, titles: named }) => ({
            id: at.id,
            path: at.path,
            source: at.source,
            // its open threads, in the version being read
            comments: threads.flatMap((thread) => {
              const where = place(thread, at)
              const info = where && where.kind !== 'outdated' ? commentInfo(thread, people, named, drafted) : null
              return where && info && !info.resolved
                ? [{ info, place: where, pending: thread.id.startsWith('pending-') }]
                : []
            }),
          }))}
          file={file.path}
          phase={focusPhase}
          onExit={(leaving) => {
            if (enteredOn.current === leaving) {
              window.history.back()
            } else {
              void navigate({ href: links.files({ v: shownV, file: leaving }), replace: true })
            }
            enteredOn.current = null
          }}
          onOpened={() => setFocusPhase((was) => (was === 'entering' ? 'open' : was))}
          onLeft={() => {
            setFocusPhase(null)
            returnFocus.current = true
          }}
          actions={threadActions}
          suggestionOf={(page, selection) => {
            const at = views.find((f) => f.view.id === page)?.view
            return at ? suggestionIn(at, selection) : null
          }}
          onComment={(page, selection, body, pending) => {
            const at = views.find((f) => f.view.id === page)?.view
            const anchor = at ? anchorIn(at, selection) : null
            if (anchor) {
              writes.comment(anchor, body, pending)
            }
          }}
          onSuggest={(page, selection, replacement, body, pending) => {
            const at = views.find((f) => f.view.id === page)?.view
            if (at) {
              suggestIn(at, selection, replacement, body, pending)
            }
          }}
        />
      )}
      {/* the editor's words and actions, in the idea's bar while it's open */}
      {editor?.bar}
      <Toast message={note} onDismiss={() => setNote(null)} />
    </>
  )
}
