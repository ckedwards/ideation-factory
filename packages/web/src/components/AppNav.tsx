// The app's navigation, beside every page: the site's name, the main pages,
// your teams, and at the bottom the signed-in person, the theme and signing
// out.
import { AccountMenu, InboxLink, Link, type Person, SideNav, type Theme } from '@ideaf/ui'
import './AppNav.css'

/** The page being shown, so its link is marked. */
export type NavPage = 'home' | 'notifications' | 'ideas' | 'teams' | 'groups' | 'settings' | null

export interface AppNavProps {
  me: Person
  /** Your teams, by name, linking to their pages, with how much of each you hear about. */
  teams: { handle: string; name: string; watch?: 'participating' | 'active' | 'all' }[]
  current: NavPage
  /** Ideas in your inbox with news. */
  unread?: number
  theme: Theme
  onThemeChange: (theme: Theme) => void
  onSignOut: () => void
  /** The teams watched above participating, member or not, with how much. */
  watching?: { handle: string; name: string; level: 'participating' | 'active' | 'all' }[]
  /** The team whose pages these are: marked in Your teams and Watching. */
  currentTeam?: string | null
}

const LEVEL = { participating: null, active: 'Active', all: 'All' } as const

export function AppNav({
  me,
  teams,
  current,
  unread = 0,
  theme,
  onThemeChange,
  onSignOut,
  watching = [],
  currentTeam = null,
}: AppNavProps) {
  return (
    <SideNav
      brand={
        <>
          <span aria-hidden>✳</span> Ideation Factory
        </>
      }
      brandHref="/"
      corner={<InboxLink href="/notifications" unread={unread} current={current === 'notifications'} />}
      groups={[
        {
          items: [
            { href: '/', label: 'Home', current: current === 'home' },
            { href: '/ideas', label: 'Ideas', current: current === 'ideas' },
            { href: `/@${me.handle}`, label: 'Your ideas' },
            { href: '/teams', label: 'Teams', current: current === 'teams' },
            { href: '/groups', label: 'Groups', current: current === 'groups' },
          ],
        },
        {
          title: 'Your teams',
          items: teams.map((team) => ({
            href: `/${team.handle}`,
            label: team.name,
            current: team.handle === currentTeam,
          })),
          empty: (
            <Link className="app-nav-link" href="/teams">
              Find a team to join
            </Link>
          ),
        },
        ...(watching.length > 0
          ? [
              {
                title: 'Watching',
                items: watching.map((team) => ({
                  href: `/${team.handle}`,
                  label: team.name,
                  current: team.handle === currentTeam,
                  ...(LEVEL[team.level] ? { note: LEVEL[team.level]! } : {}),
                })),
              },
            ]
          : []),
      ]}
      footer={
        <AccountMenu
          person={me}
          settingsHref="/settings"
          theme={theme}
          onThemeChange={onThemeChange}
          onSignOut={onSignOut}
        />
      }
    />
  )
}
