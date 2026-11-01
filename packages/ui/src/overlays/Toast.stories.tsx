import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Toast } from './Toast.tsx'
import { Button } from '../controls/Button.tsx'

function Stateful({ message }: { message: string }) {
  const [shown, setShown] = useState<string | null>(message)
  return (
    <>
      <Button onClick={() => setShown(message)}>Show again</Button>
      <Toast message={shown} onDismiss={() => setShown(null)} duration={60_000} />
    </>
  )
}

const meta = {
  title: 'Overlays/Toast',
  component: Stateful,
  args: { message: 'Mobile: every idea once it’s out of draft, until it’s closed.' },
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div style={{ minHeight: '10rem', padding: '1rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Stateful>

export default meta
type Story = StoryObj<typeof meta>

export const Message: Story = {}

export const LongMessage: Story = {
  args: {
    message:
      'Only “Offline-first sync for the field app” and “Ideation Factory MVP architecture” have an idea page in this prototype, so this one opens nowhere yet.',
  },
}
