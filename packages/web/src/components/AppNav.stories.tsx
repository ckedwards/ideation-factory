import type { Meta, StoryObj } from '@storybook/react-vite'
import { riley } from '@ideaf/ui/fixtures'
import { expect, within } from 'storybook/test'
import { AppNav } from './AppNav.tsx'

const meta = {
  title: 'App/AppNav',
  component: AppNav,
  args: {
    me: riley,
    teams: [
      { handle: 'mobile', name: 'Mobile' },
      { handle: 'payments', name: 'Payments' },
    ],
    current: 'home',
  },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof AppNav>

export default meta
type Story = StoryObj<typeof meta>

// On the home page: its link marked, and Home first. The site's name, the envelope and the account are in
// the app's bar, not here.
export const Home: Story = {
  play: async ({ canvasElement }) => {
    const nav = within(canvasElement)
    await expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    await expect(nav.getAllByRole('link')[0]).toHaveTextContent('Home')
    await expect(nav.queryByText(riley.name)).toBeNull()
    await expect(nav.queryByRole('link', { name: /Notifications/ })).toBeNull()
  },
}

// A page the nav doesn't list: nothing marked
export const ElsewhereInTheApp: Story = { args: { current: null } }

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

// The teams you watch, member or not, with how much; the team whose page this is marked
export const WatchingAndTheCurrentTeam: Story = {
  args: {
    currentTeam: 'mobile',
    watching: [
      { handle: 'mobile', name: 'Mobile', level: 'all' },
      { handle: 'payments', name: 'Payments', level: 'active' },
    ],
  },
  play: async ({ canvasElement }) => {
    const nav = within(canvasElement)
    await expect(nav.getByText('Watching')).toBeVisible()
    await expect(nav.getAllByRole('link', { name: /Payments/ }).at(-1)).toHaveTextContent('Active')
    for (const link of nav.getAllByRole('link', { name: /^Mobile/ })) {
      await expect(link).toHaveAttribute('aria-current', 'page')
    }
  },
}
