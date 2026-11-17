import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'
import { Tabs } from './Tabs.tsx'

type Pane = 'comments' | 'versions' | 'details'

function Stateful({ start = 'comments' }: { start?: Pane }) {
  const [pane, setPane] = useState<Pane>(start)
  return (
    <Tabs
      label="Panel"
      tabs={[
        { id: 'comments', label: 'Comments', count: 4 },
        { id: 'versions', label: 'Versions' },
        { id: 'details', label: 'Details' },
      ]}
      value={pane}
      onChange={setPane}
    >
      <p style={{ margin: 0 }}>The {pane} panel.</p>
    </Tabs>
  )
}

const meta = { title: 'Layout/Tabs', component: Stateful } satisfies Meta<typeof Stateful>

export default meta
type Story = StoryObj<typeof meta>

export const Comments: Story = {}

export const Details: Story = { args: { start: 'details' } }

// The arrow keys move between tabs, and the panel follows
export const Keyboard: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.tab()
    await userEvent.keyboard('{ArrowRight}')
    await expect(canvas.getByRole('tab', { name: 'Versions' })).toHaveFocus()
    await expect(canvas.getByRole('tabpanel')).toHaveTextContent('The versions panel.')
    await userEvent.keyboard('{End}')
    await expect(canvas.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true')
  },
}

// More tabs than fit: they scroll on their own, each on one line, and the page around them keeps its width
export const TooManyToFit: Story = {
  render: () => (
    <div style={{ width: '18rem' }} data-testid="narrow">
      <Tabs
        label="Settings"
        tabs={[
          { id: 'members', label: 'Members', count: 6 },
          { id: 'groups', label: 'Groups' },
          { id: 'requests', label: 'Requests', count: 1 },
          { id: 'requirements', label: 'Approval requirements' },
          { id: 'general', label: 'General' },
          { id: 'access', label: 'Access' },
        ]}
        value="members"
        onChange={() => {}}
      >
        <p style={{ margin: 0 }}>Members.</p>
      </Tabs>
    </div>
  ),
  play: async ({ canvas }) => {
    const narrow = canvas.getByTestId('narrow')
    const list = canvas.getByRole('tablist')
    await expect(narrow.scrollWidth).toBeLessThanOrEqual(narrow.clientWidth)
    await expect(list.scrollWidth).toBeGreaterThan(list.clientWidth)
    const tab = canvas.getByRole('tab', { name: 'Approval requirements' })
    await expect(tab.getBoundingClientRect().height).toBeLessThan(40)
  },
}
