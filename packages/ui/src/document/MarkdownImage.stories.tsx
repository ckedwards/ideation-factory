import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'
import { MarkdownImage } from './MarkdownImage.tsx'
import { syncFlow } from '../stories/fixtures.ts'

const meta = {
  title: 'Document/MarkdownImage',
  component: MarkdownImage,
  args: {
    alt: 'Sync flow',
    media: { status: 'uploaded', src: syncFlow.v1, name: 'sync-flow.svg', bytes: 1370 },
    externalImages: 'click',
  },
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="prose">
        <p>
          <Story />
        </p>
      </div>
    ),
  ],
} satisfies Meta<typeof MarkdownImage>

export default meta
type Story = StoryObj<typeof meta>

// Uploaded with this version: shown, with its file name and size
export const Uploaded: Story = {}

// In the repository, but the cli didn't upload it, and why
export const OverTheLimit: Story = {
  args: { media: { status: 'not-uploaded', reason: '14.2 MB is over this site’s 10 MB image limit' } },
}

export const NotFound: Story = {
  args: { media: { status: 'not-uploaded', reason: 'not in the repository when this version was uploaded' } },
}

// From another site, by the deployment's setting: shown when asked for…
export const ExternalOnClick: Story = {
  args: { media: { status: 'external', src: syncFlow.v2 } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Show the image/ }))
    await expect(canvas.getByRole('img', { name: 'Sync flow' })).toBeVisible()
  },
}

// …never loaded…
export const ExternalNever: Story = {
  args: { media: { status: 'external', src: 'https://images.example.com/sync-flow.png' }, externalImages: 'never' },
}

// …or always shown
export const ExternalAlways: Story = {
  args: { media: { status: 'external', src: syncFlow.v2 }, externalImages: 'always' },
}
