import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { markdownTree } from '@ideaf/core'
import { IdeaPageLayout } from './IdeaPageLayout.tsx'
import { Stack } from './Stack.tsx'
import { Tabs } from './Tabs.tsx'
import { CommentCard, type CommentInfo } from '../comments/CommentCard.tsx'
import { MarkdownView } from '../document/MarkdownView.tsx'
import { Toc } from '../document/Toc.tsx'
import { StatusControl, type OpenStatus } from '../ideas/StatusControl.tsx'
import { TeamChip } from '../teams/TeamChip.tsx'
import sample from '../stories/sample.md?raw'
import { actors, maya, NOW } from '../stories/fixtures.ts'

const tree = markdownTree(sample)
const at = (quote: string) => ({ start: sample.indexOf(quote), end: sample.indexOf(quote) + quote.length })
const body = (text: string) => <MarkdownView tree={markdownTree(text)} variant="compact" />

const comments: CommentInfo[] = [
  {
    id: 'c1',
    author: { kind: 'person', person: maya },
    at: NOW - 3 * 3_600_000,
    body: body('What happens to a change that was made offline twice?'),
    target: { kind: 'text', quote: 'oldest first' },
    resolved: false,
    replies: [],
  },
  {
    id: 'c2',
    author: actors.bot,
    at: NOW - 3_600_000,
    body: body('This names `POST /sync`, but the overview calls it `/v2/sync`.'),
    target: { kind: 'section', title: 'Sync endpoint' },
    resolved: false,
    replies: [],
  },
]

function Nav() {
  const [status, setStatus] = useState<OpenStatus>('requesting review')
  return (
    <div style={{ padding: '1rem' }}>
      <Stack gap={4}>
        <Stack gap={2}>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.15rem' }}>
            Offline-first sync for the field app
          </h1>
          <div>
            <TeamChip team={{ name: 'Mobile' }} href="#teams/mobile" />
          </div>
          <div>
            <StatusControl value={status} onChange={setStatus} />
          </div>
        </Stack>
        <Toc
          entries={[
            { id: 'proposal', title: 'Proposal', level: 2, openComments: 1 },
            { id: 'sync-endpoint', title: 'Sync endpoint', level: 3, openComments: 1 },
            { id: 'conflicts', title: 'Conflicts', level: 3, changed: true },
            { id: 'rollout', title: 'Rollout', level: 2 },
          ]}
          active="proposal"
          onJump={() => {}}
        />
      </Stack>
    </div>
  )
}

function Panel() {
  const [pane, setPane] = useState<'comments' | 'versions' | 'details'>('comments')
  const [active, setActive] = useState('c1')
  return (
    <Tabs
      label="Panel"
      tabs={[
        { id: 'comments', label: 'Comments', count: comments.length },
        { id: 'versions', label: 'Versions' },
        { id: 'details', label: 'Details' },
      ]}
      value={pane}
      onChange={setPane}
    >
      {pane === 'comments' ? (
        <Stack gap={2}>
          {comments.map((comment) => (
            <CommentCard
              key={comment.id}
              comment={comment}
              active={comment.id === active}
              onSelect={() => setActive(comment.id)}
              onReply={() => {}}
              onResolve={() => {}}
            />
          ))}
        </Stack>
      ) : (
        <p style={{ margin: 0 }}>The {pane} panel.</p>
      )}
    </Tabs>
  )
}

function Document() {
  return (
    <MarkdownView
      tree={tree}
      marks={[{ id: 'c1', ...at('oldest first'), active: true }]}
      sectionMarks={[{ id: 'c2', heading: sample.indexOf('### Sync endpoint') }]}
      changed={[{ start: sample.indexOf('### Conflicts'), end: sample.indexOf('## Rollout') }]}
    />
  )
}

const meta = {
  title: 'Layout/IdeaPageLayout',
  component: IdeaPageLayout,
  parameters: { layout: 'fullscreen' },
  args: { nav: <Nav />, document: <Document />, panel: <Panel /> },
} satisfies Meta<typeof IdeaPageLayout>

export default meta
type Story = StoryObj<typeof meta>

// The idea page, built only from components
export const IdeaPage: Story = {}

// The comments feed takes the center, and the panel loses its Comments tab
export const WithoutPanel: Story = { args: { panel: undefined } }
