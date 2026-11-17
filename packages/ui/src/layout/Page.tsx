import type { ReactNode } from 'react'
import './Page.css'

export interface PageProps {
  children: ReactNode
  // wide: tables and settings that need the room
  width?: 'normal' | 'wide'
}

// A page's content, at a readable width from the same left edge as every other page, with its header first.
export function Page({ children, width = 'normal' }: PageProps) {
  return (
    <div className="page" data-width={width}>
      {children}
    </div>
  )
}

export interface SectionProps {
  title: ReactNode
  children: ReactNode
  // on the right of the heading: "See all", a filter
  action?: ReactNode
}

// A headed part of a page ("Waiting on your review", "Members").
export function Section({ title, children, action }: SectionProps) {
  return (
    <section className="page-section">
      <div className="page-section-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}
