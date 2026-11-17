import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { SearchInput, type SearchInputProps } from './SearchInput.tsx'

function Stateful(props: Omit<SearchInputProps, 'onChange'>) {
  const [value, setValue] = useState(props.value)
  return <SearchInput {...props} value={value} onChange={setValue} />
}

const meta = {
  title: 'Controls/SearchInput',
  component: Stateful,
  args: { value: '', label: 'Search ideas', placeholder: 'Search ideas by title, team or author' },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '28rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Stateful>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}

export const Filled: Story = { args: { value: 'offline sync' } }
