import type { Meta, StoryObj } from '@storybook/react-vite'
import { NOW } from '@ideaf/ui/fixtures'
import { expect, fn, within } from 'storybook/test'
import { EarlierDraftBand, EarlierDraftDialogs } from './EarlierDrafts.tsx'

const draft = {
  point: 6,
  at: NOW - 40 * 60_000,
  reason: null,
  who: ['Riley Park'],
  changes: 4,
  first: 'Added “Bring the list of open jobs.”',
  more: 1,
  undone: 0,
  on: null,
  kept: true,
  canDelete: true,
}

const meta = {
  title: 'Ideas/EarlierDrafts',
  component: EarlierDraftBand,
  args: { draft, held: 0, onBack: fn(), onRestore: fn() },
} satisfies Meta<typeof EarlierDraftBand>

export default meta
type Story = StoryObj<typeof meta>

// Over the page while an earlier draft is shown in it: how to read it, and the way back
export const Band: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const band = within(canvasElement)
    await expect(band.getByText('The draft from 40m ago')).toBeVisible()
    await userEvent.click(band.getByRole('button', { name: 'Back to the draft' }))
    await expect(args.onBack).toHaveBeenCalled()
    await userEvent.click(band.getByRole('button', { name: 'Restore this draft' }))
    await expect(args.onRestore).toHaveBeenCalled()
  },
}

// Kept before a discard, on an older version: its reason, and the changes that would come back outdated
export const BeforeADiscard: Story = {
  args: { draft: { ...draft, reason: 'Before Priya Natarajan discarded it' }, held: 2 },
  play: async ({ canvasElement }) => {
    const band = within(canvasElement)
    await expect(band.getByText('Before Priya Natarajan discarded it')).toBeVisible()
    await expect(band.getByText(/2 of its changes would come back outdated/)).toBeVisible()
  },
}

// Restoring asks first: it replaces the draft for everyone
export const AskingToRestore: Story = {
  render: () => (
    <EarlierDraftDialogs asking={{ kind: 'restore', draft }} changes={3} onCancel={fn()} onConfirm={fn()} />
  ),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await expect(page.getByRole('dialog', { name: 'Restore the draft from 40m ago?' })).toBeVisible()
    await expect(page.getByText(/it has 3 changes now, and had 4 then/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Restore for everyone' })).toBeVisible()
  },
}

// Deleting asks first: it can't be taken back
export const AskingToDelete: Story = {
  render: () => <EarlierDraftDialogs asking={{ kind: 'delete', draft }} changes={3} onCancel={fn()} onConfirm={fn()} />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await expect(page.getByRole('dialog', { name: 'Delete this earlier draft?' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Delete it' })).toBeVisible()
  },
}
