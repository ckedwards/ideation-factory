import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { ViewInVersion } from './ViewInVersion.tsx'

const meta = {
  title: 'Comments/ViewInVersion',
  component: ViewInVersion,
  args: { version: 2, onView: fn() },
} satisfies Meta<typeof ViewInVersion>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const OwnLabel: Story = { args: { label: 'It was last in v2' } }
