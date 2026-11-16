import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'
import { riley } from '../stories/fixtures.ts'
import { AccountMenu } from './AccountMenu.tsx'

const meta = {
  title: 'People/AccountMenu',
  component: AccountMenu,
  args: { person: riley, settingsHref: '#settings', theme: 'auto', onThemeChange: fn(), onSignOut: fn() },
  decorators: [
    (Story) => (
      <div style={{ width: '15rem', paddingTop: '18rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AccountMenu>

export default meta
type Story = StoryObj<typeof meta>

// One button: your settings, the theme and signing out, in a menu
export const Menu: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.click(within(canvasElement).getByRole('button', { name: /settings, theme, sign out/ }))
    await expect(await page.findByRole('menuitem', { name: 'Your settings' })).toHaveAttribute('href', '#settings')
    await expect(page.getByRole('menuitemradio', { name: /Auto/ })).toBeChecked()
    await userEvent.click(page.getByRole('menuitemradio', { name: /Dark/ }))
    await expect(args.onThemeChange).toHaveBeenCalledWith('dark')
    await userEvent.click(within(canvasElement).getByRole('button', { name: /settings, theme, sign out/ }))
    await userEvent.click(await page.findByRole('menuitem', { name: 'Sign out' }))
    await expect(args.onSignOut).toHaveBeenCalled()
  },
}
