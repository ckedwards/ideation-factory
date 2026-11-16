import { type ReactNode, useEffect, useId, useState } from 'react'
import './AppShell.css'

export interface AppShellProps {
  // the site's navigation (SideNav)
  nav: ReactNode
  // on a narrow screen, the bar across the top beside the Menu button: the site's name and what's new
  bar?: ReactNode
  // the page has the width to itself: no site navigation (it gives its own way home)
  bare?: boolean
  children: ReactNode
}

// The site: navigation on the left, the page on the right. A skip link comes
// first, so a keyboard can go straight to the page. On a narrow screen the
// navigation folds into a bar across the top, with a Menu button that opens
// it over the page; following a link in it, or Esc, closes it again.
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
      {!bare && (
        <>
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
        </>
      )}
      <main className="app-shell-main" id="main" tabIndex={-1}>
        {children}
      </main>
    </div>
  )
}
