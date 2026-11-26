import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, waitFor, within } from 'storybook/test'
import { LongGapReview } from './LongGapReview.tsx'
import type { NeedsALook } from './long-gap.ts'

// Riley, back after a long time offline: two paragraphs someone else changed too
const items: NeedsALook[] = [
  {
    what: 'You both changed this',
    yours: 'Field technicians lose signal in basements, plant rooms and lifts.',
    theirs: 'Field technicians lose signal underground.',
    over: { kind: 'edit', id: 'b3', source: 'x', was: 'y' },
  },
  {
    what: 'You changed this, and someone took it out',
    yours: 'Ship behind a flag, one team at a time, starting with the night shift.',
    theirs: null,
    over: { kind: 'insert', at: { after: 'b3' }, markdown: 'x' },
  },
]

const meta = {
  title: 'Ideas/LongGapReview',
  component: LongGapReview,
  args: { open: true, items, onYours: fn(), onTheirs: fn(), onClose: fn() },
} satisfies Meta<typeof LongGapReview>

export default meta
type Story = StoryObj<typeof meta>

// Yours and the draft's side by side, for each, with a choice of which to keep
export const TwoToChoose: Story = {
  play: async ({ canvasElement, args, userEvent }) => {
    const dialog = within(canvasElement.ownerDocument.body).getByRole('dialog', { name: 'What you typed while away' })
    const page = within(dialog)
    await expect(page.getByText(/What only you changed is in the draft/)).toBeVisible()
    await expect(page.getByText(/2 changes/)).toBeVisible()
    const first = page.getByRole('listitem', { name: 'You both changed this' })
    await expect(within(first).getByText('Field technicians lose signal underground.')).toBeVisible()
    // someone took the second out: the draft's side says so
    const second = page.getByRole('listitem', { name: 'You changed this, and someone took it out' })
    await expect(within(second).getByText('Taken out')).toBeVisible()
    await userEvent.click(within(first).getByRole('button', { name: 'Use yours' }))
    await expect(args.onYours).toHaveBeenCalledWith(0)
    await userEvent.click(within(second).getByRole('button', { name: 'Keep the draft’s' }))
    await expect(args.onTheirs).toHaveBeenCalledWith(1)
  },
}

// While one is sent, nothing else can be chosen
export const Sending: Story = {
  args: { busy: 0 },
  play: async ({ canvasElement }) => {
    const dialog = within(canvasElement.ownerDocument.body).getByRole('dialog')
    await expect(within(dialog).getByRole('button', { name: 'Using yours…' })).toBeDisabled()
    for (const button of within(dialog).getAllByRole('button', { name: 'Keep the draft’s' })) {
      await expect(button).toBeDisabled()
    }
  },
}

// Each chosen goes from the list, and the dialog closes after the last (as the page does)
export const ChosenOneByOne: Story = {
  render: function Render(args) {
    const [left, setLeft] = useState(args.items)
    const drop = (i: number) => setLeft((now) => now.filter((_, j) => j !== i))
    return <LongGapReview {...args} open={left.length > 0} items={left} onYours={drop} onTheirs={drop} />
  },
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(body.getAllByRole('button', { name: 'Use yours' })[0]!)
    await expect(body.getByText(/1 change\./)).toBeVisible()
    await userEvent.click(body.getByRole('button', { name: 'Keep the draft’s' }))
    await waitFor(() => expect(body.queryByRole('dialog')).toBeNull())
  },
}
