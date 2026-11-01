import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { Tooltip } from './Tooltip.tsx'
import { Button } from '../controls/Button.tsx'

const meta = {
  title: 'Overlays/Tooltip',
  component: Tooltip,
  args: { content: 'Only its members can see its ideas', children: <Button>Locked team</Button> },
  decorators: [
    (Story) => (
      <div style={{ padding: '6rem 2rem 2rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Tooltip>

export default meta
type Story = StoryObj<typeof meta>

// Hover (after a moment) or focus to open
export const OnAButton: Story = {}

// Something that isn't focusable by itself is made focusable
export const OnText: Story = {
  args: { focusable: true, children: <span>3 of 4 requirements met</span> },
}

export const RichContent: Story = {
  args: {
    focusable: true,
    children: <span>In review</span>,
    content: (
      <div>
        <strong>In review · 1 of 2 requirements met</strong>
        <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1rem' }}>
          <li>✓ At least 1 approval</li>
          <li>○ All discussions resolved (2 open)</li>
        </ul>
      </div>
    ),
  },
}

// Keyboard focus opens it at once; Esc closes it
export const KeyboardFocus: Story = {
  play: async ({ canvasElement, userEvent }) => {
    await userEvent.tab()
    const page = within(canvasElement.ownerDocument.body)
    await expect(await page.findByRole('tooltip')).toHaveTextContent('Only its members can see its ideas')
    await userEvent.keyboard('{Escape}')
    await expect(page.queryByRole('tooltip')).toBeNull()
  },
}
