import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'
import { Icon, ICON_NAMES } from './Icon.tsx'

const meta = {
  title: 'Labels/Icon',
  component: Icon,
  args: { name: 'comment' },
} satisfies Meta<typeof Icon>

export default meta
type Story = StoryObj<typeof meta>

// Every icon, at the text's size and in its colour
export const All: Story = {
  render: () => (
    <ul style={{ display: 'grid', gap: '0.5rem', listStyle: 'none', padding: 0, fontSize: '1.25rem' }}>
      {ICON_NAMES.map((name) => (
        <li key={name} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <Icon name={name} />
          <span style={{ fontSize: '0.875rem' }}>{name}</span>
        </li>
      ))}
    </ul>
  ),
  play: async ({ canvasElement }) => {
    const icons = canvasElement.querySelectorAll('svg.icon')
    await expect(icons).toHaveLength(ICON_NAMES.length)
    // beside words, they're not read out
    await expect(icons[0]).toHaveAttribute('aria-hidden', 'true')
  },
}

// On its own, it needs a label
export const Labelled: Story = {
  args: { name: 'requested', label: 'Asked for your review' },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('svg')).toHaveAccessibleName('Asked for your review')
  },
}
