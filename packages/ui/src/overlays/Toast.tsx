import { useEffect, type ReactNode } from 'react'
import './Toast.css'

export interface ToastProps {
  // what just happened; nothing is shown without one
  message: ReactNode | null
  // called when it's time to go: the page clears `message`
  onDismiss: () => void
  // how long it stays, in milliseconds
  duration?: number
}

// A short note at the bottom of the page about something that just happened
// ("Mobile: every idea once it's out of draft"). The live region is always
// there, so screen readers announce each new message.
export function Toast({ message, onDismiss, duration = 4000 }: ToastProps) {
  useEffect(() => {
    if (message === null) {
      return
    }
    const timer = window.setTimeout(onDismiss, duration)
    return () => window.clearTimeout(timer)
  }, [message, duration, onDismiss])
  return (
    <div className="toast-region" role="status">
      {message !== null && <div className="toast">{message}</div>}
    </div>
  )
}
