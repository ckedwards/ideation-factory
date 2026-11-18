import { type ReactNode, useEffect, useId, useState } from 'react'
import './AppShell.css'

export interface AppShellProps {
  // the site's navigation (SideNav)
  nav: ReactNode
  // the app's bar across the top of every page: only what's global (the site's name, your notifications,
  // your account), never the page's own title or actions
  bar?: ReactNode
  // the page has the width to itself: no navigation column beside it, except behind Menu on a phone. The
  // bar is still there.
  bare?: boolean
  children: ReactNode
}

// The site: the app's bar across the top, then navigation on the left and the
// page on the right, under it. A skip link comes first, so a keyboard can go
// straight to the page. The bar and the navigation stay put as the page
// scrolls. On a narrow screen the navigation folds behind a Menu button at the
// bar's right end, which opens it over the page; following a link in it, or
// Esc, closes it again.
export function AppShell({ nav, bar, bare = false, children }: AppShellProps) {
  const [open, setOpen] = useState(false)
  const navId = useId()
  useEffect(() => {
    if (!open) {
      return
    }
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [open])
  return (
    <div className={`app-shell${bare ? ' app-shell-bare' : ''}${open ? ' app-shell-open' : ''}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="app-shell-bar">
        <div className="app-shell-bar-content">{bar}</div>
        <button
          type="button"
          className="app-shell-menu"
          aria-expanded={open}
          aria-controls={navId}
          onClick={() => setOpen(!open)}
        >
          {open ? 'Close' : 'Menu'}
        </button>
      </header>
      <div
        className="app-shell-nav"
        id={navId}
        // a link followed closes the menu on a narrow screen
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('a')) {
            setOpen(false)
          }
        }}
      >
        {nav}
      </div>
      <main className="app-shell-main" id="main" tabIndex={-1}>
        {children}
      </main>
    </div>
  )
}
