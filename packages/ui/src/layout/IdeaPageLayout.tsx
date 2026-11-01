import type { ReactNode } from 'react'
import './IdeaPageLayout.css'

export interface IdeaPageLayoutProps {
  // left: the idea, its files and the contents of this file
  nav: ReactNode
  // center: the document, the redline, or the comments feed
  document: ReactNode
  // right: comments, versions, details (Tabs)
  panel?: ReactNode
}

// The idea page's three panes, each scrolling on its own. On a narrow screen
// they stack and the page scrolls as one.
export function IdeaPageLayout({ nav, document, panel }: IdeaPageLayoutProps) {
  return (
    <div className={`idea-page${panel ? '' : ' idea-page-no-panel'}`}>
      <a className="skip-link" href="#idea-document">
        Skip to the document
      </a>
      <aside className="idea-page-nav" aria-label="Idea">
        {nav}
      </aside>
      {/* focusable, so the keyboard can scroll it */}
      <main className="idea-page-document" id="idea-document" tabIndex={0}>
        {document}
      </main>
      {panel && (
        <aside className="idea-page-panel" aria-label="Comments, versions and details">
          {panel}
        </aside>
      )}
    </div>
  )
}
