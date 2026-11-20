// The idea's draft, on the files page: one per idea, on its latest version,
// shared by everyone who can edit it, and kept by the server. Each change goes
// to it as it's made, and is refused as outdated if the block no longer reads
// as it did; the socket's draft event keeps everyone's copy current.
// Committing makes one version.
import { type ReactNode, useState } from 'react'
import { ApiError, type Operations, type Output } from '@ideaf/api'
import { type DraftChange, type DraftUnit, markdownTree, plainLine, type Position } from '@ideaf/core'
import { type Person, Redline, renderMermaid } from '@ideaf/ui'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../../../../../api.ts'
import { type CommentOutcomeRow, EditActions, EditPanel, type EditPanelProps } from './EditPanel.tsx'
import { IdeaMode } from './IdeaFrame.tsx'
import { IdeaEditor, title } from './IdeaEditor.tsx'
import { draftQuery } from './queries.ts'
import type { Thread } from './view.ts'

export type Draft = Output<Operations['getDraft']>

export interface UseEditingArgs {
  idea: string
  draft: Draft | undefined
  /** Whether the draft is open for editing on the page. */
  open: boolean
  setOpen: (open: boolean) => void
  /** The file shown, and the latest version's files (what the preview compares with). */
  file: string
  latestFiles: Array<{ file: string; content: string }>
  threads: Thread[]
  people: Map<string, Person>
  onNote: (message: string) => void
  /** Committed as this version. */
  onCommitted: (version: number) => void
}

export function useEditing(args: UseEditingArgs): { document: ReactNode; panel: ReactNode; bar: ReactNode } | null {
  const { idea, draft } = args
  const queryClient = useQueryClient()
  const [previewing, setPreviewing] = useState(false)
  const [committing, setCommitting] = useState(false)
  if (!args.open || !draft) {
    return null
  }

  const reread = () => queryClient.invalidateQueries({ queryKey: draftQuery(idea).queryKey, exact: true })
  const failed = (error: unknown) => {
    const problem = error instanceof ApiError ? (error.details as { problem?: string } | undefined)?.problem : undefined
    args.onNote(
      problem
        ? `Someone changed that meanwhile (${problem}): here’s the draft as it is now.`
        : `That didn’t work: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const change = (change: DraftChange) =>
    void api
      .changeDraft({ idea, change })
      .catch(failed)
      .finally(() => void reread())
  const file = draft.files.find((f) => f.file === args.file) ?? draft.files[0]
  const units = file?.units ?? []

  const commit = async () => {
    setCommitting(true)
    try {
      const done = await api.commitDraft({ idea })
      args.onCommitted(done.version)
      setPreviewing(false)
      args.setOpen(false)
    } catch (error) {
      failed(error)
    } finally {
      setCommitting(false)
      void reread()
    }
  }

  const before = args.latestFiles.find((f) => f.file === file?.file)?.content ?? ''
  const after = file?.content ?? ''
  const close = () => {
    setPreviewing(false)
    args.setOpen(false)
  }
  // the panel's and the bar's: the same draft, and the same ways of acting on it
  const panelProps: EditPanelProps = {
    version: draft.version,
    changes: draft.changes.map((c) => ({
      key: c.key,
      label: describe(c.change),
      by: args.people.get(c.by.user)?.name ?? 'someone',
      problem: c.problem,
    })),
    outcomes: draft.comments.map((o): CommentOutcomeRow => {
      const thread = args.threads.find((t) => t.id === o.id)
      const anchor = thread?.anchor
      return {
        id: o.id,
        state: o.state,
        label: anchor?.kind === 'text' ? `“${anchor.quote}”` : thread ? excerpt(thread.body) : o.id,
      }
    }),
    previewing,
    committing,
    onUndo: (key) =>
      void api
        .undoDraftChange({ idea, key })
        .catch(failed)
        .finally(() => void reread()),
    onPreview: setPreviewing,
    onCommit: () => void commit(),
    onDiscard: () =>
      void api
        .discardDraft({ idea })
        .then(() => {
          args.onNote('The draft is discarded.')
          setPreviewing(false)
        }, failed)
        .finally(() => void reread()),
    onClose: close,
  }
  return {
    document: previewing ? (
      <Redline
        base={{ source: before, tree: markdownTree(before) }}
        current={{ source: after, tree: markdownTree(after) }}
        renderCode={renderMermaid}
      />
    ) : (
      <IdeaEditor
        units={units}
        onEdit={(unit, text) => change({ kind: 'edit', id: unit.id, source: text, was: unit.source })}
        onAdd={(unit, markdown) => change({ kind: 'insert', at: below(units, file?.file ?? '', unit), markdown })}
        onDelete={(unit) => change({ kind: 'delete', id: unit.id, was: unit.source })}
      />
    ),
    panel: <EditPanel {...panelProps} />,
    // the editor's words and actions in the idea's bar, while it's open
    bar: <IdeaMode label={`Editing the draft, on v${draft.version}`} actions={<EditActions {...panelProps} />} />,
  }
}

/** Where text added below a unit goes: after a block; for a heading, before what follows it, or at the file's end. */
function below(units: DraftUnit[], file: string, unit: DraftUnit): Position {
  if (unit.kind !== 'heading') {
    return { after: unit.id }
  }
  const following = units[units.indexOf(unit) + 1]
  return following ? { before: following.id } : { end: file }
}

/** A change as the list of changes names it. */
function describe(change: DraftChange): string {
  const heading = (source: string) => /^\s*#{1,6}\s/.test(source)
  switch (change.kind) {
    case 'insert':
      return `Added “${excerpt(change.markdown)}”`
    case 'suggestion':
      return `Suggestion ${change.comment}: “${excerpt(change.old)}” → “${excerpt(change.new)}”`
    case 'delete':
      return heading(change.was) ? `Deleted the section “${title(change.was)}”` : `Deleted “${excerpt(change.was)}”`
    case 'move':
      return heading(change.was) ? `Moved the section “${title(change.was)}”` : `Moved “${excerpt(change.was)}”`
    case 'move-text':
      return `Moved “${excerpt(change.old)}”`
    case 'edit':
      return heading(change.was)
        ? `Renamed “${title(change.was)}” to “${title(change.source)}”`
        : `Edited “${excerpt(change.source)}”`
  }
}

/** Some Markdown as it reads, cut short. */
function excerpt(markdown: string): string {
  const text = plainLine(markdown)
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
}
