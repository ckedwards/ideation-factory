import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { IdeaTabs } from './IdeaTabs.tsx'

const meta = {
  title: 'Ideas/IdeaTabs',
  component: IdeaTabs,
  args: {
    current: 'overview',
    overview: '/mobile/idea/9',
    files: '/mobile/idea/9/files',
    changes: '/mobile/idea/9/changes/2..',
  },
} satisfies Meta<typeof IdeaTabs>

export default meta
type Story = StoryObj<typeof meta>

// On the overview, its tab marked
export const Overview: Story = {
  play: async ({ canvasElement }) => {
    const tabs = within(canvasElement)
    await expect(tabs.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
    await expect(tabs.getByRole('link', { name: 'Changes' })).toHaveAttribute('href', '/mobile/idea/9/changes/2..')
  },
}

export const Files: Story = { args: { current: 'files' } }

// A new idea, with one version: nothing has changed yet, so no Changes tab
export const OneVersion: Story = {
  args: { changes: null },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('link', { name: 'Changes' })).toBeNull()
  },
}
