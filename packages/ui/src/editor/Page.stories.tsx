// A whole file in the editor, as the Files tab will show it: each block knows the draft block it is,
// through typing, cutting and pasting, and the page turns that into draft changes when it saves
// (core's draftChanges). Read shows what it would send.
import { useMemo, useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { buildDraft, createIdea, type DraftChange, draftChanges } from '@ideaf/core'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { Button } from '../controls/Button.tsx'
import { MarkdownEditor, type MarkdownEditorHandle } from './MarkdownEditor.tsx'
import type { PageMark } from './milkdown.ts'

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

// two comments, where the draft has them: on the field paragraph's first words, and on a section
const COMMENTS: PageMark[] = [
  { id: 'c1', block: 'b3', from: 0, to: 25, quote: 'Field teams lose signal i' },
  { id: 'c2', heading: 's9' },
]

function Page({ comments, active }: { comments?: PageMark[]; active?: string }) {
  // the draft, as the server keeps it: Save applies the changes to it, as change_draft does
  const opened = () => createIdea([{ path: 'offline.md', source: FILE }])
  const [idea, setIdea] = useState(opened)
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
        {...(comments ? { comments } : {})}
        {...(active ? { activeComment: active } : {})}
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
          // nothing to save: the page leaves what's on screen as it is
          if (made.changes.length === 0) {
            return
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
      <Button
        size="sm"
        onClick={() => {
          // the draft emptied: the file, and its blocks' IDs, as they were
          const fresh = opened()
          setIdea(fresh)
          setValue(fresh.files[0]!.source)
        }}
      >
        Discard
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
    await expect(canvas.getByRole('button', { name: /^Style: / })).toBeVisible()
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

// An empty bullet is a change of its own: a list item, in the list, with its words to come
export const EmptyBullet: Story = {
  play: async ({ canvasElement }) => {
    const box = await surface(canvasElement)
    const last = textNode(box, 'Conflicts are')
    await select(box, last, last.length, last, last.length)
    await typing.keyboard('{Enter}')
    await expect((await readBack(canvasElement)).changes).toEqual([
      { kind: 'insert', at: { after: 'b7' }, markdown: '-' },
    ])
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

// Backspace at a heading's start joins it to the block before, as anywhere else: it doesn't take the
// heading down a level, as if deleting a hidden #
export const BackspaceAtAHeading: Story = {
  play: async ({ canvasElement }) => {
    const box = await surface(canvasElement)
    const heading = textNode(box, 'What changes')
    await select(box, heading, 0, heading, 0)
    await typing.keyboard('{Backspace}')
    await expect(box.querySelector('h3')).toBeNull()
    await expect(box.querySelector('h1')).toHaveTextContent('Offline mode')
    await expect(box.querySelectorAll('h1')).toHaveLength(1)
    await waitFor(() => expect(textNode(box, 'Field teams').textContent).toMatch(/typed\.What changes$/))
  },
}

// Opened again with the draft as saved (it ends in a newline the editor leaves off), the caret stays
// where it was, not at the end of the file
export const CaretStaysWhenSaved: Story = {
  play: async ({ canvasElement }) => {
    const box = await surface(canvasElement)
    const last = textNode(box, 'Starting a site')
    await select(box, last, last.length, last, last.length)
    await typing.keyboard('{Enter}A last line.')
    const field = textNode(box, 'Field teams')
    await select(box, field, 5, field, 5)
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(box.querySelector('[data-block-id="b11"]')).not.toBeNull())
    const caret = getSelection()!
    await expect(caret.anchorNode?.textContent).toMatch(/^Field teams/)
  },
}

// Cutting every item of a list takes the list: no empty item is left behind, and pasted elsewhere
// the items are moves
export const CutAWholeList: Story = {
  play: async ({ canvasElement }) => {
    const box = await surface(canvasElement)
    const first = textNode(box, 'Changes are saved')
    const last = textNode(box, 'Conflicts are shown')
    await select(box, first, 0, last)
    const data = new DataTransfer()
    box.dispatchEvent(new ClipboardEvent('cut', { clipboardData: data, bubbles: true, cancelable: true }))
    await settle()
    await expect(box.querySelectorAll('li')).toHaveLength(0)
    const end = textNode(box, 'Starting a site')
    await select(box, end, 0, end, 0)
    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    await settle()
    await expect(box.querySelectorAll('li')).toHaveLength(3)
    const { changes } = await readBack(canvasElement)
    await expect(changes.length).toBeGreaterThan(0)
    await expect(changes.every((c) => c.kind === 'move')).toBe(true)
  },
}

// A new heading chosen from the style menu on an empty line is nothing yet, and isn't saved; typed
// in, it's a new heading, and saved, it takes its ID
export const NewHeading: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = await surface(canvasElement)
    const field = textNode(box, 'Field teams')
    await select(box, field, field.length, field, field.length)
    await typing.keyboard('{Enter}')
    await userEvent.click(canvas.getByRole('button', { name: /^Style: / }))
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: /Heading 2/ }))
    // the caret's back in the text, in the new heading, to type its words
    await waitFor(() => expect(box).toHaveFocus())
    await expect(getSelection()!.anchorNode?.nodeName).toBe('H2')
    // an empty heading is saved as one, words to come
    await expect((await readBack(canvasElement)).changes).toEqual([
      { kind: 'insert', at: { after: 'b3' }, markdown: '##' },
    ])
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(box.querySelector('h2[data-block-id="s11"]')).not.toBeNull())
    // back into the empty heading (the page saves by itself; here a button did)
    const empty = [...box.querySelectorAll('h2')].find((h) => h.textContent === '')!
    const range = document.createRange()
    range.setStart(empty, 0)
    box.focus()
    getSelection()!.removeAllRanges()
    getSelection()!.addRange(range)
    await settle()
    await typing.keyboard('ddd')
    await expect((await readBack(canvasElement)).changes).toEqual([
      { kind: 'edit', id: 's11', source: '## ddd', was: '##' },
    ])
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(box.querySelector('h2[data-block-id="s11"]')).toHaveTextContent('ddd'))
    await expect((await readBack(canvasElement)).changes).toEqual([])
  },
}

// An empty line is a change too: Markdown has none, so it's written as its placeholder, `<br />`,
// opened again as the empty line it was, and typed in, it's that block edited
export const EmptyLine: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = await surface(canvasElement)
    const field = textNode(box, 'Field teams')
    await select(box, field, field.length, field, field.length)
    await typing.keyboard('{Enter}')
    await expect((await readBack(canvasElement)).changes).toEqual([
      { kind: 'insert', at: { after: 'b3' }, markdown: '<br />' },
    ])
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    const empty = await waitFor(() => {
      const p = box.querySelector<HTMLElement>('p[data-block-id="b11"]')
      expect(p).not.toBeNull()
      expect(p).toHaveTextContent('')
      return p!
    })
    const range = document.createRange()
    range.setStart(empty, 0)
    box.focus()
    getSelection()!.removeAllRanges()
    getSelection()!.addRange(range)
    await settle()
    await typing.keyboard('Words')
    await expect((await readBack(canvasElement)).changes).toEqual([
      { kind: 'edit', id: 'b11', source: 'Words', was: '<br />' },
    ])
  },
}

// Comments are marked as the document marks them, and stay on their words: typed before, and cut
// and pasted with their text
export const Comments: Story = {
  args: { comments: COMMENTS },
  play: async ({ canvasElement }) => {
    const box = await surface(canvasElement)
    const mark = () => [...box.querySelectorAll('mark[data-comment-id="c1"]')].map((m) => m.textContent).join('')
    await waitFor(() => expect(mark()).toBe('Field teams lose signal i'))
    await expect(box.querySelector('h2[data-comment-id="c2"]')).toHaveTextContent('Not in scope')
    // words typed before it
    const field = textNode(box, 'Field teams')
    await select(box, field, 0, field, 0)
    await typing.keyboard('Today, ')
    await expect(mark()).toBe('Field teams lose signal i')
    // the paragraph cut, and pasted at the end: its comment goes with it
    // all of it (the mark splits its text in two)
    const paragraph = textNode(box, 'Today, ').parentElement!.closest('p')!
    const all = document.createRange()
    all.selectNodeContents(paragraph)
    box.focus()
    getSelection()!.removeAllRanges()
    getSelection()!.addRange(all)
    await settle()
    const data = new DataTransfer()
    box.dispatchEvent(new ClipboardEvent('cut', { clipboardData: data, bubbles: true, cancelable: true }))
    await settle()
    await expect(mark()).toBe('')
    const last = textNode(box, 'Starting a site')
    await select(box, last, last.length, last, last.length)
    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    await settle()
    await waitFor(() => expect(mark()).toBe('Field teams lose signal i'))
  },
}

// A cut pasted, the paste undone, and pasted again: the second paste is the move, as the first was,
// and the comment comes back with its words
export const PasteUndonePastedAgain: Story = {
  args: { comments: COMMENTS },
  play: async ({ canvasElement }) => {
    const box = await surface(canvasElement)
    const mark = () => [...box.querySelectorAll('mark[data-comment-id="c1"]')].map((m) => m.textContent).join('')
    await waitFor(() => expect(mark()).toBe('Field teams lose signal i'))
    const field = textNode(box, 'Field teams').parentElement!.closest('p')!
    const all = document.createRange()
    all.selectNodeContents(field)
    box.focus()
    getSelection()!.removeAllRanges()
    getSelection()!.addRange(all)
    await settle()
    const data = new DataTransfer()
    box.dispatchEvent(new ClipboardEvent('cut', { clipboardData: data, bubbles: true, cancelable: true }))
    await settle()
    const last = textNode(box, 'Starting a site')
    await select(box, last, last.length, last, last.length)
    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    await settle()
    await waitFor(() => expect(mark()).toBe('Field teams lose signal i'))
    await typing.keyboard('{Control>}z{/Control}')
    await waitFor(() => expect(mark()).toBe(''))
    await expect(box.querySelector('[data-block-id="b3"]')).toBeNull()
    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    await settle()
    await expect(box.querySelector('p[data-block-id="b3"]')).toHaveTextContent(/^Field teams/)
    await waitFor(() => expect(mark()).toBe('Field teams lose signal i'))
    const { changes } = await readBack(canvasElement)
    await expect(changes).toEqual([
      { kind: 'move', id: 'b3', to: { after: 'b10' }, was: expect.stringMatching(/^Field teams/) },
    ])
  },
}

// The draft discarded while its text is what's on the page: the blocks take back the IDs they had,
// new ones a save gave them or not, and the comments are on their words again
export const DiscardedToTheSameText: Story = {
  args: { comments: COMMENTS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = await surface(canvasElement)
    const mark = () => [...box.querySelectorAll('mark[data-comment-id="c1"]')].map((m) => m.textContent).join('')
    await waitFor(() => expect(mark()).toBe('Field teams lose signal i'))
    // the paragraph copied (new text), cut and saved, and the copy pasted where it was and saved: the
    // same text as the file, its paragraph a new block
    const field = textNode(box, 'Field teams').parentElement!.closest('p')!
    const all = document.createRange()
    all.selectNodeContents(field)
    box.focus()
    getSelection()!.removeAllRanges()
    getSelection()!.addRange(all)
    await settle()
    const copied = new DataTransfer()
    box.dispatchEvent(new ClipboardEvent('copy', { clipboardData: copied, bubbles: true, cancelable: true }))
    box.dispatchEvent(new ClipboardEvent('cut', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true }))
    await settle()
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await settle()
    const next = textNode(box, 'What changes')
    await select(box, next, 0, next, 0)
    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: copied, bubbles: true, cancelable: true }))
    await settle()
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(box.querySelector('p[data-block-id="b11"]')).toHaveTextContent(/^Field teams/))
    await expect(mark()).toBe('')
    await userEvent.click(canvas.getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(box.querySelector('p[data-block-id="b3"]')).toHaveTextContent(/^Field teams/))
    await waitFor(() => expect(mark()).toBe('Field teams lose signal i'))
    const { blocks, changes } = await readBack(canvasElement)
    await expect(blocks.map((b) => b.id)).toEqual(['s2', 'b3', 's4', 'b5', 'b6', 'b7', 'b8', 's9', 'b10'])
    await expect(changes).toEqual([])
  },
}

// The comment whose card is open: its mark lit as the document lights it, one mark, not a second
// one inside it with none of the page's colors
export const ActiveComment: Story = {
  args: { comments: COMMENTS, active: 'c1' },
  play: async ({ canvasElement }) => {
    const box = await surface(canvasElement)
    await waitFor(() =>
      expect(box.querySelectorAll('mark.md-mark.is-active[data-comment-id="c1"]').length).toBeGreaterThan(0),
    )
    await expect(box.querySelectorAll('mark:not(.md-mark)')).toHaveLength(0)
    await expect(box.querySelector('mark.md-mark mark')).toBeNull()
    await expect(box.querySelector('h2[data-comment-id="c2"]')).not.toHaveClass('is-active')
  },
}

// A comment on a whole block, while editing: the block's corner marks, as the document draws them;
// open, the whole rectangle, filled
export const BlockComment: Story = {
  args: { comments: [{ id: 'c9', whole: 'b6' }], active: 'c9' },
  play: async ({ canvasElement }) => {
    const box = await surface(canvasElement)
    const item = await waitFor(() => {
      const element = box.querySelector<HTMLElement>('li.md-block-mark[data-comment-ids="c9"]')
      expect(element).not.toBeNull()
      return element!
    })
    await expect(item).toHaveTextContent('A banner says the app is offline.')
    await waitFor(() => expect(item).toHaveClass('is-active'))
  },
}
