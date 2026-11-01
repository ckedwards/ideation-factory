import type { Meta, StoryObj } from '@storybook/react-vite'
import { RelativeTime } from './RelativeTime.tsx'
import { NOW } from '../stories/fixtures.ts'

const meta = {
  title: 'Labels/RelativeTime',
  component: RelativeTime,
  args: { at: NOW - 5 * 3_600_000 },
} satisfies Meta<typeof RelativeTime>

export default meta
type Story = StoryObj<typeof meta>

export const JustNow: Story = { args: { at: NOW - 20_000 } }

export const Minutes: Story = { args: { at: NOW - 12 * 60_000 } }

export const Hours: Story = {}

export const Days: Story = { args: { at: NOW - 9 * 86_400_000 } }

// Past 45 days, the month instead
export const LongAgo: Story = { args: { at: NOW - 200 * 86_400_000 } }
