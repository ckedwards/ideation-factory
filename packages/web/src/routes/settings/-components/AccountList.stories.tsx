import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'
import { AccountList } from './AccountList.tsx'

const signOut = fn()

const meta = {
  title: 'Settings/AccountList',
  component: AccountList,
  args: {
    label: 'Where you’re signed in',
    empty: 'Nowhere else.',
    items: [
      { id: 's1', title: 'Chrome on macOS', sub: 'Signed in 2 days ago', current: true },
      {
        id: 's2',
        title: 'Firefox on Linux',
        sub: 'Signed in 5 hours ago',
        action: { label: 'Sign out', onClick: signOut },
      },
      { id: 's3', title: 'The cli', sub: 'Signed in a week ago', action: { label: 'Sign out', onClick: signOut } },
    ],
  },
} satisfies Meta<typeof AccountList>

export default meta
type Story = StoryObj<typeof meta>

// The one you're using is marked, and can't be ended from here
export const Sessions: Story = {
  play: async ({ canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await expect(page.getByText('this one')).toBeVisible()
    await expect(page.getAllByRole('button', { name: 'Sign out' })).toHaveLength(2)
    await userEvent.click(page.getAllByRole('button', { name: 'Sign out' })[0]!)
    await expect(signOut).toHaveBeenCalled()
  },
}

export const Empty: Story = {
  args: { items: [], empty: 'No passkeys yet: you sign in with a code sent to your email.' },
}
