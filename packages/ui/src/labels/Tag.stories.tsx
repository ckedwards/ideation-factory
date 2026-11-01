import type { Meta, StoryObj } from '@storybook/react-vite'
import { Tag } from './Tag.tsx'

const meta = {
  title: 'Labels/Tag',
  component: Tag,
  args: { children: 'automated', tone: 'neutral' },
} satisfies Meta<typeof Tag>

export default meta
type Story = StoryObj<typeof meta>

export const Neutral: Story = {}

export const Tones: Story = {
  render: () => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
      <Tag>neutral</Tag>
      <Tag tone="bot">automated</Tag>
      <Tag tone="ok">accepted</Tag>
      <Tag tone="lost">outdated</Tag>
      <Tag tone="warn">needs fixing</Tag>
      <Tag tone="admin">🛡 Site admin</Tag>
      <Tag tone="faint">faint</Tag>
      <Tag tone="dashed">inactive</Tag>
    </div>
  ),
}
