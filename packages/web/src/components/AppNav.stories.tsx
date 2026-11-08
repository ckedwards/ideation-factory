import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { Theme } from '@ideaf/ui'
import { longName, riley } from '@ideaf/ui/fixtures'
import { expect, fn, within } from 'storybook/test'
import { AppNav, type AppNavProps } from './AppNav.tsx'

function Nav(props: Omit<AppNavProps, 'theme' | 'onThemeChange'>) {
  const [theme, setTheme] = useState<Theme>('auto')
  return <AppNav {...props} theme={theme} onThemeChange={setTheme} />
}

const meta = {
  title: 'App/AppNav',
  component: Nav,
  args: {
    me: riley,
    teams: [
      { handle: 'mobile', name: 'Mobile' },
      { handle: 'payments', name: 'Payments' },
    ],
    current: 'home',
    onSignOut: fn(),
  },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Nav>

export default meta
type Story = StoryObj<typeof meta>

// On the home page: its link marked, the person signed in at the bottom
export const Home: Story = {
  play: async ({ canvasElement }) => {
    const nav = within(canvasElement)
    await expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    await expect(nav.getByText(riley.name)).toBeVisible()
  },
}

// A page the nav doesn't list: nothing marked
export const ElsewhereInTheApp: Story = { args: { current: null } }

// A long name doesn't push the theme picker out
export const LongName: Story = { args: { me: longName } }

// Signing out
export const SignOut: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Sign out' }))
    await expect(args.onSignOut).toHaveBeenCalled()
  },
}

// In no team yet: the way to find one
export const NoTeams: Story = {
  args: { teams: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('link', { name: 'Find a team to join' })).toHaveAttribute(
      'href',
      '/teams',
    )
  },
}

// Ideas with news in your inbox, as a count by Notifications (99+ at most)
export const Unread: Story = {
  args: { unread: 140 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('99+')).toBeVisible()
  },
}
