import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'
import { ReviewPanel, type ReviewRow } from './ReviewPanel.tsx'

const maya = { id: 'u-maya', name: 'Maya Chen' }
const devon = { id: 'u-devon', name: 'Devon Ross' }
const AT = Date.now() - 3 * 3600_000

const approved: ReviewRow = {
  reviewer: 'u:u-maya',
  by: { kind: 'person', person: maya },
  verdict: 'approve',
  version: 3,
  body: 'The retry rules read well now.',
  at: AT,
  dismissed: null,
  counts: true,
  standing: false,
}
const changes: ReviewRow = {
  reviewer: 'u:u-devon',
  by: { kind: 'person', person: devon },
  verdict: 'request-changes',
  version: 2,
  body: 'Say what happens to a payment that times out twice.',
  at: AT - 3600_000,
  dismissed: null,
  counts: false,
  standing: true,
}
const botApproval: ReviewRow = {
  reviewer: 'b:u-maya:checkbot',
  by: { kind: 'bot-for-person', bot: 'checkbot', person: maya },
  verdict: 'approve',
  version: 3,
  body: '',
  at: AT,
  dismissed: null,
  counts: false,
  standing: false,
}

const meta = {
  title: 'Ideas/ReviewPanel',
  component: ReviewPanel,
  args: {
    status: { status: 'requesting review' },
    latest: 3,
    reviewers: [
      { key: 'user:u-devon', subject: { kind: 'user', id: 'u-devon' }, label: 'Devon Ross (@devon)' },
      { key: 'group:g1', subject: { kind: 'group', id: 'g1' }, label: 'Security (group)' },
    ],
    reviews: [changes, approved, botApproval],
    requirements: [],
    canEdit: true,
    canReview: true,
    onStatus: fn(),
    onClose: fn(async () => {}),
    onReopen: fn(),
    onReview: fn(async () => {}),
    onDismiss: fn(async () => {}),
  },
} satisfies Meta<typeof ReviewPanel>

export default meta
type Story = StoryObj<typeof meta>

// Each reviewer's latest verdict: approvals count only on the latest version,
// and only a person's; an objection stands until it's withdrawn or dismissed
export const Verdicts: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(page.getByText('1 approval of v3')).toBeVisible()
    await expect(page.getByText('a bot’s: doesn’t count')).toBeVisible()
    await expect(page.getByText('Stands')).toBeVisible()
    await expect(page.getByText(/An objection stands/)).toBeVisible()
  },
}

// The team's requirements, checked: closing as accepted waits for them
export const Requirements: Story = {
  args: {
    reviews: [approved],
    requirements: [
      { text: '2 approvals from people', met: false, progress: '1 so far' },
      { text: 'An approval from any of Security, Legal', met: true },
      { text: 'Every discussion resolved', met: false, progress: '2 open' },
    ],
  },
  play: async ({ canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await expect(page.getByText('Its team’s requirements')).toBeVisible()
    await expect(page.getByText('(1 so far)')).toBeVisible()
    await userEvent.click(page.getByRole('button', { name: 'Close…' }))
    const dialog = within(canvasElement.ownerDocument.body)
    await userEvent.click(dialog.getByRole('radio', { name: 'Accepted: it goes ahead' }))
    await expect(dialog.getByRole('button', { name: 'Close as accepted' })).toBeDisabled()
    await expect(dialog.getByText(/requirements aren’t met yet/)).toBeVisible()
  },
}

// Dismissing an objection asks why
export const Dismissing: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await userEvent.click(page.getByRole('button', { name: 'Dismiss' }))
    const submit = page.getAllByRole('button', { name: 'Dismiss' }).at(-1)!
    await expect(submit).toBeDisabled()
    await userEvent.type(page.getByLabelText('Why it’s dismissed'), 'Covered in v3')
    await userEvent.click(submit)
    await expect(args.onDismiss).toHaveBeenCalledWith('u:u-devon', 'Covered in v3')
  },
}

// Giving your verdict on the latest version
export const Reviewing: Story = {
  args: { canEdit: false, reviews: [approved] },
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await expect(page.queryByRole('button', { name: 'Close…' })).toBeNull()
    await userEvent.click(page.getByRole('radio', { name: 'Request changes' }))
    await userEvent.type(page.getByLabelText('Summary'), 'Name the risks')
    await userEvent.click(page.getByRole('button', { name: 'Submit review' }))
    await expect(args.onReview).toHaveBeenCalledWith('request-changes', 'Name the risks')
  },
}

// Closing: accepted can't be chosen while an objection stands
export const ClosingBlocked: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await userEvent.click(page.getByRole('button', { name: 'Close…' }))
    const dialog = within(canvasElement.ownerDocument.body)
    await userEvent.click(dialog.getByRole('radio', { name: 'Accepted: it goes ahead' }))
    await expect(dialog.getByRole('button', { name: 'Close as accepted' })).toBeDisabled()
    await expect(dialog.getByText(/A reviewer objects/)).toBeVisible()
    await userEvent.click(dialog.getByRole('radio', { name: 'Rejected: it doesn’t' }))
    await userEvent.click(dialog.getByRole('button', { name: 'Close as rejected' }))
    await expect(args.onClose).toHaveBeenCalledWith('rejected', '')
  },
}

// Closed: it can be reopened, and takes no verdicts
export const Closed: Story = {
  args: { status: { status: 'closed', reason: 'accepted' }, reviews: [approved] },
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await expect(page.getByText('Closed · accepted')).toBeVisible()
    await expect(page.queryByRole('button', { name: 'Submit review' })).toBeNull()
    await userEvent.click(page.getByRole('button', { name: 'Reopen' }))
    await expect(args.onReopen).toHaveBeenCalled()
  },
}

// The owner's own idea: no review form; nobody asked yet
export const Owner: Story = {
  args: {
    canReview: false,
    reviewers: [],
    reviews: [],
    status: { status: 'draft' },
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(page.getByText('Nobody’s been asked yet.')).toBeVisible()
    await expect(page.queryByRole('button', { name: 'Submit review' })).toBeNull()
  },
}

// Someone with share access asks people and groups to review
export const Asking: Story = {
  args: { onAsk: fn(async () => {}) },
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await userEvent.click(page.getAllByRole('button', { name: 'Take off the reviewers' })[0]!)
    await expect(args.onAsk).toHaveBeenCalledWith({ kind: 'user', id: 'u-devon' }, false)
    await expect(page.getByRole('button', { name: 'Ask to review' })).toBeDisabled()
  },
}
