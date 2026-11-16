import type { ReactNode } from 'react'
import './AppShell.css'

export interface AppShellProps {
  // the site's navigation (SideNav)
  nav: ReactNode
  // the page has the width to itself: no site navigation (it gives its own way home)
  bare?: boolean
  children: ReactNode
}

// The site: navigation on the left, the page on the right. A skip link comes
// first, so a keyboard can go straight to the page.
export function AppShell({ nav, bare = false, children }: AppShellProps) {
  return (
    <div className={`app-shell${bare ? ' app-shell-bare' : ''}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {!bare && <div className="app-shell-nav">{nav}</div>}
      <main className="app-shell-main" id="main" tabIndex={-1}>
        {children}
      </main>
    </div>
  )
}
