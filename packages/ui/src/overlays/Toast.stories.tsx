import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Toast } from './Toast.tsx'
import { expect, within } from 'storybook/test'
import { Button } from '../controls/Button.tsx'

function Stateful({ message, action }: { message: string; action?: string }) {
  const [shown, setShown] = useState<string | null>(message)
  return (
    <>
      <Button onClick={() => setShown(message)}>Show again</Button>
      <Toast
        message={shown}
        onDismiss={() => setShown(null)}
        duration={60_000}
        action={action ? { label: action, onAction: () => {} } : undefined}
      />
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

// Something to do about it: taking it dismisses the note
export const WithAction: Story = {
  args: { message: 'Priya committed version 7. What you type now goes into the next one.', action: 'See it' },
  play: async ({ canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await userEvent.click(page.getByRole('button', { name: 'See it' }))
    await expect(page.queryByText(/Priya committed version 7/)).toBeNull()
  },
}

export const LongMessage: Story = {
  args: {
    message:
      'Only “Offline-first sync for the field app” and “Ideation Factory MVP architecture” have an idea page in this prototype, so this one opens nowhere yet.',
  },
}
