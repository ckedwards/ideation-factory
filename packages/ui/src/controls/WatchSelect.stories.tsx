import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { WatchSelect, type WatchLevel } from './WatchSelect.tsx'

function Stateful({ value, label }: { value: WatchLevel; label?: string }) {
  const [level, setLevel] = useState(value)
  return <WatchSelect value={level} onChange={setLevel} {...(label ? { label } : {})} />
}

const meta = {
  title: 'Controls/WatchSelect',
  component: Stateful,
  args: { value: 'participating' },
} satisfies Meta<typeof Stateful>

export default meta
type Story = StoryObj<typeof meta>

// The default, so not highlighted
export const Participating: Story = {}

export const ActiveIdeas: Story = { args: { value: 'active' } }

export const AllIdeas: Story = { args: { value: 'all' } }

export const OwnLabel: Story = { args: { value: 'active', label: 'Watching' } }
