import { useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { markdownTree } from '@ideaf/core'
import { IdeaPageLayout } from './IdeaPageLayout.tsx'
import { Stack } from './Stack.tsx'
import { Tabs } from './Tabs.tsx'
import { CommentCard, type CommentInfo } from '../comments/CommentCard.tsx'
import { CommentGutter } from '../comments/CommentGutter.tsx'
import { SelectionMenu } from '../comments/SelectionMenu.tsx'
import type { ImageMedia } from '../document/MarkdownImage.tsx'
import { MarkdownView } from '../document/MarkdownView.tsx'
import { renderMermaid } from '../document/MermaidDiagram.tsx'
import { Redline } from '../document/Redline.tsx'
import { Toc } from '../document/Toc.tsx'
import { IdeaHeading } from '../ideas/IdeaHeading.tsx'
import { StatusControl, type OpenStatus } from '../ideas/StatusControl.tsx'
import { ActorLabel } from '../people/ActorLabel.tsx'
import { RelativeTime } from '../time/RelativeTime.tsx'
import sample from '../stories/sample.md?raw'
import { actors, maya, NOW, syncFlow } from '../stories/fixtures.ts'

const tree = markdownTree(sample)
const at = (quote: string) => ({ start: sample.indexOf(quote), end: sample.indexOf(quote) + quote.length })
const body = (text: string) => <MarkdownView tree={markdownTree(text)} variant="compact" />
const image = (): ImageMedia => ({ status: 'uploaded', src: syncFlow.v2, name: 'sync-flow.svg', bytes: 1856 })

// the version before, for compare mode
const earlier = sample
  .replace('lose signal in basements and plant rooms', 'lose signal in basements')
  .replace(', oldest first.', '.')

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
  {
    id: 'c3',
    author: actors.botForPerson,
    at: NOW - 1_800_000,
    body: body('Should the flag be per team or per technician?'),
    target: { kind: 'text', quote: 'Ship behind a flag' },
    resolved: false,
    replies: [],
  },
]

function IdeaPage({ compare = false, withPanel = true }: { compare?: boolean; withPanel?: boolean }) {
  const document = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<OpenStatus>('requesting review')
  const [pane, setPane] = useState<'comments' | 'versions' | 'details'>('comments')
  const [active, setActive] = useState<string | null>('c1')

  const nav = (
    <div style={{ padding: '1rem' }}>
      <Stack gap={5}>
        <IdeaHeading
          title="Offline-first sync for the field app"
          team={{ name: 'Mobile', href: '#teams/mobile' }}
          status={<StatusControl value={status} onChange={setStatus} />}
          meta={
            <>
              v4 · <ActorLabel actor={actors.person} short /> · <RelativeTime at={NOW - 2 * 3_600_000} />
            </>
          }
          onTitleClick={() => setPane('details')}
        />
        <Toc
          entries={[
            { id: 'proposal', title: 'Proposal', level: 2, openComments: 1 },
            { id: 'sync-endpoint', title: 'Sync endpoint', level: 3, openComments: 1 },
            { id: 'conflicts', title: 'Conflicts', level: 3, changed: true },
            { id: 'rollout', title: 'Rollout', level: 2, openComments: 1 },
          ]}
          active="proposal"
          onJump={() => {}}
        />
      </Stack>
    </div>
  )

  const view = compare ? (
    <Redline
      base={{ source: earlier, tree: markdownTree(earlier) }}
      current={{ source: sample, tree }}
      image={image}
      renderCode={renderMermaid}
    />
  ) : (
    <>
      <MarkdownView
        tree={tree}
        marks={[
          { id: 'c1', ...at('oldest first'), active: active === 'c1' },
          { id: 'c3', ...at('Ship behind a flag'), active: active === 'c3' },
        ]}
        sectionMarks={[{ id: 'c2', heading: sample.indexOf('### Sync endpoint'), active: active === 'c2' }]}
        changed={[{ start: sample.indexOf('### Conflicts'), end: sample.indexOf('## Rollout') }]}
        image={image}
        renderCode={renderMermaid}
        onMarkClick={(id) => {
          setPane('comments')
          setActive(id)
        }}
      />
      <SelectionMenu
        documentRef={document}
        source={sample}
        onComment={() => {}}
        onSuggest={() => {}}
        onSectionComment={() => {}}
      />
    </>
  )

  const panel = (
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
      {pane === 'comments' && !compare ? (
        <CommentGutter
          documentRef={document}
          active={active}
          notes={comments.map((comment) => ({
            id: comment.id,
            content: (
              <CommentCard
                comment={comment}
                active={comment.id === active}
                onSelect={() => setActive(comment.id)}
                onReply={() => {}}
                onResolve={() => {}}
              />
            ),
          }))}
        />
      ) : pane === 'comments' ? (
        <Stack gap={2}>
          {comments.map((comment) => (
            <CommentCard
              key={comment.id}
              comment={comment}
              active={comment.id === active}
              onSelect={() => setActive(comment.id)}
            />
          ))}
        </Stack>
      ) : (
        <p style={{ margin: 0 }}>The {pane} panel.</p>
      )}
    </Tabs>
  )

  return <IdeaPageLayout nav={nav} document={<div ref={document}>{view}</div>} panel={withPanel ? panel : undefined} />
}

const meta = {
  title: 'Layout/IdeaPageLayout',
  component: IdeaPage,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof IdeaPage>

export default meta
type Story = StoryObj<typeof meta>

// The idea page, built only from components: the idea's heading, the
// document with its diagram and image, comments level with their text, and
// the menu for commenting on a selection
export const IdeaPage_: Story = { name: 'Idea page' }

// Compare mode: the redline, and the comments as a list
export const Compare: Story = { args: { compare: true } }

// Without the panel, the document takes the room
export const WithoutPanel: Story = { args: { withPanel: false } }
