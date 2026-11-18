import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { AppShell, Page, PageHeader, type Theme } from '@ideaf/ui'
import { longName, riley } from '@ideaf/ui/fixtures'
import { expect, fn, within } from 'storybook/test'
import { AppBar, type AppBarProps } from './AppBar.tsx'
import { AppNav } from './AppNav.tsx'

// the bar as the app draws it: across the top of the shell, the navigation and a page under it
function Shell(props: Omit<AppBarProps, 'theme' | 'onThemeChange'>) {
  const [theme, setTheme] = useState<Theme>('auto')
  return (
    <AppShell
      bar={<AppBar {...props} theme={theme} onThemeChange={setTheme} />}
      nav={<AppNav me={props.me} teams={[{ handle: 'mobile', name: 'Mobile' }]} current="home" />}
    >
      <Page>
        <PageHeader title="Home" />
        <p>The page starts under the bar.</p>
      </Page>
    </AppShell>
  )
}

const meta = {
  title: 'App/AppBar',
  component: Shell,
  args: { me: riley, unread: 4, onSignOut: fn() },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Shell>

export default meta
type Story = StoryObj<typeof meta>

// A wide window: the site's name on the left, the envelope and the avatar on the right, and no Menu (the
// navigation is beside the page)
export const Wide: Story = {
  globals: { viewport: { value: 'desktop' } },
  play: async ({ canvasElement }) => {
    const bar = within(canvasElement.querySelector('header')!)
    await expect(bar.getByRole('link', { name: 'Ideation Factory' })).toHaveAttribute('href', '/')
    await expect(bar.getByRole('link', { name: 'Notifications, 4 unread' })).toBeVisible()
    await expect(bar.getByRole('button', { name: /settings, theme, sign out/ })).toBeVisible()
    await expect(canvasElement.querySelector('.app-shell-menu')).not.toBeVisible()
  },
}

// A phone: the same bar, with Menu at its right end, after the avatar
export const Narrow: Story = {
  globals: { viewport: { value: 'mobile2' } },
  play: async ({ canvasElement }) => {
    const bar = within(canvasElement.querySelector('header')!)
    await expect(bar.getByRole('button', { name: /settings, theme, sign out/ })).toBeVisible()
    await expect(bar.getByRole('button', { name: 'Menu' })).toBeVisible()
  },
}

// On the inbox: the envelope is marked as the page being shown
export const OnTheInbox: Story = {
  args: { inbox: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('link', { name: /^Notifications/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
  },
}

// Ideas with news in your inbox: the count stops at 99+
export const ManyUnread: Story = {
  args: { unread: 140 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('99+')).toBeVisible()
  },
}

// A long name is in the avatar's title, not the bar
export const LongName: Story = { args: { me: longName } }

// Signing out, from the account menu
export const SignOut: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /settings, theme, sign out/ }))
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole('menuitem', { name: 'Sign out' }))
    await expect(args.onSignOut).toHaveBeenCalled()
  },
}
