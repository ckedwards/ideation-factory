import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'
import { NotificationSettingsForm } from './NotificationSettingsForm.tsx'

const defaults = {
  ownBots: true,
  email: 'involved',
  emailWatching: false,
  cadence: 'bundled',
  emailAvailable: true,
} as const

const meta = {
  title: 'Settings/NotificationSettingsForm',
  component: NotificationSettingsForm,
  args: { value: defaults, onChange: fn() },
} satisfies Meta<typeof NotificationSettingsForm>

export default meta
type Story = StoryObj<typeof meta>

// The defaults: everything you're involved in, an email per idea
export const Defaults: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await userEvent.selectOptions(page.getByRole('combobox', { name: 'Email me' }), 'review-requests')
    await expect(args.onChange).toHaveBeenCalledWith({ email: 'review-requests' })
    await userEvent.selectOptions(page.getByRole('combobox', { name: 'How often' }), 'daily')
    await expect(args.onChange).toHaveBeenCalledWith({ cadence: 'daily' })
    await userEvent.click(page.getByRole('checkbox', { name: /teams I watch/ }))
    await expect(args.onChange).toHaveBeenCalledWith({ emailWatching: true })
  },
}

// Email off: nothing more to choose
export const EmailOff: Story = {
  args: { value: { ...defaults, email: 'off' } },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(page.queryByRole('combobox', { name: 'How often' })).toBeNull()
    await expect(page.queryByRole('checkbox', { name: /teams I watch/ })).toBeNull()
  },
}

// A server without email: only the inbox setting
export const NoEmail: Story = {
  args: { value: { ...defaults, emailAvailable: false } },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(page.getByText('This server doesn’t send notification emails.')).toBeVisible()
    await expect(page.queryByRole('combobox')).toBeNull()
  },
}

export const Loading: Story = { args: { value: null } }
