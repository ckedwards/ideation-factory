import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Button } from '../controls/Button.tsx'
import './Dialog.css'

export interface DialogProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  // the actions: Cancel and the main one, last
  footer?: ReactNode
}

// A modal dialog, on the browser's own <dialog>: focus moves inside and stays
// there, the page behind can't be reached, and Esc or the backdrop closes it.
// Focus goes back where it was afterwards.
export function Dialog({ open, title, onClose, children, footer }: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const element = dialog.current
    if (!element) {
      return
    }
    if (open && !element.open) {
      element.showModal()
    } else if (!open && element.open) {
      element.close()
    }
  }, [open])
  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby={titleId}
      // Esc: the page closes it, so `open` stays the one source of truth. Handled
      // on keydown, which also stops the browser's own cancel; onCancel catches
      // other ways of asking to close (a phone's back gesture)
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
      }}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      // a click on the dialog element itself, not its contents, is on the backdrop
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="dialog-box">
        <header className="dialog-head">
          <h2 id={titleId}>{title}</h2>
          <Button variant="ghost" aria-label="Close" onClick={onClose}>
            ✕
          </Button>
        </header>
        <div className="dialog-body">{children}</div>
        {footer && <footer className="dialog-foot">{footer}</footer>}
      </div>
    </dialog>
  )
}
