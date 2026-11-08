import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { StatusControl, type OpenStatus } from './StatusControl.tsx'

function Stateful({ value, canChange }: { value: OpenStatus; canChange?: boolean }) {
  const [status, setStatus] = useState(value)
  return <StatusControl value={status} onChange={setStatus} canChange={canChange ?? true} />
}

const meta = {
  title: 'Ideas/StatusControl',
  component: Stateful,
  args: { value: 'requesting review' },
} satisfies Meta<typeof Stateful>

export default meta
type Story = StoryObj<typeof meta>

export const Author: Story = {}

export const Draft: Story = { args: { value: 'draft' } }

export const ChangesInProgress: Story = { args: { value: 'changes in progress' } }

// Without edit access, the status shows without the picker
export const NotAuthor: Story = { args: { canChange: false } }
