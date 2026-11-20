// A whole file in the editor, as the Files tab will show it: each block knows the draft block it is,
// through typing, cutting and pasting, and the page turns that into draft changes when it saves
// (core's draftChanges). Read shows what it would send.
import { useMemo, useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { buildDraft, createIdea, type DraftChange, draftChanges } from '@ideaf/core'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { Button } from '../controls/Button.tsx'
import { MarkdownEditor, type MarkdownEditorHandle } from './MarkdownEditor.tsx'

const FILE = `# Offline mode

Field teams lose signal in basements, and today the app loses whatever they typed.

## What changes

- Changes are saved on the device first.
- A banner says the app is offline.
- Conflicts are shown side by side.

| State | Shown as |
| --- | --- |
| Queued | A clock |
| Sent | A tick |

## Not in scope

Starting a site visit offline.
`
// f1: s2 Offline mode, b3 its paragraph, s4 What changes, b5 b6 b7 the items, b8 the table,
// s9 Not in scope, b10 its paragraph

function Page() {
  // the draft, as the server keeps it: Save applies the changes to it, as change_draft does
  const [idea, setIdea] = useState(() => createIdea([{ path: 'offline.md', source: FILE }]))
  const file = idea.files[0]!
  const [value, setValue] = useState(file.source)
  const editor = useRef<MarkdownEditorHandle>(null)
  const [read, setRead] = useState('')
  // a new one only when it's saved
  const saved = useMemo(() => ({ source: idea.files[0]!.source, ids: idea.files[0]!.unitIds }), [idea])
  return (
    <div style={{ maxWidth: '48rem' }}>
      <MarkdownEditor
        ref={editor}
        flavor="page"
        label="offline.md"
        value={value}
        onChange={setValue}
        saved={saved}
        status="Saved to the draft"
      />
      <Button
        size="sm"
        onClick={() => {
          const blocks = editor.current!.blocks()
          const changes = draftChanges(idea, { [file.id]: blocks }, editor.current!.movedWords())
          setRead(JSON.stringify({ blocks, changes }))
        }}
      >
        Read
      </Button>
      <Button
        size="sm"
        onClick={() => {
          const made = draftChanges(idea, { [file.id]: editor.current!.blocks() }, editor.current!.movedWords())
          if (!made.ok) {
            throw new Error(made.message)
          }
          const saved = buildDraft(
            idea,
            [],
            made.changes.map((change, i) => ({ key: `k${i}`, change })),
          ).idea
          setIdea(saved)
          setValue(saved.files[0]!.source)
        }}
      >
        Save
      </Button>
      <output data-testid="read">{read}</output>
    </div>
  )
}

const meta = {
  title: 'Editor/Page',
  component: Page,
  beforeEach: () => {
    try {
      localStorage.removeItem('ideaf:editor:markdown')
    } catch {
      // no storage: nothing to clear
    }
  },
} satisfies Meta<typeof Page>

export default meta
type Story = StoryObj<typeof meta>

const surface = (canvas: HTMLElement) =>
  waitFor(
    () => {
      const box = canvas.querySelector<HTMLElement>(
        '.md-editor-rich:not([hidden]) .md-editor-surface[contenteditable="true"]',
      )
      expect(box).not.toBeNull()
      return box!
    },
    { timeout: 5000 },
  )
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))
const typing = userEvent.setup({ delay: 20 })

/** What the page would send: the blocks it read, and the draft changes from them. */
async function readBack(canvas: HTMLElement) {
  await userEvent.click(within(canvas).getByRole('button', { name: 'Read' }))
  const text = await waitFor(() => {
    const t = within(canvas).getByTestId('read').textContent
    expect(t).not.toBe('')
    return t!
  })
  const parsed = JSON.parse(text) as {
    blocks: Array<{ id: string | null; source: string }>
    changes: { ok: true; changes: DraftChange[] } | { ok: false; message: string }
  }
  if (!parsed.changes.ok) {
    throw new Error(parsed.changes.message)
  }
  return { blocks: parsed.blocks, changes: parsed.changes.changes }
}

/** The text of a block, by the words it starts with. */
function textNode(box: HTMLElement, starts: string): Text {
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent?.startsWith(starts)) {
      return node as Text
    }
  }
  throw new Error(`no text starting "${starts}"`)
}

async function select(box: HTMLElement, from: Text, start: number, to: Text = from, end = to.length) {
  const range = document.createRange()
  range.setStart(from, start)
  range.setEnd(to, end)
  box.focus()
  getSelection()!.removeAllRanges()
  getSelection()!.addRange(range)
  await settle()
}

// Opened, it is the draft: every block with its ID, and nothing to send
export const Opened: Story = {
  play: async ({ canvasElement }) => {
    await surface(canvasElement)
    const canvas = within(canvasElement)
    // the page's toolbar: history, the style menu, and the save status
    await expect(canvas.getByRole('button', { name: 'Undo' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Style: Text' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Code block' })).toBeVisible()
    await expect(canvasElement.querySelector('.md-editor-status')).toHaveTextContent('Saved to the draft')
    const { blocks, changes } = await readBack(canvasElement)
    await expect(blocks.map((b) => b.id)).toEqual(['s2', 'b3', 's4', 'b5', 'b6', 'b7', 'b8', 's9', 'b10'])
    await expect(changes).toEqual([])
  },
}

// Typing in a paragraph is an edit of that block, and of no other
export const Typing: Story = {
  play: async ({ canvasElement }) => {
    const box = await surface(canvasElement)
    const text = textNode(box, 'Starting a site')
    await select(box, text, text.length, text, text.length)
    await typing.keyboard(' Or a new one.')
    const { changes } = await readBack(canvasElement)
    await expect(changes).toEqual([
      {
        kind: 'edit',
        id: 'b10',
        source: 'Starting a site visit offline. Or a new one.',
        was: 'Starting a site visit offline.',
      },
    ])
  },
}

// A paragraph cut and pasted above another is a move: its identity went with it
export const CutAndPaste: Story = {
  play: async ({ canvasElement }) => {
    const box = await surface(canvasElement)
    const field = textNode(box, 'Field teams')
    await select(box, field, 0)
    // the clipboard events a cut and a paste make, with the data between them (a key press from a
    // script doesn't cut): what the browser hands the editor
    const data = new DataTransfer()
    box.dispatchEvent(new ClipboardEvent('cut', { clipboardData: data, bubbles: true, cancelable: true }))
    await settle()
    const last = textNode(box, 'Starting a site')
    await select(box, last, 0, last, 0)
    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    await settle()
    const { changes } = await readBack(canvasElement)
    await expect(changes.map((c) => c.kind)).toEqual(['move'])
    await expect(changes[0]).toMatchObject({ kind: 'move', id: 'b3' })
  },
}

// A new paragraph is new text, after the block before it
export const NewParagraph: Story = {
  play: async ({ canvasElement }) => {
    const box = await surface(canvasElement)
    const field = textNode(box, 'Field teams')
    await select(box, field, field.length, field, field.length)
    await typing.keyboard('{Enter}Support logged 57 tickets.')
    const { changes } = await readBack(canvasElement)
    await expect(changes).toEqual([{ kind: 'insert', at: { after: 'b3' }, markdown: 'Support logged 57 tickets.' }])
  },
}

// The Markdown side has no identities: its blocks are matched to the draft's by their text
export const MarkdownSide: Story = {
  play: async ({ canvasElement }) => {
    await surface(canvasElement)
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'View Markdown source' }))
    const source = await canvas.findByRole('textbox', { name: 'offline.md' })
    const at = (source as HTMLTextAreaElement).value.indexOf('loses whatever')
    ;(source as HTMLTextAreaElement).setSelectionRange(at, at)
    await userEvent.type(source, 'often ', { initialSelectionStart: at, initialSelectionEnd: at })
    const { changes } = await readBack(canvasElement)
    await expect(changes).toEqual([
      {
        kind: 'edit',
        id: 'b3',
        source: 'Field teams lose signal in basements, and today the app often loses whatever they typed.',
        was: 'Field teams lose signal in basements, and today the app loses whatever they typed.',
      },
    ])
  },
}

// Saved, new text takes the ID the draft gave it: saving again sends nothing, and typing in it after
// is an edit of it, not more new text
export const SavedNewText: Story = {
  play: async ({ canvasElement }) => {
    const box = await surface(canvasElement)
    const field = textNode(box, 'Field teams')
    await select(box, field, field.length, field, field.length)
    await typing.keyboard('{Enter}Support logged 57 tickets.')
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(box.querySelector('[data-block-id="b11"]')).toHaveTextContent('Support logged 57 tickets.'),
    )
    await expect((await readBack(canvasElement)).changes).toEqual([])
    const added = textNode(box, 'Support logged')
    await select(box, added, added.length, added, added.length)
    await typing.keyboard(' Last quarter.')
    await expect((await readBack(canvasElement)).changes).toEqual([
      {
        kind: 'edit',
        id: 'b11',
        source: 'Support logged 57 tickets. Last quarter.',
        was: 'Support logged 57 tickets.',
      },
    ])
  },
}
