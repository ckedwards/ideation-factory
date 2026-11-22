import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'
import { InboxList, type InboxRowView } from './InboxList.tsx'

const maya = { kind: 'person' as const, person: { id: 'u-maya', name: 'Maya Chen' } }
const NOW = Date.now()
const rows: InboxRowView[] = [
  {
    id: 'i1',
    section: { key: 'team:payments', name: 'Payments', scope: { team: 'payments' } },
    title: 'Retry payments that fail on a timeout',
    href: '/payments/idea/12',
    where: 'Payments',
    status: { status: 'requesting review' },
    reason: 'Review requested',
    asked: true,
    kind: 'comment',
    actor: maya,
    update: 'commented: “Which timeout?”',
    newCount: 3,
    at: NOW - 5 * 60_000,
  },
  {
    id: 'i2',
    section: { key: 'team:mobile', name: 'Mobile', scope: { team: 'mobile' } },
    title: 'Offline sync for field technicians',
    href: '/mobile/idea/9',
    where: 'Mobile',
    status: { status: 'closed', reason: 'accepted' },
    reason: 'Author',
    kind: 'review',
    actor: { kind: 'bot-for-person', bot: 'planbot', person: maya.person },
    update: 'approved it',
    newCount: 0,
    at: NOW - 26 * 3600_000,
  },
]

const meta = {
  title: 'Notifications/InboxList',
  component: InboxList,
  args: { rows, showing: 'inbox', onRead: fn(), onDone: fn(), onBack: fn(), empty: 'Nothing new.' },
} satisfies Meta<typeof InboxList>

export default meta
type Story = StoryObj<typeof meta>

// One row per idea: the unread one stands out; the toolbar acts on everything
export const Inbox: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await expect(page.getByText('· 3 new')).toBeVisible()
    await userEvent.click(page.getByRole('button', { name: 'Mark all as read' }))
    await expect(args.onRead).toHaveBeenCalledWith(null)
  },
}

// Ticking rows acts on those
export const Selecting: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await userEvent.click(page.getByRole('checkbox', { name: 'Select Offline sync for field technicians' }))
    await userEvent.click(page.getByRole('button', { name: 'Mark 1 as done' }))
    await expect(args.onDone).toHaveBeenCalledWith(['i2'])
    // acting clears the selection
    await expect(page.getByRole('button', { name: 'Mark all as done' })).toBeVisible()
  },
}

// The ideas marked done can go back to the inbox
export const Done: Story = {
  args: { showing: 'done' },
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await userEvent.click(page.getByRole('checkbox', { name: 'Select all' }))
    await userEvent.click(page.getByRole('button', { name: 'Move 2 back to the inbox' }))
    await expect(args.onBack).toHaveBeenCalledWith(['i1', 'i2'])
  },
}

export const Empty: Story = { args: { rows: [] } }

// Grouped by day, each row's update shown by its icon, and a review asked of you standing out
export const GroupedAndEmphasised: Story = {
  play: async ({ canvasElement }) => {
    const list = within(canvasElement)
    // the second is a day or more ago: Yesterday or This week, by when the test runs
    const days = list.getAllByRole('region')
    await expect(days[0]).toHaveAccessibleName('Today')
    await expect(days.length).toBeGreaterThan(1)
    await expect(list.getByText('Review requested')).toHaveClass('is-asked')
  },
}

// Unread has a dot and a bold title, said to screen readers too; read is plain. Each update's kind is drawn
export const UnreadAndRead: Story = {
  play: async ({ canvasElement }) => {
    const [unread, read] = [...canvasElement.querySelectorAll('.inbox-row')]
    await expect(unread!.querySelector('.inbox-dot')).toHaveTextContent('Unread:')
    await expect(read!.querySelector('.inbox-dot')).toBeNull()
    await expect(unread!.querySelector('.inbox-icon svg')).toBeTruthy()
  },
}

// In a list as narrow as a phone's, the title keeps the width: when goes top right, and where it
// stands and why share the line under it
export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: '22rem' }}>
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const row = canvasElement.querySelector('.inbox-row')!
    const title = row.querySelector('.inbox-title a')!.getBoundingClientRect()
    const time = row.querySelector('.inbox-time')!.getBoundingClientRect()
    const meta = row.querySelector('.inbox-meta')!.getBoundingClientRect()
    await expect(title.width).toBeGreaterThan(150)
    await expect(time.top).toBeLessThan(meta.top)
    await expect(meta.top).toBeGreaterThan(title.bottom)
  },
}

// More rows, across two teams and someone's own ideas, for grouping by team
const more: InboxRowView[] = [
  rows[0]!,
  {
    ...rows[1]!,
    id: 'i3',
    title: 'Notes on the 2027 roadmap',
    href: '/@alex/idea/3',
    where: 'Alex Romero’s ideas',
    section: { key: 'owner:u-alex', name: 'Alex Romero’s ideas', scope: { owner: 'u-alex' } },
    newCount: 1,
    at: NOW - 2 * 3600_000,
  },
  { ...rows[0]!, id: 'i4', title: 'Card payments in three steps', newCount: 0, at: NOW - 3 * 3600_000 },
  rows[1]!,
]

// Grouped by team: a section for each, in the order of its newest row, its name once in its heading, and its
// buttons marking all of it (rows not loaded too: the scope, not the IDs)
export const ByTeam: Story = {
  args: { rows: more, groupBy: 'team', onGroupBy: fn() },
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    const sections = page.getAllByRole('region').map((s) => s.getAttribute('aria-label'))
    await expect(sections).toEqual(['Payments', 'Alex Romero’s ideas', 'Mobile'])
    const payments = within(page.getByRole('region', { name: 'Payments' }))
    await expect(payments.getAllByRole('listitem')).toHaveLength(2)
    await expect(payments.getByText('1 unread')).toBeVisible()
    // the section's name isn't repeated on its rows
    await expect(payments.getAllByText('Payments')).toHaveLength(1)
    await userEvent.click(page.getByRole('button', { name: 'Mark as done in Payments' }))
    await expect(args.onDone).toHaveBeenCalledWith(null, { team: 'payments' })
    await userEvent.click(page.getByRole('button', { name: 'Mark as read in Alex Romero’s ideas' }))
    await expect(args.onRead).toHaveBeenCalledWith(null, { owner: 'u-alex' })
    // nothing new in Mobile: nothing to read, still something to clear
    await expect(page.queryByRole('button', { name: 'Mark as read in Mobile' })).toBeNull()
    await expect(page.getByRole('button', { name: 'Mark as done in Mobile' })).toBeVisible()
    // the switch
    await userEvent.click(page.getByRole('radio', { name: 'Date' }))
    await expect(args.onGroupBy).toHaveBeenCalledWith('date')
  },
}

// The Done list grouped by team: each section goes back to the inbox as a whole
export const ByTeamDone: Story = {
  args: { rows: more, groupBy: 'team', showing: 'done', onGroupBy: fn() },
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await userEvent.click(page.getByRole('button', { name: 'Move back to the inbox from Mobile' }))
    await expect(args.onBack).toHaveBeenCalledWith(null, { team: 'mobile' })
  },
}

// Notices about teams and groups, among the ideas: a group icon, no status, why it's yours, and a link to where
// it's seen, or none once the team is gone
const notices: InboxRowView[] = [
  {
    id: 'nt1',
    section: { key: 'team:mobile', name: 'Mobile', scope: { team: 'mobile' } },
    title: 'Design reviewers joined Mobile, as members',
    href: '/groups/design-reviewers',
    where: 'Mobile',
    reason: 'Group admin',
    kind: 'notice',
    actor: { kind: 'person', person: { id: 'u-jordan', name: 'Jordan Lee' } },
    update: 'added your group to Mobile',
    newCount: 1,
    at: NOW - 60_000,
  },
  rows[0]!,
  {
    id: 'nt2',
    section: { key: 'group:field-ops', name: 'Field ops', scope: { group: 'field-ops' } },
    title: 'You’re no longer in Field ops',
    href: null,
    where: 'Field ops',
    reason: 'You',
    kind: 'notice',
    actor: { kind: 'person', person: { id: 'u-devon', name: 'Devon Brooks' } },
    update: 'took you out of the group',
    newCount: 0,
    at: NOW - 30 * 60_000,
  },
]

export const Notices: Story = {
  args: { rows: notices },
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    const rowOf = (title: string) => page.getByRole('checkbox', { name: `Select ${title}` }).closest('li')!
    const added = within(rowOf('Design reviewers joined Mobile, as members'))
    await expect(added.getByRole('link', { name: 'Design reviewers joined Mobile, as members' })).toHaveAttribute(
      'href',
      '/groups/design-reviewers',
    )
    await expect(added.getByText('Group admin')).toBeVisible()
    await expect(added.getByText('Unread:')).toBeInTheDocument()
    // no status, and no link once what it's about is gone
    const gone = within(rowOf('You’re no longer in Field ops'))
    await expect(gone.queryByRole('link')).toBeNull()
    await expect(canvasElement.querySelectorAll('.status-pill')).toHaveLength(1)
    // why it's yours starts its line, where an idea's status would be
    const reason = added.getByText('Group admin').getBoundingClientRect()
    const title = added.getByRole('link').getBoundingClientRect()
    await expect(Math.abs(reason.left - title.left) < 24 || reason.left > title.right).toBe(true)
    // ticked with an idea, they're marked together
    await userEvent.click(page.getByRole('checkbox', { name: 'Select Design reviewers joined Mobile, as members' }))
    await userEvent.click(page.getByRole('checkbox', { name: 'Select Retry payments that fail on a timeout' }))
    await userEvent.click(page.getByRole('button', { name: 'Mark 2 as done' }))
    await expect(args.onDone).toHaveBeenCalledWith(['nt1', 'i1'])
  },
}

// Grouped by team: a notice about a team in its section, one about a group alone in the group's
export const NoticesByTeam: Story = {
  args: { rows: notices, groupBy: 'team', onGroupBy: fn() },
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await expect(page.getAllByRole('region').map((s) => s.getAttribute('aria-label'))).toEqual([
      'Mobile',
      'Payments',
      'Field ops',
    ])
    await userEvent.click(page.getByRole('button', { name: 'Mark as done in Field ops' }))
    await expect(args.onDone).toHaveBeenCalledWith(null, { group: 'field-ops' })
  },
}
