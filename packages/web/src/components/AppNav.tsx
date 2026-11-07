// The app's navigation, beside every page: the site's name, the main pages,
// your teams, and at the bottom the signed-in person, the theme and signing
// out.
import { Button, Link, type Person, SideNav, ThemeToggle, type Theme, UserName } from '@ideaf/ui'

/** The page being shown, so its link is marked. */
export type NavPage = 'home' | 'ideas' | 'teams' | 'groups' | null

export interface AppNavProps {
  me: Person
  /** Your teams, by name, linking to their pages. */
  teams: { handle: string; name: string }[]
  current: NavPage
  theme: Theme
  onThemeChange: (theme: Theme) => void
  onSignOut: () => void
}

export function AppNav({ me, teams, current, theme, onThemeChange, onSignOut }: AppNavProps) {
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
            { href: '/ideas', label: 'Ideas', current: current === 'ideas' },
            { href: `/@${me.handle}`, label: 'Your ideas' },
            { href: '/teams', label: 'Teams', current: current === 'teams' },
            { href: '/groups', label: 'Groups', current: current === 'groups' },
          ],
        },
        {
          title: 'Your teams',
          items: teams.map((team) => ({ href: `/${team.handle}`, label: team.name })),
          empty: <Link href="/teams">Find a team to join</Link>,
        },
      ]}
      footer={
        <>
          <UserName person={me} withAvatar />
          <ThemeToggle value={theme} onChange={onThemeChange} />
          <Button size="sm" variant="ghost" onClick={onSignOut}>
            Sign out
          </Button>
        </>
      }
    />
  )
}
