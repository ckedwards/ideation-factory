import type { Meta, StoryObj } from '@storybook/react-vite'
import { actors, NOW } from '@ideaf/ui/fixtures'
import { expect, fn, within } from 'storybook/test'
import { VersionList } from './VersionList.tsx'

const hours = (n: number) => NOW - n * 3_600_000
const maya = { id: 'u-maya', name: 'Maya Chen' }
const priya = { id: 'u-priya', name: 'Priya Natarajan' }
const riley = actors.person.kind === 'person' ? actors.person.person : { id: 'u-riley', name: 'Riley' }

const meta = {
  title: 'Ideas/VersionList',
  component: VersionList,
  args: {
    versions: [
      { number: 4, by: actors.person, at: hours(1), how: 'upload', steps: 0 },
      { number: 3, by: actors.botForPerson, at: hours(5), how: 'commands', steps: 3 },
      { number: 2, by: actors.bot, at: hours(30), how: 'commands', steps: 1 },
      { number: 1, by: actors.person, at: hours(72), how: 'created', steps: 0 },
    ],
    viewing: 4,
    latest: 4,
    base: null,
    viewHref: (n) => `#v${n}`,
    compareHref: (n) => `#compare-${n}`,
  },
} satisfies Meta<typeof VersionList>

export default meta
type Story = StoryObj<typeof meta>

// A draft committed together: the faces of who typed in it, beside who committed it
export const TypedTogether: Story = {
  args: {
    versions: [
      { number: 2, by: actors.person, at: hours(0.5), how: 'commands', steps: 4, authors: [maya, priya, riley] },
      { number: 1, by: actors.person, at: hours(72), how: 'created', steps: 0, authors: [riley] },
    ],
    viewing: 2,
    latest: 2,
  },
  play: async ({ canvasElement }) => {
    const list = within(canvasElement)
    await expect(list.getByRole('img', { name: 'Maya Chen' })).toBeVisible()
    await expect(list.getByRole('img', { name: 'Priya Natarajan' })).toBeVisible()
    // only who created it: no faces beside them
    await expect(list.getAllByText('Typed by')).toHaveLength(1)
  },
}

// Reading the latest: each earlier version can be compared with it
export const Latest: Story = {
  play: async ({ canvasElement }) => {
    const list = within(canvasElement)
    await expect(list.getByRole('link', { name: 'Version 4' })).toHaveAttribute('aria-current', 'page')
    await expect(list.getAllByRole('link', { name: 'Compare with v4' })).toHaveLength(3)
    await expect(list.getByText('Edited with 3 commands')).toBeVisible()
    await expect(list.getByText('Edited with 1 command')).toBeVisible()
  },
}

// Comparing v4 against v2: the range between them marked
export const Comparing: Story = { args: { base: 2 } }

// Reading an older version: the latest marked as such, nothing after it to compare
export const Older: Story = {
  args: { viewing: 2 },
  play: async ({ canvasElement }) => {
    const list = within(canvasElement)
    await expect(list.getByText('latest')).toBeVisible()
    await expect(list.getAllByRole('link', { name: 'Compare with v2' })).toHaveLength(1)
  },
}

// A draft, reading: what the next version will be, at the top, to open
export const WithADraft: Story = {
  args: { draft: { on: 4, changes: 3, by: ['Riley Park', 'Maya Chen'], onOpen: fn() } },
  play: async ({ args, canvasElement, userEvent }) => {
    const list = within(canvasElement)
    await expect(list.getByText('not committed')).toBeVisible()
    await expect(list.getByText('3 changes')).toBeVisible()
    await expect(list.getByText('by Riley Park, Maya Chen')).toBeVisible()
    await userEvent.click(list.getByRole('button', { name: 'Open the draft' }))
    await expect(args.draft!.onOpen).toHaveBeenCalled()
  },
}

// The draft open: compared with any version from here (its changes are a dialog, from the idea's bar)
export const EditingTheDraft: Story = {
  args: {
    draft: {
      on: 4,
      changes: 2,
      by: ['Riley Park'],
      open: true,
      comparedWith: null,
      onCompare: fn(),
    },
  },
  play: async ({ args, canvasElement, userEvent }) => {
    const list = within(canvasElement)
    await expect(list.getByText('editing')).toBeVisible()
    // its changes aren't listed here
    await expect(list.queryByText(/Field technicians lose signal/)).toBeNull()
    // no version's shown while the draft is
    await expect(list.queryByText('viewing')).toBeNull()
    await expect(list.getAllByRole('button', { name: 'Compare with the draft' })).toHaveLength(4)
    await userEvent.click(list.getAllByRole('button', { name: 'Compare with the draft' })[2]!)
    await expect(args.draft!.onCompare).toHaveBeenCalledWith(2)
    await userEvent.click(list.getByRole('button', { name: 'Compare with v4' }))
    await expect(args.draft!.onCompare).toHaveBeenCalledWith(4)
  },
}

// The draft compared with v2: the range marked, and the way back to editing
export const ComparingTheDraft: Story = {
  args: {
    draft: { on: 4, changes: 2, by: ['Riley Park'], open: true, comparedWith: 2, onCompare: fn() },
  },
  play: async ({ canvasElement }) => {
    const list = within(canvasElement)
    await expect(list.getByText('comparing')).toBeVisible()
    await expect(list.getByText('compared with the draft')).toBeVisible()
    await expect(list.getAllByRole('button', { name: 'Back to editing' })).toHaveLength(2)
  },
}

const minutes = (n: number) => NOW - n * 60_000
const earlier = {
  drafts: [
    {
      point: 7,
      at: minutes(12),
      reason: 'Before Priya Natarajan discarded it',
      who: ['Priya Natarajan', 'Riley Park', 'checkbot for Riley Park'],
      changes: 5,
      first: null,
      more: 0,
      undone: 0,
      on: null,
      kept: true,
      canDelete: true,
    },
    {
      point: 6,
      at: minutes(40),
      reason: null,
      who: ['Riley Park', 'checkbot for Riley Park'],
      changes: 4,
      first: 'Added “Bring the list of open jobs.”',
      more: 1,
      undone: 0,
      on: null,
      kept: true,
      canDelete: true,
    },
    {
      point: 5,
      at: minutes(95),
      reason: null,
      who: ['Priya Natarajan'],
      changes: 2,
      first: 'Edited “You hand over on Tuesday at nine.”',
      more: 0,
      undone: 0,
      on: null,
      kept: true,
      canDelete: false,
    },
    {
      point: 2,
      at: hours(30),
      reason: null,
      who: ['Riley Park'],
      changes: 1,
      first: 'Edited “Riley takes the early shift…”',
      more: 0,
      undone: 0,
      on: 3,
      kept: false,
      canDelete: true,
    },
  ],
  opened: null,
  onOpen: fn(),
  onRestore: fn(),
  onDelete: fn(),
}

// The draft's earlier drafts under it: named by when and who, or by what they were kept before; the
// rest behind Show more, one dropped to make room among them
export const EarlierDrafts: Story = {
  args: {
    draft: { on: 4, changes: 3, by: ['Riley Park'], open: true, comparedWith: null, onCompare: fn(), earlier },
  },
  play: async ({ args, canvasElement, userEvent }) => {
    const list = within(canvasElement)
    await expect(list.getByRole('heading', { name: 'Earlier drafts' })).toBeVisible()
    await expect(list.getByText('Added “Bring the list of open jobs.” and 1 more')).toBeVisible()
    // three show; the dropped one is behind Show more
    await expect(list.queryByText(/No longer kept/)).toBeNull()
    await userEvent.click(list.getByRole('button', { name: 'Show 1 more' }))
    await expect(list.getByText(/No longer kept/)).toBeVisible()
    await expect(list.getByText('on v3')).toBeVisible()
    // opening one shows it in the page
    await userEvent.click(list.getByRole('button', { name: 'Before Priya Natarajan discarded it' }))
    await expect(args.draft!.earlier!.onOpen).toHaveBeenCalledWith(7)
  },
}

// One opened: shown in the page, with Restore and, for whoever may, Delete
export const AnEarlierDraftOpened: Story = {
  args: {
    draft: {
      on: 4,
      changes: 3,
      by: ['Riley Park'],
      open: true,
      comparedWith: null,
      onCompare: fn(),
      earlier: { ...earlier, opened: 6 },
    },
  },
  play: async ({ args, canvasElement, userEvent }) => {
    const list = within(canvasElement)
    await expect(list.getByRole('button', { name: '40m ago' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(list.getByRole('button', { name: 'Restore this draft' }))
    await expect(args.draft!.earlier!.onRestore).toHaveBeenCalledWith(6)
    await userEvent.click(list.getByRole('button', { name: 'Delete' }))
    await expect(args.draft!.earlier!.onDelete).toHaveBeenCalledWith(6)
  },
}
