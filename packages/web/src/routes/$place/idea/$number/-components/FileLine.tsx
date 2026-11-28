// A file's header line: its path, how many comments are on the file as a whole, and a button to make
// one. The whole file's comments sit beside it in the gutter, as any comment sits beside its text. It
// heads the file while it's read (in the document's toolbar) and while it's edited (over the editor's
// text), and each sheet of the focus view.
import { Button, RowMenu, type RowMenuItem } from '@ideaf/ui'
import { plural } from '../../../../../plural.ts'
import './FileLine.css'

export interface FileLineProps {
  path: string
  /** "@ v2": an older version shown. */
  version?: number | undefined
  /** The open comments on the file as a whole. */
  count: number
  /** Opens the box for a comment on the file; none where comments can't be made. */
  onComment?: (() => void) | undefined
  /** The file's own ⋯: renaming or deleting it (restoring it, deleted), for someone who can edit. */
  menu?: RowMenuItem[] | undefined
}

export function FileLine({ path, version, count, onComment, menu }: FileLineProps) {
  return (
    <span className="file-line">
      <span className="file-line-path">{path}</span>
      {version !== undefined && <span className="file-line-version">@ v{version}</span>}
      {count > 0 && <span className="file-line-count">· {plural(count, 'comment')} on the file</span>}
      {onComment && (
        <Button size="sm" className="file-line-comment" onClick={onComment}>
          Comment on the file
        </Button>
      )}
      {menu && menu.length > 0 && <RowMenu label={path} groups={[{ items: menu }]} />}
    </span>
  )
}
