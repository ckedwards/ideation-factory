import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, within } from 'storybook/test'
import { Button } from '../controls/Button.tsx'
import { type Present, PresenceStack } from './PresenceStack.tsx'
import { devon, maya, priya, riley, sam } from '../stories/fixtures.ts'

const few: Present[] = [
  { key: 'w-priya', person: priya, color: 1 },
  { key: 'w-maya', person: maya, color: 2 },
  // the same person as you, in another window: an entity of its own
  { key: 'w-riley-2', person: riley, color: 3, note: 'another window' },
]
const many: Present[] = [
  ...few,
  { key: 'w-devon', person: devon, color: 4 },
  { key: 'w-sam', person: sam, color: 5 },
  { key: 'w-lena', person: { id: 'u-lena', name: 'Lena Kowalski' }, color: 6 },
  { key: 'w-noor', person: { id: 'u-noor', name: 'Noor Haddad' }, color: 7 },
  { key: 'w-alex', person: { id: 'u-alex', name: 'Alex Romero' }, color: 8 },
  { key: 'w-tomas', person: { id: 'u-tomas', name: 'Tomás Silva' }, color: 1 },
]

const meta = {
  title: 'People/PresenceStack',
  component: PresenceStack,
  args: { present: few, onGo: fn() },
} satisfies Meta<typeof PresenceStack>

export default meta
type Story = StoryObj<typeof meta>

// Three others in the draft: each face ringed in their caret's color, and choosing one goes to them
export const Few: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByRole('button')).toHaveLength(3)
    await userEvent.click(canvas.getByRole('button', { name: 'Riley Park (another window): go to where they are' }))
    await expect(args.onGo).toHaveBeenCalledWith('w-riley-2')
  },
}

// More than five: five faces, then "+4", which lists everyone in the order they arrived
export const Many: Story = {
  args: { present: many },
  play: async ({ args, canvasElement, userEvent }) => {
    const canvas = within(canvasElement)
    const page = within(canvasElement.ownerDocument.body)
    await expect(canvas.getAllByRole('button', { name: /go to where they are/ })).toHaveLength(5)
    await userEvent.click(canvas.getByRole('button', { name: '+4 more: everyone in the draft' }))
    await expect(await page.findByText('9 others in the draft, in the order they arrived')).toBeVisible()
    // everyone, the five shown first
    const list = within(page.getByRole('dialog', { name: 'Everyone in the draft' }))
    await expect(list.getAllByRole('button').map((r) => r.textContent?.replace(/^[A-Z]{1,2}/, ''))).toEqual([
      'Priya Raman',
      'Maya Ortiz',
      'Riley Parkanother window',
      'Devon Fox',
      'Sam Achebe',
      'Lena Kowalski',
      'Noor Haddad',
      'Alex Romero',
      'Tomás Silva',
    ])
    await userEvent.click(list.getByRole('button', { name: 'Noor Haddad' }))
    await expect(args.onGo).toHaveBeenCalledWith('w-noor')
  },
}

// People coming and going are announced to screen readers
export const Arriving: Story = {
  render: (args) => {
    const [present, setPresent] = useState(few.slice(0, 2))
    return (
      <div style={{ display: 'grid', gap: '1rem', justifyItems: 'start' }}>
        <PresenceStack {...args} present={present} />
        <Button onClick={() => setPresent([...few.slice(1), { key: 'w-sam', person: sam, color: 1 }])}>Change</Button>
      </div>
    )
  },
  play: async ({ canvasElement, userEvent }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('status')).toHaveTextContent('')
    await userEvent.click(canvas.getByRole('button', { name: 'Change' }))
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'Riley Park (another window) joined the draft. Sam Achebe joined the draft. Priya Raman left the draft.',
    )
  },
}

export const Alone: Story = { args: { present: [] } }
