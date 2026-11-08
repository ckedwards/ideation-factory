import type { Meta, StoryObj } from '@storybook/react-vite'
import { buildDraft, createIdea } from '@ideaf/core'
import { expect, fn, waitFor, within } from 'storybook/test'
import { IdeaEditor } from './IdeaEditor.tsx'

const source = `# Offline sync

Field technicians lose signal in basements and plant rooms.

## Proposal

Queue changes on the device and send them, **oldest first**, when the
connection comes back.

- Retry with backoff
- Keep a week of changes
`
// f1; s2 Offline sync, b3, s4 Proposal, b5, b6, b7; next ID 8
const idea = createIdea([{ path: 'plan.md', source }])
const unchanged = buildDraft(idea, [], []).files[0]!.units
const changed = buildDraft(
  idea,
  [],
  [
    {
      key: 'k1',
      change: {
        kind: 'edit',
        id: 'b3',
        source: 'Field technicians lose signal underground.',
        was: 'Field technicians lose signal in basements and plant rooms.',
      },
    },
    { key: 'k2', change: { kind: 'insert', at: { after: 'b5' }, markdown: 'Conflicts go to the newest change.' } },
  ],
).files[0]!.units

const meta = {
  title: 'Ideas/IdeaEditor',
  component: IdeaEditor,
  args: { units: unchanged, onEdit: fn(), onAdd: fn(), onDelete: fn() },
} satisfies Meta<typeof IdeaEditor>

export default meta
type Story = StoryObj<typeof meta>

// Each block with Edit, Add below and Delete; a heading deletes its section
export const Blocks: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(page.getAllByRole('button', { name: 'Edit' })).toHaveLength(unchanged.length)
    await expect(page.getAllByRole('button', { name: 'Delete section' })).toHaveLength(2)
  },
}

// Blocks the draft changed, and new ones, are marked
export const WithChanges: Story = {
  args: { units: changed },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(page.getByText('Changed')).toBeVisible()
    await expect(page.getByText('New')).toBeVisible()
  },
}

// Editing a block opens its Markdown; a heading, its title
export const EditingABlock: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await userEvent.click(page.getAllByRole('button', { name: 'Edit' })[1]!)
    const box = page.getByRole('textbox', { name: 'Markdown' })
    await expect(box).toHaveValue('Field technicians lose signal in basements and plant rooms.')
    await userEvent.clear(box)
    await userEvent.type(box, 'Signal drops underground.')
    await userEvent.click(page.getByRole('button', { name: 'Keep' }))
    await waitFor(() =>
      expect(args.onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'b3' }), 'Signal drops underground.'),
    )
    await userEvent.click(page.getAllByRole('button', { name: 'Edit' })[0]!)
    await expect(page.getByRole('textbox', { name: 'Heading' })).toHaveValue('Offline sync')
  },
}

// Adding text below a block
export const AddingBelow: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await userEvent.click(page.getAllByRole('button', { name: 'Add below' })[1]!)
    await userEvent.type(page.getByRole('textbox', { name: 'New text' }), 'More.')
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    await waitFor(() => expect(args.onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: 'b3' }), 'More.'))
  },
}
