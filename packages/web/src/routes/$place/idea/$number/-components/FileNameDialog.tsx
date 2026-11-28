// Making or renaming a file where there's no Files tree to do it in (the focus view), or from the
// file's own line: the tree's name box, in a dialog.
import { Button, Dialog, type FileTreeActions, type NameBox, NameBoxField, type TreeFile } from '@ideaf/ui'
import { useRef } from 'react'

export interface FileNameDialogProps {
  /** What it's for; null when it's closed. */
  box: NameBox | null
  files: readonly TreeFile[]
  actions: FileTreeActions
  onClose: () => void
}

export function FileNameDialog({ box, files, actions, onClose }: FileNameDialogProps) {
  const submit = useRef<(() => void) | null>(null)
  const renamed = box?.kind === 'rename' ? files.find((f) => f.id === box.file) : undefined
  const title = box?.kind === 'create' ? 'New file' : `Rename ${renamed?.path ?? ''}`
  return (
    <Dialog
      open={box !== null}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => submit.current?.()}>
            {box?.kind === 'create' ? 'Make it' : 'Rename'}
          </Button>
        </>
      }
    >
      {box && (
        <div className="file-tree-row is-naming">
          <NameBoxField box={box} files={files} actions={actions} onDone={onClose} keepOnBlur submitRef={submit} />
        </div>
      )}
    </Dialog>
  )
}
