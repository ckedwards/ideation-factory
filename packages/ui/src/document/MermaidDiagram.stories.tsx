import type { Meta, StoryObj } from '@storybook/react-vite'
import { markdownTree } from '@ideaf/core'
import { expect, waitFor } from 'storybook/test'
import { MarkdownView } from './MarkdownView.tsx'
import { MermaidDiagram, renderMermaid } from './MermaidDiagram.tsx'
import sample from '../stories/sample.md?raw'

const flowchart = `flowchart LR
  App[Field app] -- queued changes --> Sync[POST /sync]
  Sync --> Server[(Server)]
  Server -- conflicts --> App`

const sequence = `sequenceDiagram
  participant T as Technician
  participant A as App
  participant S as Server
  T->>A: Mark job done (offline)
  A->>A: Queue the change
  A->>S: POST /sync when back online
  S-->>A: Applied, or a conflict to choose`

const meta = {
  title: 'Document/MermaidDiagram',
  component: MermaidDiagram,
  args: { source: flowchart },
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="prose">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MermaidDiagram>

export default meta
type Story = StoryObj<typeof meta>

// Drawn with Pele, in the theme's colors, with the source a click away
export const Flowchart: Story = {
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('.diagram-drawing svg')).not.toBeNull(), { timeout: 10_000 })
    await expect(canvasElement.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain('diagram')
  },
}

export const Sequence: Story = {
  args: { source: sequence },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('.diagram-drawing svg')).not.toBeNull(), { timeout: 10_000 })
  },
}

// One that can't be drawn: its source, and exactly what's wrong
export const Broken: Story = {
  args: { source: 'flowchart LR\n  A --> \n  B -->> ((C' },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(/Couldn’t draw this diagram/, {}, { timeout: 10_000 })).toBeVisible()
    await expect(canvas.getByText(/B -->> \(\(C/)).toBeVisible()
  },
}

// In a document, through MarkdownView's renderCode: other code stays code
export const InADocument: Story = {
  render: () => <MarkdownView tree={markdownTree(sample)} renderCode={renderMermaid} />,
  decorators: [(Story) => <Story />],
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('.diagram-drawing svg')).not.toBeNull(), { timeout: 10_000 })
    await expect(canvasElement.querySelector('code[data-lang="ts"]')).not.toBeNull()
  },
}
