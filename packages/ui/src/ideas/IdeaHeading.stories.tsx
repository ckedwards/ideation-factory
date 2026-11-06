import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { IdeaHeading } from './IdeaHeading.tsx'
import { StatusControl, type OpenStatus } from './StatusControl.tsx'
import { StatusPill } from './StatusPill.tsx'
import { ActorLabel } from '../people/ActorLabel.tsx'
import { RelativeTime } from '../time/RelativeTime.tsx'
import { actors, NOW } from '../stories/fixtures.ts'

function Control() {
  const [status, setStatus] = useState<OpenStatus>('requesting review')
  return <StatusControl value={status} onChange={setStatus} />
}

const meta = {
  title: 'Ideas/IdeaHeading',
  component: IdeaHeading,
  args: {
    title: 'Offline-first sync for the field app',
    team: { name: 'Mobile', href: '#teams/mobile' },
    status: <Control />,
    meta: (
      <>
        v4 · <ActorLabel actor={actors.person} short /> · <RelativeTime at={NOW - 2 * 3_600_000} />
      </>
    ),
    onTitleClick: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ width: '17rem', padding: '1rem', background: 'var(--surface-2)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof IdeaHeading>

export default meta
type Story = StoryObj<typeof meta>

// Someone who can change the status gets the control
export const Author: Story = {}

// Everyone else sees the status
export const Reader: Story = { args: { status: <StatusPill status="requesting review" /> } }

// Agent work is labeled, and long titles wrap
export const LongTitle: Story = {
  args: {
    title: 'Replace the nightly export with a streaming change feed that partners can subscribe to per region',
    team: { name: 'Platform', locked: true },
    meta: (
      <>
        v12 · <ActorLabel actor={actors.botForPerson} short />
      </>
    ),
  },
}

// A personal idea, in no team
export const Personal: Story = {
  args: { team: { name: 'Riley Park', personal: true }, status: <StatusPill status="draft" /> },
}
