import type { ReactNode } from 'react'
import './AppShell.css'

export interface AppShellProps {
  // the site's navigation (SideNav)
  nav: ReactNode
  children: ReactNode
}

// The site: navigation on the left, the page on the right. A skip link comes
// first, so a keyboard can go straight to the page.
export function AppShell({ nav, children }: AppShellProps) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="app-shell-nav">{nav}</div>
      <main className="app-shell-main" id="main" tabIndex={-1}>
        {children}
      </main>
    </div>
  )
}
