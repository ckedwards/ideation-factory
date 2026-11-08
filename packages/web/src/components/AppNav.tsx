// The app's navigation, beside every page: the site's name, the main pages,
// your teams, and at the bottom the signed-in person, the theme and signing
// out.
import { Button, Link, type Person, SideNav, ThemeToggle, type Theme, UserName } from '@ideaf/ui'
import './AppNav.css'

/** The page being shown, so its link is marked. */
export type NavPage = 'home' | 'notifications' | 'ideas' | 'teams' | 'groups' | 'settings' | null

export interface AppNavProps {
  me: Person
  /** Your teams, by name, linking to their pages. */
  teams: { handle: string; name: string }[]
  current: NavPage
  /** Ideas in your inbox with news. */
  unread?: number
  theme: Theme
  onThemeChange: (theme: Theme) => void
  onSignOut: () => void
}

export function AppNav({ me, teams, current, unread = 0, theme, onThemeChange, onSignOut }: AppNavProps) {
  return (
    <SideNav
      brand={
        <>
          <span aria-hidden>✳</span> Ideation Factory
        </>
      }
      brandHref="/"
      groups={[
        {
          items: [
            { href: '/', label: 'Home', current: current === 'home' },
            {
              href: '/notifications',
              label: 'Notifications',
              current: current === 'notifications',
              ...(unread > 0 ? { count: unread } : {}),
            },
            { href: '/ideas', label: 'Ideas', current: current === 'ideas' },
            { href: `/@${me.handle}`, label: 'Your ideas' },
            { href: '/teams', label: 'Teams', current: current === 'teams' },
            { href: '/groups', label: 'Groups', current: current === 'groups' },
          ],
        },
        {
          title: 'Your teams',
          items: teams.map((team) => ({ href: `/${team.handle}`, label: team.name })),
          empty: (
            <Link className="app-nav-link" href="/teams">
              Find a team to join
            </Link>
          ),
        },
      ]}
      footer={
        <>
          <UserName person={me} withAvatar />
          <Link className="app-nav-link" href="/settings" aria-current={current === 'settings' ? 'page' : undefined}>
            Your settings
          </Link>
          <ThemeToggle value={theme} onChange={onThemeChange} />
          <Button size="sm" variant="ghost" onClick={onSignOut}>
            Sign out
          </Button>
        </>
      }
    />
  )
}
