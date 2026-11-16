import { useMemo, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, screen, within } from 'storybook/test'
import { Combobox, type ComboboxOption } from './Combobox.tsx'
import { Dialog } from '../overlays/Dialog.tsx'
import { findMatch } from '../labels/Highlight.tsx'
import { crowd, everyone, longName, riley } from '../stories/fixtures.ts'

const people: ComboboxOption[] = [...everyone, longName, ...crowd].map((person) => ({
  id: person.id,
  label: person.name,
  sub: person.handle ? `@${person.handle}${person.inactive ? ' · inactive' : ''}` : 'Mobile',
  person,
}))

// Stands in for the server: matches on name or handle, at most eight
function search(query: string) {
  return people.filter((p) => findMatch(query, p.label) || findMatch(query, p.sub ?? '')).slice(0, 8)
}

function Stateful({
  initial = null,
  pinned,
  loading = false,
}: {
  initial?: ComboboxOption | null
  pinned?: ComboboxOption[]
  loading?: boolean
}) {
  const [value, setValue] = useState<ComboboxOption | null>(initial)
  const [query, setQuery] = useState('')
  const options = useMemo(() => (loading ? [] : search(query)), [query, loading])
  return (
    <Combobox
      label="Author"
      placeholder="Any author"
      value={value}
      onChange={setValue}
      query={query}
      onQueryChange={setQuery}
      options={options}
      pinned={pinned ?? []}
      emptyHint="Try a name or @handle."
      loading={loading}
    />
  )
}

const meta = {
  title: 'Controls/Combobox',
  component: Stateful,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div style={{ minHeight: '18rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Stateful>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}

export const Chosen: Story = { args: { initial: people.find((p) => p.id === riley.id) ?? null } }

export const PinnedBeforeTyping: Story = {
  args: { pinned: [{ id: riley.id, label: 'You', sub: '@riley', person: riley }] },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('combobox'))
    await expect(await screen.findByRole('option', { name: /You/ })).toBeVisible()
  },
}

export const Typing: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByRole('combobox'), 'ma')
    await expect((await screen.findAllByRole('option')).length).toBeGreaterThan(0)
  },
}

export const NoMatches: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByRole('combobox'), 'zzz')
    await expect(await screen.findByRole('status')).toHaveTextContent('No matches for “zzz”.')
  },
}

export const Searching: Story = {
  args: { loading: true },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByRole('combobox'), 'ma')
    await expect(await screen.findByRole('status')).toHaveTextContent('Searching…')
  },
}

// Down arrow and Enter choose without the mouse
export const Keyboard: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByRole('combobox'), 'maya')
    await userEvent.keyboard('{Enter}')
    await expect(canvas.getByRole('button', { name: 'Clear Author' })).toBeVisible()
    await expect(canvas.getByText('Maya Ortiz')).toBeVisible()
  },
}

// In a modal dialog, the list opens inside it, above the dialog, and can be picked from: a list on
// the page behind the dialog's top layer would be hidden and out of reach
export const InADialog: Story = {
  decorators: [
    (Story) => (
      <Dialog open title="Add someone" onClose={() => undefined}>
        <Story />
      </Dialog>
    ),
  ],
  play: async ({ userEvent }) => {
    const dialog = await screen.findByRole('dialog', { name: 'Add someone' })
    await userEvent.type(within(dialog).getByRole('combobox'), 'ma')
    const option = await screen.findByRole('option', { name: /Maya/ })
    await expect(dialog.contains(option)).toBe(true)
    await userEvent.click(option)
    await expect(within(dialog).getByText('Maya Ortiz')).toBeVisible()
  },
}
