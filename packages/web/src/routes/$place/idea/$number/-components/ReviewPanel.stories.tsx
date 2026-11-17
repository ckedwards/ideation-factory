import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'
import { CloseOrReopen, IdeaStatus, ReviewButton, ReviewPanel, type ReviewRow } from './ReviewPanel.tsx'

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
  // as the overview has them: the status and closing in its header, the panel beside the activity
  render: (args) => (
    <div style={{ display: 'grid', gap: '1rem', maxWidth: '20rem' }}>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
        <IdeaStatus {...args} />
        <CloseOrReopen {...args} />
        <ReviewButton {...args} />
      </div>
      <ReviewPanel {...args} />
    </div>
  ),
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
    // what each said is in the activity, not again here: the column is for where things stand
    await expect(page.queryByText('Say what happens to a payment that times out twice.')).toBeNull()
    // each reviewer says where they are: Devon asked for changes on v2; Security hasn't approved
    const reviewers = page.getAllByRole('listitem').filter((li) => li.classList.contains('review-panel-reviewer'))
    await expect(reviewers[0]).toHaveTextContent('Changes requested v2')
    await expect(reviewers[1]).toHaveTextContent('Not yet')
  },
}

// What each person asked has opened since their verdict, or at all: Devon read v3 after asking for changes on v2,
// Sam hasn't opened it, and Ana has read the latest. A group says nothing of it
export const Seen: Story = {
  args: {
    reviewers: [
      { key: 'user:u-devon', subject: { kind: 'user', id: 'u-devon' }, label: 'Devon Ross (@devon)', seen: 3 },
      { key: 'user:u-sam', subject: { kind: 'user', id: 'u-sam' }, label: 'Sam Ortiz (@sam)', seen: null },
      { key: 'user:u-ana', subject: { kind: 'user', id: 'u-ana' }, label: 'Ana Lima (@ana)', seen: 3 },
      { key: 'group:g1', subject: { kind: 'group', id: 'g1' }, label: 'Security (group)' },
    ],
  },
  play: async ({ canvasElement }) => {
    const reviewers = [...canvasElement.querySelectorAll('.review-panel-reviewer')]
    await expect(reviewers[0]).toHaveTextContent('Changes requested v2 · seen the latest')
    await expect(reviewers[1]).toHaveTextContent('Not yet · hasn’t opened it')
    await expect(reviewers[2]).toHaveTextContent('Not yet · seen the latest')
    await expect(reviewers[3]).toHaveTextContent('Not yet')
    await expect(reviewers[3]).not.toHaveTextContent('seen')
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
    // the form waits behind a button, so the idea is read first
    await expect(page.queryByRole('radio', { name: 'Approve' })).toBeNull()
    await userEvent.click(page.getByRole('button', { name: 'Give your review' }))
    const dialog = within(canvasElement.ownerDocument.body)
    // the verdicts are as wide as they are, not the dialog's width; and the dialog has a way out
    const verdicts = dialog.getByRole('radiogroup', { name: 'Your verdict' })
    const form = verdicts.closest('form')!
    await expect(verdicts.getBoundingClientRect().width).toBeLessThan(form.getBoundingClientRect().width - 40)
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await userEvent.click(dialog.getByRole('radio', { name: 'Request changes' }))
    await userEvent.type(dialog.getByLabelText('Summary'), 'Name the risks')
    await userEvent.click(dialog.getByRole('button', { name: 'Submit review' }))
    await expect(args.onReview).toHaveBeenCalledWith('request-changes', 'Name the risks')
    await expect(dialog.queryByRole('dialog', { name: 'Your review of v3' })).toBeNull()
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
    await expect(page.queryByRole('button', { name: 'Give your review' })).toBeNull()
    await userEvent.click(page.getByRole('button', { name: 'Reopen' }))
    await expect(args.onReopen).toHaveBeenCalled()
  },
}

// Comments waiting in your review go out with it, or on their own
export const WithPending: Story = {
  args: { reviews: [approved], pending: 3, onDiscard: fn() },
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    const dialog = within(canvasElement.ownerDocument.body)
    await userEvent.click(page.getByRole('button', { name: 'Finish your review (3)' }))
    await expect(dialog.getByText(/3 pending comments go out with it/)).toBeVisible()
    await userEvent.click(dialog.getByRole('radio', { name: 'Just my comments' }))
    await expect(dialog.queryByLabelText('Summary')).toBeNull()
    await userEvent.click(dialog.getByRole('button', { name: 'Publish my comments' }))
    await expect(args.onReview).toHaveBeenCalledWith(null, '')
    await userEvent.click(page.getByRole('button', { name: 'Finish your review (3)' }))
    await userEvent.click(dialog.getByRole('button', { name: 'Discard pending comments' }))
    await expect(args.onDiscard).toHaveBeenCalled()
  },
}

// The owner can't give a verdict, but can publish what they have pending
export const OwnerWithPending: Story = {
  args: { canReview: false, reviews: [], pending: 1 },
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    const dialog = within(canvasElement.ownerDocument.body)
    await userEvent.click(page.getByRole('button', { name: 'Finish your review (1)' }))
    await expect(dialog.queryByRole('radio', { name: 'Approve' })).toBeNull()
    await userEvent.click(dialog.getByRole('button', { name: 'Publish my comments' }))
    await expect(args.onReview).toHaveBeenCalledWith(null, '')
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
    await expect(page.queryByRole('button', { name: 'Give your review' })).toBeNull()
  },
}

// Someone with share access asks people and groups to review
export const Asking: Story = {
  args: { onAsk: fn(async () => {}) },
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    // taking someone off is in their row's menu, not a bare × beside their state
    await userEvent.click(page.getByRole('button', { name: 'Devon Ross (@devon): actions' }))
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'Remove from the reviewers' }))
    await expect(args.onAsk).toHaveBeenCalledWith({ kind: 'user', id: 'u-devon' }, false)
    // asking is behind a button, done once or twice an idea
    await expect(page.queryByRole('button', { name: 'Ask to review' })).toBeNull()
    await userEvent.click(page.getByRole('button', { name: '+ Ask for a review' }))
    await expect(page.getByRole('button', { name: 'Ask to review' })).toBeDisabled()
    await userEvent.click(page.getByRole('button', { name: 'Cancel' }))
    await expect(page.getByRole('button', { name: '+ Ask for a review' })).toBeVisible()
  },
}
