// Making, renaming and deleting the idea's files from its Files tree (docs: Files in the browser):
// each is a change to the draft, which a change from the tree opens, as Edit does. The server fixes
// links to a file renamed or moved; a delete asks first, saying what it costs, and is restored from
// its row until the draft is committed.
import { useState } from 'react'
import { type Idea, linkFixes, pathProblem } from '@ideaf/core'
import { Button, Dialog, type FileTreeActions, folderOf } from '@ideaf/ui'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../../../../../api.ts'
import { plural } from '../../../../../plural.ts'
import type { Draft } from './editing.tsx'
import { draftQuery } from './queries.ts'
import type { Thread } from './view.ts'

export interface FileActionsArgs {
  idea: string
  /** The draft, for someone who can change it now; without, there are no actions. */
  draft: Draft | null
  threads: Thread[]
  me: string
  /** A person's name, by their ID. */
  nameOf: (user: string) => string
  /** The draft opened, as Edit opens it. */
  openDraft: () => void
  /** Goes to a file, by its path (after making it, or renaming the one shown). */
  showFile: (path: string) => void
  /** The path of the file shown. */
  shown: string | null
  onNote: (note: { message: string; action?: { label: string; onAction: () => void } } | null) => void
}

/** What deleting would cost, asked about first: a file, or a folder and its files. */
interface Asking {
  title: string
  files: string[]
  comments: number
  /** Links to them from the idea's other files, by the file they're in. */
  links: Array<{ path: string; count: number }>
  /** Who's typing in them now. */
  typing: Array<{ name: string; path: string }>
  confirm: string
}

/** The tree's actions on the draft, and the dialog a delete asks in. */
export function useFileActions(args: FileActionsArgs): {
  actions: FileTreeActions | undefined
  dialog: React.ReactNode
} {
  const queryClient = useQueryClient()
  const [asking, setAsking] = useState<Asking | null>(null)
  const draft = args.draft ?? NO_DRAFT
  const reread = () => queryClient.invalidateQueries({ queryKey: draftQuery(args.idea).queryKey, exact: true })
  const pathOf = (file: string) =>
    draft.files.find((f) => f.file === file)?.path ?? draft.deleted.find((d) => d.file === file)?.path ?? file

  const send = async (changes: Parameters<typeof api.changeDraft>[0]['changes']) => {
    args.openDraft()
    try {
      await api.changeDraft({ idea: args.idea, changes })
      return true
    } catch (error) {
      args.onNote({ message: `That didn’t work: ${error instanceof Error ? error.message : String(error)}` })
      return false
    } finally {
      await reread()
    }
  }
  const undo = async (keys: string[]) => {
    try {
      for (const key of keys) {
        await api.undoDraftChange({ idea: args.idea, key })
      }
    } catch (error) {
      args.onNote({ message: `That didn’t work: ${error instanceof Error ? error.message : String(error)}` })
    } finally {
      await reread()
    }
  }

  // the draft as an idea: what link fixes and costs are worked out on
  const asIdea = (): Idea => ({
    files: draft.files.map((f) => ({
      id: f.file,
      path: f.path,
      source: f.content,
      unitIds: f.units.map((u) => u.id),
    })),
    nextId: 0,
  })
  /** How many links the renames fix, as the server will. */
  const fixed = (renames: Array<{ file: string; path: string }>) =>
    linkFixes(asIdea(), renames).reduce((n, f) => n + f.links, 0)

  const ask = (files: string[], title: string, confirm: string) => {
    const idea = asIdea()
    const gone = new Set(files)
    // links to them: as renaming each beside itself would fix them, from the other files
    const links = new Map<string, number>()
    for (const fix of linkFixes(
      idea,
      files.map((file) => {
        const folder = folderOf(pathOf(file))
        return { file, path: `${folder ? `${folder}/` : ''}\u0000gone.md` }
      }),
    )) {
      if (!gone.has(fix.file)) {
        const path = pathOf(fix.file)
        links.set(path, (links.get(path) ?? 0) + fix.links)
      }
    }
    setAsking({
      title,
      files,
      comments: args.threads.filter(
        (t) => !t.resolved && t.state !== 'outdated' && t.anchor?.kind !== 'idea' && gone.has(t.anchor?.file ?? ''),
      ).length,
      links: [...links].map(([path, count]) => ({ path, count })),
      typing: (draft.typing ?? [])
        .filter((t) => t.user !== args.me && gone.has(t.file))
        .map((t) => ({ name: args.nameOf(t.user), path: pathOf(t.file) })),
      confirm,
    })
  }

  const live = (folder: string) =>
    draft.files.filter((f) => f.path.startsWith(`${folder}/`)).map((f) => ({ file: f.file, path: f.path }))

  const actions: FileTreeActions = {
    pathProblem: friendlyPathProblem,
    onCreate: async (path) => {
      if (await send([{ kind: 'create-file', path, markdown: '' }])) {
        args.showFile(path)
      }
    },
    onRename: async (file, path) => {
      const was = pathOf(file)
      const links = fixed([{ file, path }])
      if (await send([{ kind: 'rename-file', file, path, was }])) {
        args.onNote({ message: `Renamed to ${path}.${links > 0 ? ` ${plural(links, 'link')} updated.` : ''}` })
        if (args.shown === was) {
          args.showFile(path)
        }
      }
    },
    onDelete: (file) => {
      const path = pathOf(file)
      ask([file], `Delete ${path}?`, 'Delete file')
    },
    onRestore: (file) => {
      const change = draft.deleted.find((d) => d.file === file)?.change
      if (change) {
        void undo([change])
      }
    },
    onRenameFolder: async (folder, to) => {
      const renames = live(folder).map((f) => ({ file: f.file, path: `${to}/${f.path.slice(folder.length + 1)}` }))
      const links = fixed(renames)
      const changes = renames.map((r) => ({ kind: 'rename-file' as const, ...r, was: pathOf(r.file) }))
      if (await send(changes)) {
        const moved = `${plural(renames.length, 'file')} moved`
        args.onNote({ message: `Renamed to ${to}. ${moved}${links > 0 ? `, ${plural(links, 'link')} updated` : ''}.` })
        if (args.shown?.startsWith(`${folder}/`)) {
          args.showFile(`${to}/${args.shown.slice(folder.length + 1)}`)
        }
      }
    },
    onDeleteFolder: (folder) => {
      const files = live(folder).map((f) => f.file)
      ask(files, `Delete ${folder} and its ${plural(files.length, 'file')}?`, 'Delete folder')
    },
    onRestoreFolder: (folder) => {
      void undo(draft.deleted.filter((d) => d.path.startsWith(`${folder}/`)).map((d) => d.change))
    },
  }

  const dialog = (
    <Dialog
      open={asking !== null}
      title={asking?.title ?? ''}
      onClose={() => setAsking(null)}
      footer={
        <>
          <Button variant="ghost" onClick={() => setAsking(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              const files = asking?.files ?? []
              setAsking(null)
              void send(files.map((file) => ({ kind: 'delete-file' as const, file })))
            }}
          >
            {asking?.confirm ?? 'Delete'}
          </Button>
        </>
      }
    >
      {asking && <DeleteCosts asking={asking} />}
    </Dialog>
  )
  return { actions: args.draft ? actions : undefined, dialog }
}

const NO_DRAFT: Pick<Draft, 'files' | 'deleted' | 'typing'> = { files: [], deleted: [], typing: [] }

function DeleteCosts({ asking }: { asking: Asking }) {
  const many = asking.files.length > 1
  return (
    <>
      <p className="edit-panel-lead">
        {many ? 'They leave' : 'It leaves'} when the draft is committed, and can be restored until then.
      </p>
      <ul className="file-delete-costs">
        {asking.comments > 0 && (
          <li>
            {plural(asking.comments, 'open comment')} on {many ? 'them' : 'it'} become
            {asking.comments === 1 ? 's' : ''} outdated.
          </li>
        )}
        {asking.links.map((l) => (
          <li key={l.path}>
            {plural(l.count, 'link')} in {l.path} will point at nothing.
          </li>
        ))}
        {asking.typing.map((t) => (
          <li key={`${t.name}/${t.path}`}>
            {t.name} is typing in {many ? t.path : 'it'} now.
          </li>
        ))}
      </ul>
    </>
  )
}

/** Why a file can't have a path, in words for the name box; null if it can. */
export function friendlyPathProblem(path: string): string | null {
  if (path.length > 512) {
    return 'A path can be 512 characters at most'
  }
  const problem = pathProblem(path)
  if (problem === null) {
    return null
  }
  if (/\.md$/i.test(path)) {
    return 'Use / between folders, and no empty, “.” or “..” names'
  }
  return 'Only Markdown pages can be made here'
}
