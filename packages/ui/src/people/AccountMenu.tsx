import { Menu } from '@base-ui/react/menu'
import type { Theme } from '../controls/ThemeToggle.tsx'
import { Link } from '../link/Link.tsx'
import { Avatar } from './Avatar.tsx'
import type { Person } from './person.ts'
import './AccountMenu.css'

export interface AccountMenuProps {
  person: Person
  settingsHref: string
  theme: Theme
  onThemeChange: (theme: Theme) => void
  onSignOut: () => void
}

const THEMES: Array<{ value: Theme; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'contrast', label: 'High contrast' },
]

// You, as one button at the foot of the navigation: it opens your settings, the theme and signing out,
// as GitHub's and GitLab's account menus do. Base UI's menu does the keyboard and focus work.
export function AccountMenu({ person, settingsHref, theme, onThemeChange, onSignOut }: AccountMenuProps) {
  return (
    <Menu.Root>
      <Menu.Trigger className="account-menu-trigger">
        <span aria-hidden>
          <Avatar person={person} size="sm" />
        </span>
        <span className="account-menu-name">
          {person.name}
          <span className="visually-hidden">: settings, theme, sign out</span>
        </span>
        <span className="account-menu-caret" aria-hidden>
          ▴
        </span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="account-menu-positioner" side="top" align="start" sideOffset={6}>
          <Menu.Popup className="account-menu">
            <Menu.Item className="account-menu-item" render={<Link href={settingsHref} />}>
              Your settings
            </Menu.Item>
            <Menu.Separator className="account-menu-separator" />
            <Menu.Group>
              <Menu.GroupLabel className="account-menu-label">Theme</Menu.GroupLabel>
              <Menu.RadioGroup value={theme} onValueChange={(value) => onThemeChange(value as Theme)}>
                {THEMES.map((t) => (
                  <Menu.RadioItem key={t.value} value={t.value} className="account-menu-item" closeOnClick>
                    <Menu.RadioItemIndicator className="account-menu-check" keepMounted>
                      {t.value === theme ? '✓' : ''}
                    </Menu.RadioItemIndicator>
                    {t.label}
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Group>
            <Menu.Separator className="account-menu-separator" />
            <Menu.Item className="account-menu-item" onClick={onSignOut}>
              Sign out
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
