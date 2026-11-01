import type { ReactNode } from 'react'
import './Empty.css'

export interface EmptyProps {
  // what isn't here, and why ("No ideas match these filters.")
  children: ReactNode
  // what to do about it: a button or link
  action?: ReactNode
}

// In place of a list with nothing in it.
export function Empty({ children, action }: EmptyProps) {
  return (
    <div className="empty">
      <p>{children}</p>
      {action && <div className="empty-action">{action}</div>}
    </div>
  )
}
