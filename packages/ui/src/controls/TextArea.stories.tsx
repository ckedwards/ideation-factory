import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { TextArea } from './TextArea.tsx'

function Stateful({ value, placeholder }: { value: string; placeholder?: string }) {
  const [text, setText] = useState(value)
  return <TextArea value={text} onChange={setText} rows={3} aria-label="Comment" placeholder={placeholder} />
}

const meta = {
  title: 'Controls/TextArea',
  component: Stateful,
  args: { value: '', placeholder: 'Add a comment…' },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '24rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Stateful>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}

export const Filled: Story = { args: { value: 'This could say what happens to a change made offline twice.' } }
