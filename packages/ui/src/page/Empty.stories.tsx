import type { Meta, StoryObj } from '@storybook/react-vite'
import { Empty } from './Empty.tsx'
import { Button } from '../controls/Button.tsx'

const meta = {
  title: 'Page/Empty',
  component: Empty,
  args: { children: 'No ideas match these filters.' },
} satisfies Meta<typeof Empty>

export default meta
type Story = StoryObj<typeof meta>

export const Message: Story = {}

export const WithAction: Story = {
  args: {
    children: 'No ideas in Mobile yet.',
    action: <Button variant="primary">Start an idea</Button>,
  },
}
