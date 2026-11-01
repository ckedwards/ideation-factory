import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'
import { TeamChip } from './TeamChip.tsx'

const meta = {
  title: 'Teams/TeamChip',
  component: TeamChip,
  args: { team: { name: 'Mobile' }, href: '#teams/mobile' },
} satisfies Meta<typeof TeamChip>

export default meta
type Story = StoryObj<typeof meta>

export const Team: Story = {}

export const Locked: Story = { args: { team: { name: 'Security', locked: true } } }

export const YourIdeas: Story = { args: { team: { name: 'Your ideas', personal: true }, href: '#teams/me' } }

export const SomeoneElsesIdeas: Story = { args: { team: { name: 'Riley Park’s ideas', personal: true } } }

export const Archived: Story = { args: { team: { name: 'Payments (2024)', archived: true } } }

export const WithoutLink: Story = { args: { href: undefined } }

export const LongName: Story = {
  args: { team: { name: 'Platform Reliability, Observability and Developer Experience' } },
  render: (args) => (
    <div style={{ width: '12rem', display: 'flex' }}>
      <TeamChip {...args} />
    </div>
  ),
}

export const KeyboardFocus: Story = {
  play: async ({ canvas }) => {
    const link = canvas.getByRole('link')
    link.focus()
    await expect(link).toHaveFocus()
  },
}
