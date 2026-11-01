import type { ReactNode } from 'react'
import './Tag.css'

// faint: no fill, for quiet facts. dashed: something no longer in force
// (inactive people, deleted groups), shown by its outline, not color alone.
export type TagTone = 'neutral' | 'bot' | 'ok' | 'lost' | 'warn' | 'admin' | 'faint' | 'dashed'

export interface TagProps {
  tone?: TagTone
  title?: string
  children: ReactNode
}

// A short label: "automated", "inactive", "🔒 Private".
export function Tag({ tone = 'neutral', title, children }: TagProps) {
  return (
    <span className={`tag tag-${tone}`} title={title}>
      {children}
    </span>
  )
}
