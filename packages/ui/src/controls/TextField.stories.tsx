import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { TextField, type TextFieldProps } from './TextField.tsx'

function Field(props: Omit<TextFieldProps, 'value' | 'onChange'> & { initial?: string }) {
  const [value, setValue] = useState(props.initial ?? '')
  return <TextField {...props} value={value} onChange={setValue} />
}

const meta = {
  title: 'Controls/TextField',
  component: Field,
  args: { label: 'Name', initial: 'Riley Park' },
} satisfies Meta<typeof Field>

export default meta
type Story = StoryObj<typeof meta>

export const Plain: Story = {
  play: async ({ canvasElement, userEvent }) => {
    const input = within(canvasElement).getByRole('textbox', { name: 'Name' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Riley P.')
    await expect(input).toHaveValue('Riley P.')
  },
}

// A handle: @ before it, and what a handle can be under it
export const WithPrefixAndHint: Story = {
  args: { label: 'Handle', initial: 'riley', prefix: '@', hint: '2 to 39 lowercase letters, digits and dashes.' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('textbox', { name: 'Handle' })).toHaveAccessibleDescription(
      '2 to 39 lowercase letters, digits and dashes.',
    )
  },
}

// What's wrong, announced, the field marked invalid
export const Invalid: Story = {
  args: { label: 'Handle', initial: 'maya', prefix: '@', error: '@maya is taken: pick another handle.' },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(page.getByRole('textbox', { name: 'Handle' })).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByRole('alert')).toHaveTextContent('@maya is taken')
  },
}
