import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, waitFor, within } from 'storybook/test'
import { ProfileForm } from './ProfileForm.tsx'

const meta = {
  title: 'Settings/ProfileForm',
  component: ProfileForm,
  args: {
    name: 'Riley Park',
    handle: 'riley',
    onName: fn(async () => {}),
    onHandle: fn(async () => {}),
    isFree: fn(async (handle: string) => handle !== 'maya'),
  },
} satisfies Meta<typeof ProfileForm>

export default meta
type Story = StoryObj<typeof meta>

// A free handle: saved, and the old one still leads here
export const NewHandle: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    const field = page.getByRole('textbox', { name: 'Handle' })
    await userEvent.clear(field)
    await userEvent.type(field, 'riley-park')
    await userEvent.click(page.getByRole('button', { name: 'Change' }))
    await waitFor(() => expect(args.onHandle).toHaveBeenCalledWith('riley-park'))
    await expect(page.getByText(/@riley still leads to you/)).toBeVisible()
  },
}

// A taken handle, or one that isn't a handle: said why, nothing saved
export const Taken: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    const field = page.getByRole('textbox', { name: 'Handle' })
    await userEvent.clear(field)
    await userEvent.type(field, 'maya')
    await userEvent.click(page.getByRole('button', { name: 'Change' }))
    await expect(await page.findByRole('alert')).toHaveTextContent('@maya is taken')
    await userEvent.clear(field)
    await userEvent.type(field, 'Not A Handle')
    await userEvent.click(page.getByRole('button', { name: 'Change' }))
    await expect(await page.findByRole('alert')).toHaveTextContent('lowercase letters')
    await expect(args.onHandle).not.toHaveBeenCalled()
  },
}
