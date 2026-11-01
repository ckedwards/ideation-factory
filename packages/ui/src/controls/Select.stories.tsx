import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Select } from './Select.tsx'

type Sort = 'updated' | 'created' | 'title'

const options: { value: Sort; label: string }[] = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'created', label: 'Newest' },
  { value: 'title', label: 'Title' },
]

function Stateful({ emphasized, size }: { emphasized?: boolean; size?: 'sm' | 'md' }) {
  const [value, setValue] = useState<Sort>('updated')
  return (
    <Select
      aria-label="Sort by"
      options={options}
      value={value}
      onChange={setValue}
      emphasized={emphasized ?? false}
      size={size ?? 'md'}
    />
  )
}

const meta = { title: 'Controls/Select', component: Stateful } satisfies Meta<typeof Stateful>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Small: Story = { args: { size: 'sm' } }

export const Emphasized: Story = { args: { emphasized: true } }
