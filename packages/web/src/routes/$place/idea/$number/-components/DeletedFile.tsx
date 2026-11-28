// A file the draft deletes, where the editor would be: who deleted it, that it goes when the draft is
// committed, and Restore; its text, as it was when deleted, read-only beneath (docs: Files in the
// browser, With other people in the draft). Nothing more can be typed into a file that's going.
import { markdownTree } from '@ideaf/core'
import { Button, MarkdownView } from '@ideaf/ui'
import { type ReactNode, useMemo } from 'react'
import './DeletedFile.css'

export interface DeletedFileProps {
  path: string
  content: string
  /** Who deleted it, by name; null for you. */
  by: string | null
  onRestore: () => void
  /** Over the text: the file's line; its path alone without one. Nothing in a focus view sheet. */
  lead?: ReactNode
  bare?: boolean
}

export function DeletedFile({ path, content, by, onRestore, lead, bare }: DeletedFileProps) {
  const tree = useMemo(() => markdownTree(content), [content])
  return (
    <div className="deleted-file">
      {!bare && <div className="draft-editor-file">{lead ?? path}</div>}
      <div className="deleted-file-note" role="status">
        <p>
          {by ? `${by} deleted this file.` : 'You deleted this file.'} It goes when the draft is committed. What was
          typed in it is still here.
        </p>
        <Button size="sm" onClick={onRestore}>
          Restore
        </Button>
      </div>
      <div className="deleted-file-text" aria-label={`${path}, deleted`}>
        <MarkdownView tree={tree} />
      </div>
    </div>
  )
}
