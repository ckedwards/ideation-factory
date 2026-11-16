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
  },
} satisfies Meta<typeof IdeaTabs>

export default meta
type Story = StoryObj<typeof meta>

// On the overview, its tab marked; the same two tabs for every idea (comparing is under Files)
export const Overview: Story = {
  play: async ({ canvasElement }) => {
    const tabs = within(canvasElement)
    await expect(tabs.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
    await expect(tabs.getAllByRole('link')).toHaveLength(2)
  },
}

export const Files: Story = { args: { current: 'files' } }
