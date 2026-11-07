import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, waitFor, within } from 'storybook/test'
import { TeamProfile } from './TeamProfile.tsx'

const meta = {
  title: 'Teams/TeamProfile',
  component: TeamProfile,
  args: { name: 'Mobile', handle: 'mobile', description: 'The field app.', onSave: fn(async () => {}) },
} satisfies Meta<typeof TeamProfile>

export default meta
type Story = StoryObj<typeof meta>

// Only what changed is saved
export const Rename: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled()
    const handle = page.getByRole('textbox', { name: 'Handle' })
    await userEvent.clear(handle)
    await userEvent.type(handle, 'field-app')
    await userEvent.click(page.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(args.onSave).toHaveBeenCalledWith({ handle: 'field-app' }))
  },
}

// Refused (a taken handle): said why
export const Refused: Story = {
  args: {
    onSave: fn(async () => {
      throw new Error('the team handle "payments" is taken')
    }),
  },
  play: async ({ canvasElement, userEvent }) => {
    const page = within(canvasElement)
    const handle = page.getByRole('textbox', { name: 'Handle' })
    await userEvent.clear(handle)
    await userEvent.type(handle, 'payments')
    await userEvent.click(page.getByRole('button', { name: 'Save' }))
    await expect(await page.findByRole('alert')).toHaveTextContent('is taken')
  },
}
