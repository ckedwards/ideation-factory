import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, waitFor, within } from 'storybook/test'
import { Button } from '../controls/Button.tsx'
import { Combobox, type ComboboxOption } from '../controls/Combobox.tsx'
import { FilterMenu } from './FilterMenu.tsx'

const people: ComboboxOption[] = [
  { id: 'u-maya', label: 'Maya Patel', sub: '@maya' },
  { id: 'u-devon', label: 'Devon Brooks', sub: '@devon' },
]

/** An author filter: a shortcut first, then a picker. */
function Author({ onPick }: { onPick: (id: string | null) => void }) {
  const [value, setValue] = useState<ComboboxOption | null>(null)
  const [query, setQuery] = useState('')
  const pick = (option: ComboboxOption | null) => {
    setValue(option)
    onPick(option?.id ?? null)
  }
  return (
    <FilterMenu label="Author" value={value?.label ?? null} onClear={() => pick(null)}>
      {(close) => (
        <>
          <Button
            size="sm"
            variant="link"
            onClick={() => {
              pick({ id: 'u-riley', label: 'You', sub: '@riley' })
              close()
            }}
          >
            Me
          </Button>
          <Combobox
            label="Author"
            value={value}
            onChange={(option) => {
              pick(option)
              close()
            }}
            query={query}
            onQueryChange={setQuery}
            options={people.filter((p) => p.label.toLowerCase().includes(query.toLowerCase()))}
          />
        </>
      )}
    </FilterMenu>
  )
}

const meta = {
  title: 'Overlays/FilterMenu',
  component: Author,
  args: { onPick: fn() },
} satisfies Meta<typeof Author>

export default meta
type Story = StoryObj<typeof meta>

// Unset, it says what it filters; set, to what; and Clear takes it off
export const Choosing: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(page.getByRole('button', { name: 'Author' }))
    await userEvent.type(body.getByRole('combobox', { name: 'Author' }), 'May')
    await userEvent.click(await body.findByRole('option', { name: /Maya Patel/ }))
    await waitFor(() => expect(args.onPick).toHaveBeenCalledWith('u-maya'))
    const trigger = page.getByRole('button', { name: 'Author: Maya Patel' })
    await expect(trigger).toHaveClass(/is-set/)
    await userEvent.click(trigger)
    await userEvent.click(await body.findByRole('button', { name: 'Clear author' }))
    await expect(args.onPick).toHaveBeenLastCalledWith(null)
    await expect(page.getByRole('button', { name: 'Author' })).not.toHaveClass(/is-set/)
  },
}

// A shortcut chooses in one click
export const Shortcut: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(canvasElement)
    await userEvent.click(page.getByRole('button', { name: 'Author' }))
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole('button', { name: 'Me' }))
    await expect(args.onPick).toHaveBeenCalledWith('u-riley')
    await expect(page.getByRole('button', { name: 'Author: You' })).toBeVisible()
  },
}
