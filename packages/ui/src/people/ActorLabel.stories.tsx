import type { Meta, StoryObj } from '@storybook/react-vite'
import { ActorLabel } from './ActorLabel.tsx'
import { actors } from '../stories/fixtures.ts'

const meta = {
  title: 'People/ActorLabel',
  component: ActorLabel,
  args: { actor: actors.person },
} satisfies Meta<typeof ActorLabel>

export default meta
type Story = StoryObj<typeof meta>

export const Person: Story = {}

export const BotOnBehalfOfPerson: Story = { args: { actor: actors.botForPerson } }

export const BotOnBehalfOfPersonShort: Story = { args: { actor: actors.botForPerson, short: true } }

export const AutomatedBot: Story = { args: { actor: actors.bot } }

export const InactivePerson: Story = { args: { actor: actors.inactivePerson } }

export const BotForInactivePerson: Story = { args: { actor: actors.botForInactive } }

// Wraps rather than overflowing a narrow column
export const LongNames: Story = {
  args: { actor: actors.longNames },
  render: (args) => (
    <div style={{ width: '18rem' }}>
      <ActorLabel {...args} />
    </div>
  ),
}
