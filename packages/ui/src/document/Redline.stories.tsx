import type { Meta, StoryObj } from '@storybook/react-vite'
import { markdownTree } from '@ideaf/core'
import { expect } from 'storybook/test'
import type { ImageMedia } from './MarkdownImage.tsx'
import { renderMermaid } from './MermaidDiagram.tsx'
import { Redline } from './Redline.tsx'
import sample from '../stories/sample.md?raw'
import { syncFlow } from '../stories/fixtures.ts'

const file = (source: string) => ({ source, tree: markdownTree(source) })

// The next version of the sample: words changed, a paragraph added, one taken
// out, the endpoint's code changed, and the rollout's checklist moved up
const next = sample
  .replace('lose signal in basements and plant rooms', 'lose signal in basements, lifts and plant rooms')
  .replace('oldest first.', 'oldest first, in batches of 50.')
  .replace('POST /sync', 'POST /v2/sync')
  .replace(
    '> We tried last-write-wins',
    'Conflicts are expected to be rare: most jobs have one technician.\n\n> We tried last-write-wins',
  )
  .replace('~~Last write wins~~ is what we do today, and it loses work.', '')
  .replace('- [x] Design review\n- [ ] Load test with 5,000 queued changes\n\n', '')
  .replace('## Rollout\n', '## Rollout\n\n- [x] Design review\n- [ ] Load test with 5,000 queued changes\n')

const base = file(sample)
const current = file(next)

const v1: ImageMedia = { status: 'uploaded', src: syncFlow.v1, name: 'sync-flow.svg', bytes: 1370 }
const v2: ImageMedia = { status: 'uploaded', src: syncFlow.v2, name: 'sync-flow.svg', bytes: 1856 }

const meta = {
  title: 'Document/Redline',
  component: Redline,
  args: { base, current, baseImage: () => v1, image: () => v1, renderCode: renderMermaid },
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div style={{ paddingLeft: '2rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Redline>

export default meta
type Story = StoryObj<typeof meta>

// Compare mode: what changed from one version to the next, in place
export const Changes: Story = {
  play: async ({ canvasElement }) => {
    const inserted = [...canvasElement.querySelectorAll('ins')].map((ins) => ins.textContent)
    await expect(inserted.join(' ')).toContain('lifts')
    await expect(canvasElement.querySelector('del')?.textContent).toBeTruthy()
    await expect(canvasElement.querySelector('.rl-moved-from')).not.toBeNull()
    await expect(canvasElement.querySelector('.rl-added')).not.toBeNull()
  },
}

// The same Markdown, a new picture: before and after
export const ImageChanged: Story = {
  args: { base, current: base, image: () => v2 },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Image changed')).toBeVisible()
    await expect(canvas.getAllByRole('img', { name: 'Sync flow' })).toHaveLength(2)
  },
}

// Nothing changed: the file as it is
export const NoChanges: Story = {
  args: { base, current: base },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('.rl')).toBeNull()
  },
}

// A file that's new since the version compared against: all of it added
export const NewFile: Story = { args: { base: file(''), current: base } }
