import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'
import { Button } from './Button.tsx'

const meta = {
  title: 'Controls/Button',
  component: Button,
  args: { children: 'Request review', variant: 'default', size: 'md' },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Primary: Story = { args: { variant: 'primary', children: 'Apply 3 edits' } }

export const Danger: Story = { args: { variant: 'danger', children: 'Remove from team' } }

export const Variants: Story = {
  render: (args) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
      <Button {...args}>Default</Button>
      <Button {...args} variant="primary">
        Primary
      </Button>
      <Button {...args} variant="ghost">
        Ghost
      </Button>
      <Button {...args} variant="link">
        Link
      </Button>
      <Button {...args} variant="danger">
        Danger
      </Button>
      <Button {...args} disabled>
        Disabled
      </Button>
      <Button {...args} variant="primary" disabled>
        Primary disabled
      </Button>
    </div>
  ),
}

export const Small: Story = { args: { size: 'sm', children: 'Resolve' } }

export const KeyboardFocus: Story = {
  args: { variant: 'primary' },
  play: async ({ canvas, userEvent }) => {
    await userEvent.tab()
    await expect(canvas.getByRole('button')).toHaveFocus()
  },
}
