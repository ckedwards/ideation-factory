import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn } from 'storybook/test'
import { DeletedFile } from './DeletedFile.tsx'

const meta = {
  title: 'Ideas/DeletedFile',
  component: DeletedFile,
  args: {
    path: 'sync-states.md',
    content: '# Sync states\n\nOffline, then syncing, then done.\n',
    by: 'Priya Natarajan',
    onRestore: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '40rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DeletedFile>

export default meta
type Story = StoryObj<typeof meta>

/** Someone else deleted the file you're in: its text read-only, and Restore. */
export const BySomeoneElse: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent('Priya Natarajan deleted this file.')
    await userEvent.click(canvas.getByRole('button', { name: 'Restore' }))
    await expect(args.onRestore).toHaveBeenCalled()
  },
}

/** You deleted it. */
export const ByYou: Story = {
  args: { by: null },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent('You deleted this file.')
  },
}
