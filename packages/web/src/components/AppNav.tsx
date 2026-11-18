// The app's navigation, beside every page but an idea's: the main pages, your
// teams, and the teams you watch. The site's name, your notifications and your
// account are in the app's bar (AppBar).
import { Link, type Person, SideNav } from '@ideaf/ui'
import './AppNav.css'

/** The page being shown, so its link is marked. */
export type NavPage = 'home' | 'notifications' | 'ideas' | 'teams' | 'groups' | 'settings' | null

export interface AppNavProps {
  /** You, for Your ideas. */
  me: Person
  /** Your teams, by name, linking to their pages, with how much of each you hear about. */
  teams: { handle: string; name: string; watch?: 'participating' | 'active' | 'all' }[]
  current: NavPage
  /** The teams watched above participating, member or not, with how much. */
  watching?: { handle: string; name: string; level: 'participating' | 'active' | 'all' }[]
  /** The team whose pages these are: marked in Your teams and Watching. */
  currentTeam?: string | null
}

const LEVEL = { participating: null, active: 'Active', all: 'All' } as const

export function AppNav({ me, teams, current, watching = [], currentTeam = null }: AppNavProps) {
  return (
    <SideNav
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
    />
  )
}
