import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { Dialog } from './Dialog.tsx'
import { Button } from '../controls/Button.tsx'

function Stateful({ startOpen = true, long = false }: { startOpen?: boolean; long?: boolean }) {
  const [open, setOpen] = useState(startOpen)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Leave team</Button>
      <Dialog
        open={open}
        title="Leave Mobile?"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => setOpen(false)}>
              Leave team
            </Button>
          </>
        }
      >
        <p>You’ll stop seeing Mobile’s ideas unless they’re shared with you, and you won’t get its notifications.</p>
        {long &&
          Array.from({ length: 12 }, (_, i) => (
            <p key={i}>
              Ideas you wrote stay in Mobile, and you keep access to them as their author. Reviews you were asked for
              stay open.
            </p>
          ))}
      </Dialog>
    </>
  )
}

const meta = {
  title: 'Overlays/Dialog',
  component: Stateful,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Stateful>

export default meta
type Story = StoryObj<typeof meta>

export const Open: Story = {}

export const LongContent: Story = { args: { long: true } }

// Opening moves focus inside; Esc closes it and focus returns to the button
export const Keyboard: Story = {
  args: { startOpen: false },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const opener = canvas.getByRole('button', { name: 'Leave team' })
    await userEvent.click(opener)
    const page = within(canvasElement.ownerDocument.body)
    const dialog = page.getByRole('dialog', { name: 'Leave Mobile?' })
    await expect(dialog).toBeVisible()
    await expect(dialog.contains(canvasElement.ownerDocument.activeElement)).toBe(true)
    await userEvent.keyboard('{Escape}')
    await expect(dialog).not.toBeVisible()
    await expect(opener).toHaveFocus()
  },
}
