// The app's navigation, beside every page: the site's name, the main pages,
// and at the bottom the signed-in person, the theme and signing out. Your
// teams join it once the API can say which they are.
import { Button, type Person, SideNav, ThemeToggle, type Theme, UserName } from '@ideaf/ui'

/** The page being shown, so its link is marked. */
export type NavPage = 'home' | 'ideas' | 'teams' | 'groups' | null

export interface AppNavProps {
  me: Person
  current: NavPage
  theme: Theme
  onThemeChange: (theme: Theme) => void
  onSignOut: () => void
}

export function AppNav({ me, current, theme, onThemeChange, onSignOut }: AppNavProps) {
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
