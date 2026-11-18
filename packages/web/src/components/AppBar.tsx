// The app's bar, across the top of every page, an idea's included: only what's global. The site's name,
// leading home, then your notifications (the envelope, with how many are unread) and your account (settings,
// the theme, signing out). The page's own title and actions stay in the page.
import { AccountMenu, InboxLink, Link, type Person, type Theme } from '@ideaf/ui'
import './AppBar.css'

export interface AppBarProps {
  me: Person
  /** Ideas in your inbox with news. */
  unread?: number
  /** The inbox is the page being shown. */
  inbox?: boolean
  theme: Theme
  onThemeChange: (theme: Theme) => void
  onSignOut: () => void
}

export function AppBar({ me, unread = 0, inbox = false, theme, onThemeChange, onSignOut }: AppBarProps) {
  return (
    <nav className="app-bar" aria-label="Site">
      <Link className="app-bar-home" href="/">
        <span className="app-bar-mark" aria-hidden>
          ✳
        </span>
        Ideation Factory
      </Link>
      <span className="app-bar-you">
        <InboxLink href="/notifications" unread={unread} current={inbox} />
        <AccountMenu
          compact
          person={me}
          settingsHref="/settings"
          theme={theme}
          onThemeChange={onThemeChange}
          onSignOut={onSignOut}
        />
      </span>
    </nav>
  )
}
