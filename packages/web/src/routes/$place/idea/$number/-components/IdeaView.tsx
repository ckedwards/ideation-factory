// An idea's files, read (/files) or compared (/changes/1..3): loads what the
// page shows, keeps the latest version's comments live, and writes comments
// and suggestions, and accepts and rejects them. ?view=focus shows every file
// in the focus view (FocusView), over the page. Someone with edit access can
// open the idea's draft on the latest version here and change it (editing.tsx),
// and accept suggestions into it.
// The routes say which version, which file and what to compare against.
import { useCallback, useEffect, useRef, useState } from 'react'
import { type Anchor, parseMarkdown, suggestionSource } from '@ideaf/core'
import { type FileTreeFile, type NameBox, RelativeTime, type RowMenuItem, Toast } from '@ideaf/ui'
import { useLiveSuspenseQuery } from '@tanstack/react-db'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { api, meQuery } from '../../../../../api.ts'
import { blockAt, blockLabel, sectionAt, toPlain } from './anchors.ts'
import { IdeaPage } from './IdeaPage.tsx'
import type { IdeaLinks } from './links.ts'
import { useEditing } from './editing.tsx'
import { commentsOf } from './live.ts'
import { commentsQuery, draftQuery, filesQuery, ideaQuery, outlineQuery, reviewsQuery } from './queries.ts'
import { commentInfo, commentWrites, usePeople } from './shared.tsx'
import { VersionBanner } from './VersionBanner.tsx'
import { DocToolbar } from './DocToolbar.tsx'
import { CommentBox } from './CommentBox.tsx'
import { FileLine } from './FileLine.tsx'
import { useClosedFolders } from './closed-folders.ts'
import { useFileActions } from './file-actions.tsx'
import { FileNameDialog } from './FileNameDialog.tsx'
import { type FocusPhase, FocusView } from './FocusView.tsx'
import { actorOf, type FileView, personOf, place, type Thread } from './view.ts'

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
  // on the latest version, they see its files as the draft has them: new, renamed and deleted ones too
  const drafting = idea.you.edit && !older && base === null && draft.data ? draft.data : null
  const [closedFolders, setClosedFolders] = useClosedFolders(id)
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
  // a note at the bottom of the page, and something to do about it ("See it")
  const [toast, setToast] = useState<{ message: string; action?: { label: string; onAction: () => void } } | null>(null)
  const setNote = useCallback((message: string | null) => setToast(message === null ? null : { message }), [])

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

  // each file of the version, its sections' titles by their headings' IDs and its blocks' kinds by
  // theirs, for what a section's or a block's comment is on
  const views = pulled.files.map((f) => {
    const entries = outlines.find((o) => o.id === f.file)?.entries ?? []
    const view: FileView = { id: f.file, path: f.path, source: f.content, unitIds: entries.map((e) => e.id) }
    const titles = new Map(entries.map((e) => [e.id, e.kind === 'heading' ? (e.path.at(-1) ?? '') : blockLabel(e)]))
    return { view, titles }
  })
  // the file at the path; or one the draft has there (renamed to it, or new, so not in the version); or
  // the one this address showed last, renamed since (by someone else, while it was open)
  const remembered = useRef<{ path: string | undefined; id: string } | null>(null)
  const last = remembered.current
  const was = last && last.path === path ? last.id : null
  const inDraft =
    drafting?.files.find((f) => f.path === path) ??
    drafting?.deleted.find((d) => d.path === path) ??
    (was ? (drafting?.files.find((f) => f.file === was) ?? drafting?.deleted.find((d) => d.file === was)) : undefined)
  const shown =
    views.find((f) => f.view.path === path) ??
    (inDraft
      ? (views.find((f) => f.view.id === inDraft.file) ?? {
          view: { id: inDraft.file, path: inDraft.path, source: '', unitIds: [] },
          titles: new Map<string, string>(),
        })
      : views[0]!)
  // a file only the draft has: it can only be shown in the draft
  const onlyInDraft = !views.some((f) => f.view.id === shown.view.id)
  const file = shown.view
  // its path in the draft, where it's been renamed: what its line says, and where the address goes
  const draftPath =
    drafting?.files.find((f) => f.file === file.id)?.path ?? drafting?.deleted.find((d) => d.file === file.id)?.path
  const titles = shown.titles
  const made = idea.versions.find((n) => n.number === version)
  const people = usePeople([
    idea.owner,
    ...threads.flatMap((t) => [t, ...t.replies]).map((c) => c.author.user),
    ...idea.versions.flatMap((n) => [n.by, ...n.authors].map((c) => c.user)),
    ...(draft.data?.changes.flatMap((c) => c.authors.map((a) => a.user)) ?? []),
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
  // the file's line: its path, its comments as a whole, and commenting on it (on the latest version,
  // not while comparing), the box opening under it
  const [fileBox, setFileBox] = useState(false)
  const onFile = threads.filter((t) => t.anchor?.kind === 'file' && t.anchor.file === file.id)
  const files = useFileActions({
    idea: id,
    draft: drafting,
    threads,
    me: me.id,
    nameOf: (user) => people.get(user)?.name ?? 'Someone',
    openDraft: () => setEditing(true),
    showFile: (to) => void navigate({ href: links.files({ file: to }) }),
    shown: file.path,
    onNote: setToast,
  })
  // the file's own ⋯, on its line here and on each page of the focus view; and the name box for it
  const [naming, setNaming] = useState<NameBox | null>(null)
  const fileMenu = (fileId: string): RowMenuItem[] | undefined => {
    const actions = files.actions
    if (!actions || !drafting) {
      return undefined
    }
    if (drafting.deleted.some((d) => d.file === fileId)) {
      return [{ label: 'Restore', onSelect: () => actions.onRestore(fileId) }]
    }
    return [
      { label: 'Rename', onSelect: () => setNaming({ kind: 'rename', file: fileId }) },
      {
        label: 'Delete',
        danger: true,
        onSelect: () => actions.onDelete(fileId),
        ...(drafting.files.length <= 1 ? { unavailable: 'An idea keeps at least one file.' } : {}),
      },
    ]
  }
  const fileLine = (
    <>
      <FileLine
        path={draftPath ?? file.path}
        version={version !== latest ? version : undefined}
        count={onFile.filter((t) => !t.resolved).length}
        onComment={idea.you.view && !older && base === null ? () => setFileBox(true) : undefined}
        menu={fileMenu(file.id)}
      />
      {fileBox && (
        <div className="file-line-box">
          <CommentBox
            label="Comment on the whole file"
            addToReview
            onComment={(body, pending) => writes.comment({ kind: 'file', file: file.id }, body, pending)}
            onCancel={() => setFileBox(false)}
          />
        </div>
      )}
    </>
  )
  const editor = useEditing({
    idea: id,
    lead: fileLine,
    draft: draft.data,
    open: editing,
    setOpen: setEditing,
    file: file.id,
    shownFile: file,
    latestFiles: pulled.files,
    threads,
    people,
    me: me.id,
    owner: idea.owner,
    onShowFile: (shown) => {
      const path = draft.data?.files.find((f) => f.file === shown)?.path
      if (path) {
        void navigate({ href: links.files({ file: path }) })
      }
    },
    onNote: setNote,
    onCommitted: (committed) => {
      ours.current.add(committed)
      setNote(`Committed as v${committed}.`)
    },
    // a version made around the draft overwrote some of it: said here, not as "just came in"
    onOverwritten: (made, name, changes) => {
      ours.current.add(made)
      setToast({
        message: `${name} overwrote ${changes === 1 ? '1 change' : `${changes} changes`} in the draft with version ${made}.`,
        action: { label: 'See it', onAction: () => void navigate({ href: links.files({ v: made, file: path }) }) },
      })
    },
    // discarded, here or by someone else, with Restore while there's something to bring back
    onDiscarded: (name, restore) =>
      setToast({
        message: name ? `${name} discarded the draft.` : 'The draft is discarded.',
        ...(restore ? { action: { label: 'Restore', onAction: restore } } : {}),
      }),
    // someone else committed while you were in the draft: said here, not as "just came in"
    onTheirCommit: (committed, name) => {
      ours.current.add(committed)
      setToast({
        message: `${name} committed version ${committed}. What you type now goes into the next one.`,
        action: { label: 'See it', onAction: () => void navigate({ href: links.files({ v: committed, file: path }) }) },
      })
    },
  })
  const canEdit = idea.you.edit && !older && base === null && !editing
  useEffect(() => {
    if (onlyInDraft && drafting && !editing) {
      setEditing(true)
    }
  }, [onlyInDraft, drafting, editing])
  // the file shown has another path in the draft (renamed, here or by someone else): the address follows
  const renamer = drafting?.changes.find((c) => c.change.kind === 'rename-file' && c.change.file === file.id)?.by.user
  // (only for the file the address names: not one shown in place of a path no file has)
  const named = views.some((f) => f.view.path === path) || !!inDraft
  useEffect(() => {
    if (named) {
      remembered.current = { path, id: file.id }
    }
  })
  useEffect(() => {
    if (!path || !named || !draftPath || draftPath === path) {
      return
    }
    void navigate({ href: links.files({ file: draftPath }), replace: true })
    if (renamer && renamer !== me.id) {
      setNote(`${people.get(renamer)?.name ?? 'Someone'} renamed this file to ${draftPath}.`)
    }
    // only when the path the draft gives it changes
  }, [draftPath, path])
  // an address no file has now: the file that had it before (renamed or moved since), where it is now
  const lost = !!path && !older && base === null && !views.some((f) => f.view.path === path) && !inDraft
  useEffect(() => {
    if (!lost || !path) {
      return
    }
    let gone = false
    api.findFile({ idea: id, path }).then(
      (found) => !gone && void navigate({ href: links.files({ file: found.path }), replace: true }),
      () => !gone && setNote(`No file is at ${path}: showing ${views[0]!.view.path}.`),
    )
    return () => {
      gone = true
    }
    // once for each address that's lost
  }, [lost, path])
  // its open comments, on its text and as a whole
  const commentsOn = (fileId: string) =>
    threads.filter(
      (t) => !t.resolved && t.state !== 'outdated' && t.anchor?.kind !== 'idea' && t.anchor?.file === fileId,
    ).length
  const treeFiles: FileTreeFile[] = drafting
    ? [
        ...drafting.files.map((f): FileTreeFile => {
          const inVersion = pulled.files.find((p) => p.file === f.file)
          const state = f.made
            ? 'new'
            : f.was
              ? 'renamed'
              : inVersion && inVersion.content !== f.content
                ? 'changed'
                : null
          return {
            id: f.file,
            path: f.path,
            href: links.files({ file: f.path }),
            state,
            was: f.was,
            comments: commentsOn(f.file),
          }
        }),
        ...drafting.deleted.map((d): FileTreeFile => ({
          id: d.file,
          path: d.path,
          href: links.files({ file: d.path }),
          state: 'deleted',
          comments: commentsOn(d.file),
        })),
      ]
    : pulled.files.map((f): FileTreeFile => {
        const before = baseFiles.data?.files.find((b) => b.file === f.file)
        return {
          id: f.file,
          path: f.path,
          href: base !== null ? links.changes(base, shownV, f.path) : links.files({ v: shownV, file: f.path }),
          state: base !== null && baseFiles.data && before?.hash !== f.hash ? 'changed' : null,
          comments: commentsOn(f.file),
        }
      })

  // the focus view: open while the address says so, and not while comparing; editing can happen in it.
  // Opening it here carries the text into it; its address opened directly shows it at once
  const focusing = view === 'focus' && base === null
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
  // editors have the draft itself; everyone else, the idea's word for it
  const uncommitted = canEdit && draft.data ? draftChanges.length > 0 : idea.uncommitted

  return (
    <>
      <IdeaPage
        opened={opened}
        // while the focus view's open, editing is in it: the page beneath doesn't open the file twice
        editing={focusPhase ? null : editor}
        files={{
          files: treeFiles,
          current: treeFiles.find((f) => f.id === file.id)?.path ?? file.path,
          closed: closedFolders,
          onClosedChange: setClosedFolders,
          ...(files.actions ? { actions: files.actions } : {}),
        }}
        source={file.source}
        compare={base !== null && baseFiles.data ? { base, source: baseFile?.content ?? '' } : null}
        showSource={showSource}
        banner={
          <>
            <DocToolbar
              path={file.path}
              file={fileLine}
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
              onFocusView={
                base === null && !editing
                  ? () => {
                      enteredOn.current = file.path
                      void navigate({ href: links.files({ v: shownV, file: file.path, view: 'focus' }) })
                    }
                  : undefined
              }
            />
            {base === null && !older && !editing && uncommitted ? (
              <p className="idea-edit-start">This idea has uncommitted changes.</p>
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
            authors: n.authors.map((a) => personOf(a, people)),
            at: n.createdAt,
            how: n.how,
            steps: n.steps,
          })),
          viewing: version,
          latest,
          base,
          viewHref: (n) => links.files({ v: n === latest ? undefined : n, file: path }),
          compareHref: (b) => links.changes(b, shownV, path),
          // the draft, for those who can edit: what the next version will be
          draft:
            idea.you.edit && draft.data && draftChanges.length > 0
              ? {
                  on: draft.data.version,
                  changes: draftChanges.length,
                  by: drafters,
                  onOpen: canEdit ? () => setEditing(true) : undefined,
                }
              : undefined,
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
        onSectionComment={(heading, body, pending) => {
          const section = sectionAt(file.source, file.unitIds, heading)
          if (section) {
            writes.comment({ kind: 'section', file: file.id, section }, body, pending)
          }
        }}
        onBlockComment={(start, body, pending) => {
          const block = blockAt(file.source, file.unitIds, start)
          if (block) {
            writes.comment({ kind: 'block', file: file.id, block }, body, pending)
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
          onFileComment={(page, body, pending) => writes.comment({ kind: 'file', file: page }, body, pending)}
          {...(files.actions ? { onNewFile: () => setNaming({ kind: 'create', folder: '' }) } : {})}
          fileMenu={fileMenu}
          // the draft, for those who can edit the latest version: every sheet at once
          {...(idea.you.edit && !older
            ? {
                editing: {
                  label: draftChanges.length > 0 ? 'Open the draft' : 'Edit',
                  disabled: !draft.data,
                  onEdit: () => setEditing(true),
                  open: editor
                    ? {
                        label: editor.label,
                        people: editor.people,
                        sheet: editor.sheet,
                        actions: editor.actions,
                        close: editor.close,
                      }
                    : null,
                },
              }
            : {})}
        />
      )}
      {/* the editor's words and actions, in the idea's bar while it's open (in focus view, its own) */}
      {!focusPhase && editor?.bar}
      {files.dialog}
      {files.actions && (
        <FileNameDialog box={naming} files={treeFiles} actions={files.actions} onClose={() => setNaming(null)} />
      )}
      <Toast message={toast?.message ?? null} action={toast?.action} onDismiss={() => setNote(null)} />
    </>
  )
}
