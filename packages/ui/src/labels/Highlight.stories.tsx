import type { Meta, StoryObj } from '@storybook/react-vite'
import { Highlight } from './Highlight.tsx'

const meta = {
  title: 'Labels/Highlight',
  component: Highlight,
  args: { text: 'Offline-first sync for the field app', query: 'sync' },
} satisfies Meta<typeof Highlight>

export default meta
type Story = StoryObj<typeof meta>

export const Match: Story = {}

// The start of a word beats the middle of one
export const WordStart: Story = { args: { text: 'Resync the async queue', query: 'sync' } }

export const NoMatch: Story = { args: { query: 'payments' } }

export const NoQuery: Story = { args: { query: '' } }
