import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { Toc, type TocEntry } from './Toc.tsx'

const entries: TocEntry[] = [
  { id: 'proposal', title: 'Proposal', level: 2, openComments: 1 },
  { id: 'sync-endpoint', title: 'Sync endpoint', level: 3, changed: true },
  { id: 'conflicts', title: 'Conflicts', level: 3, changed: true, openComments: 3 },
  { id: 'merging-fields', title: 'Merging fields that changed on both sides', level: 4 },
  { id: 'rollout', title: 'Rollout', level: 2, openComments: 12 },
  { id: 'open-questions', title: 'Open questions', level: 2 },
]

const meta = {
  title: 'Document/Toc',
  component: Toc,
  args: { entries, active: 'conflicts', onJump: fn() },
  decorators: [
    (Story) => (
      <div style={{ width: '16rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Toc>

export default meta
type Story = StoryObj<typeof meta>

export const Contents: Story = {}

export const NothingActive: Story = { args: { active: null } }

export const NoHeadings: Story = { args: { entries: [] } }
