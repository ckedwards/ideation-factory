import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, waitFor, within } from 'storybook/test'
import { NewContainer } from './NewContainer.tsx'

const meta = {
  title: 'App/NewContainer',
  component: NewContainer,
  args: { kind: 'team', open: true, onClose: fn(), onCreate: fn(async () => undefined) },
} satisfies Meta<typeof NewContainer>

export default meta
type Story = StoryObj<typeof meta>

// the handle follows the name until it's typed over
export const Team: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.type(page.getByLabelText('Name'), 'Platform & Infra')
    await expect(page.getByLabelText('Handle')).toHaveValue('platform-infra')
    await userEvent.click(page.getByRole('button', { name: 'Create team' }))
    await waitFor(() =>
      expect(args.onCreate).toHaveBeenCalledWith({ name: 'Platform & Infra', handle: 'platform-infra' }),
    )
  },
}

export const Group: Story = {
  args: { kind: 'group' },
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.type(page.getByLabelText('Name'), 'Design review')
    const handle = page.getByLabelText('Handle')
    await userEvent.clear(handle)
    await userEvent.type(handle, 'design')
    await userEvent.type(page.getByLabelText('What it’s for'), 'Everyone who reviews designs')
    await userEvent.click(page.getByRole('button', { name: 'Create group' }))
    await waitFor(() =>
      expect(args.onCreate).toHaveBeenCalledWith({
        name: 'Design review',
        handle: 'design',
        description: 'Everyone who reviews designs',
      }),
    )
  },
}

// the API's refusal, shown on the handle
export const HandleTaken: Story = {
  args: { onCreate: fn(async () => Promise.reject(new Error('the handle mobile is taken'))) },
  play: async ({ canvasElement, userEvent }) => {
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.type(page.getByLabelText('Name'), 'Mobile')
    await userEvent.click(page.getByRole('button', { name: 'Create team' }))
    await expect(await page.findByText('the handle mobile is taken')).toBeInTheDocument()
  },
}
