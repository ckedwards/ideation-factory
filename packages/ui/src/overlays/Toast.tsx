import { useEffect, type ReactNode } from 'react'
import './Toast.css'

export interface ToastProps {
  // what just happened; nothing is shown without one
  message: ReactNode | null
  // called when it's time to go: the page clears `message`
  onDismiss: () => void
  // how long it stays, in milliseconds: longer with an action, to give time to take it
  duration?: number
  // something to do about it ("See it"), which also dismisses it
  action?: { label: string; onAction: () => void } | undefined
}

// A short note at the bottom of the page about something that just happened
// ("Mobile: every idea once it's out of draft"). The live region is always
// there, so screen readers announce each new message.
export function Toast({ message, onDismiss, duration, action }: ToastProps) {
  const stays = duration ?? (action ? 8000 : 4000)
  useEffect(() => {
    if (message === null) {
      return
    }
    const timer = window.setTimeout(onDismiss, stays)
    return () => window.clearTimeout(timer)
  }, [message, stays, onDismiss])
  return (
    <div className="toast-region" role="status">
      {message !== null && (
        <div className="toast">
          {message}
          {action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                action.onAction()
                onDismiss()
              }}
            >
              {action.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
