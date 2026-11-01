import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'
import { GroupTag } from './GroupTag.tsx'

const meta = {
  title: 'Teams/GroupTag',
  component: GroupTag,
  args: { group: { name: 'Platform team' }, href: '#groups/platform' },
} satisfies Meta<typeof GroupTag>

export default meta
type Story = StoryObj<typeof meta>

export const Group: Story = {}

export const Deleted: Story = { args: { group: { name: 'Architecture council', deleted: true } } }

export const WithoutLink: Story = { args: { href: undefined } }

export const KeyboardFocus: Story = {
  play: async ({ canvas }) => {
    const link = canvas.getByRole('link')
    link.focus()
    await expect(link).toHaveFocus()
  },
}
