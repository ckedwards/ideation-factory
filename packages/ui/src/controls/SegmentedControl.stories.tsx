import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'
import { SegmentedControl, type SegmentedControlProps } from './SegmentedControl.tsx'

type Filter = 'open' | 'resolved' | 'all'

function Stateful(props: Omit<SegmentedControlProps<Filter>, 'value' | 'onChange'> & { value: Filter }) {
  const [value, setValue] = useState(props.value)
  return <SegmentedControl {...props} value={value} onChange={setValue} />
}

const meta = {
  title: 'Controls/SegmentedControl',
  component: Stateful,
  args: {
    label: 'Comments',
    value: 'open',
    options: [
      { value: 'open', label: 'Open' },
      { value: 'resolved', label: 'Resolved' },
      { value: 'all', label: 'All' },
    ],
  },
} satisfies Meta<typeof Stateful>

export default meta
type Story = StoryObj<typeof meta>

export const Choice: Story = {}

// Tab reaches the chosen option; the arrow keys choose the next one
export const Keyboard: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.tab()
    await expect(canvas.getByRole('radio', { name: 'Open' })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(canvas.getByRole('radio', { name: 'Resolved' })).toHaveFocus()
    await expect(canvas.getByRole('radio', { name: 'Resolved' })).toBeChecked()
  },
}
