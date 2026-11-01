import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { ThemeToggle, type Theme } from './ThemeToggle.tsx'

// The control only: it doesn't change Storybook's theme, which the toolbar sets
function Stateful({ value }: { value: Theme }) {
  const [theme, setTheme] = useState(value)
  return <ThemeToggle value={theme} onChange={setTheme} />
}

const meta = {
  title: 'Controls/ThemeToggle',
  component: Stateful,
  args: { value: 'auto' },
} satisfies Meta<typeof Stateful>

export default meta
type Story = StoryObj<typeof meta>

export const Auto: Story = {}

export const HighContrast: Story = { args: { value: 'contrast' } }
