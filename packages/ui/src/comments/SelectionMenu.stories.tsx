import { useRef } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { markdownTree } from '@ideaf/core'
import { expect, fn, waitFor, within } from 'storybook/test'
import { SelectionMenu, type SelectionMenuProps } from './SelectionMenu.tsx'
import { MarkdownView } from '../document/MarkdownView.tsx'
import sample from '../stories/sample.md?raw'

const tree = markdownTree(sample)

function Document(props: Omit<SelectionMenuProps, 'documentRef'>) {
  const document = useRef<HTMLDivElement>(null)
  return (
    <div ref={document}>
      <MarkdownView tree={tree} />
      <SelectionMenu documentRef={document} source={sample} {...props} />
    </div>
  )
}

// Select some text in the document, as a reader dragging over it would, or
// extending a selection with Shift and the arrow keys
function select(root: HTMLElement, text: string, by: 'pointer' | 'keyboard' = 'pointer') {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = node.textContent?.indexOf(text) ?? -1
    if (at >= 0) {
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + text.length)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      node.parentElement!.dispatchEvent(
        by === 'pointer'
          ? new PointerEvent('pointerup', { bubbles: true })
          : new KeyboardEvent('keyup', { bubbles: true, key: 'ArrowRight', shiftKey: true }),
      )
      return
    }
  }
  throw new Error(`no "${text}" in the document`)
}

const meta = {
  title: 'Comments/SelectionMenu',
  component: Document,
  args: { onComment: fn(), onSuggest: fn(), onSectionComment: fn() },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Document>

export default meta
type Story = StoryObj<typeof meta>

// Select text: comment on it, suggest an edit, or comment on its section
export const Menu: Story = {
  play: async ({ canvasElement }) => {
    select(canvasElement, 'oldest first')
    const page = within(document.body)
    const menu = await page.findByRole('toolbar', { name: 'Selected text' })
    await expect(menu).toBeVisible()
    await expect(page.getByRole('button', { name: 'Comment on “Proposal”' })).toBeVisible()
    // just above the selected text and centred on it: the line under it stays readable, and so does
    // the start of the line above, which is often the sentence being read
    await waitFor(() => {
      const text = window.getSelection()!.getRangeAt(0).getBoundingClientRect()
      const box = menu.getBoundingClientRect()
      expect(box.bottom).toBeLessThan(text.top)
      expect(text.top - box.bottom).toBeLessThan(16)
      // (unless that would put it off the window's edge, where it stops short of it)
      const centred = Math.abs(box.left + box.width / 2 - (text.left + text.width / 2)) < 1
      expect(centred || Math.round(box.left) === 12).toBe(true)
      expect(box.left).toBeLessThan(text.left)
    })
  },
}

// A selection made with the keyboard moves focus to the menu
export const Keyboard: Story = {
  play: async ({ canvasElement }) => {
    select(canvasElement, 'oldest first', 'keyboard')
    const page = within(document.body)
    await waitFor(() => expect(page.getByRole('button', { name: 'Comment' })).toHaveFocus())
  },
}

// A click elsewhere closes it, but not once something's been typed; Esc does
export const Closing: Story = {
  play: async ({ canvasElement, userEvent }) => {
    const page = within(document.body)
    const elsewhere = within(canvasElement).getByRole('heading', { name: 'Proposal' })
    select(canvasElement, 'oldest first')
    await page.findByRole('toolbar', { name: 'Selected text' })
    await userEvent.click(elsewhere)
    await waitFor(() => expect(page.queryByRole('toolbar')).toBeNull())

    select(canvasElement, 'oldest first')
    await userEvent.click(await page.findByRole('button', { name: 'Comment' }))
    await userEvent.type(await page.findByRole('textbox', { name: 'Comment' }), 'Half a thought')
    await userEvent.click(elsewhere)
    await expect(page.getByRole('textbox', { name: 'Comment' })).toHaveTextContent('Half a thought')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page.queryByRole('dialog')).toBeNull())
  },
}

// A comment on the selected text, anchored on its offsets in the Markdown
export const Comment: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    select(canvasElement, 'oldest first')
    const page = within(document.body)
    await userEvent.click(await page.findByRole('button', { name: 'Comment' }))
    // the text stays marked while the form has the focus, and not after
    await expect(CSS.highlights.has('selection-pending')).toBe(true)
    await userEvent.type(await page.findByRole('textbox', { name: 'Comment' }), 'Oldest by device clock?')
    await userEvent.click(page.getByRole('button', { name: 'Comment' }))
    await waitFor(() => expect(CSS.highlights.has('selection-pending')).toBe(false))
    const start = sample.indexOf('oldest first')
    await waitFor(() =>
      expect(args.onComment).toHaveBeenCalledWith(
        {
          quote: 'oldest first',
          start,
          end: start + 12,
          section: { title: 'Proposal', heading: sample.indexOf('## Proposal') },
        },
        'Oldest by device clock?',
        false,
      ),
    )
  },
}

// A suggested edit starts from the text as written, Markdown and all
export const Suggest: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    select(canvasElement, 'stops working')
    const page = within(document.body)
    await userEvent.click(await page.findByRole('button', { name: 'Suggest an edit' }))
    const replacement = page.getByRole('textbox', { name: 'Replace it with' })
    await expect(replacement).toHaveValue('stops working')
    await userEvent.clear(replacement)
    await userEvent.type(replacement, 'can’t save')
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    await expect(args.onSuggest).toHaveBeenCalledWith(
      expect.objectContaining({ quote: 'stops working' }),
      'can’t save',
      '',
      false,
    )
  },
}

// A comment can wait for your review instead of going out now
export const AddToReview: Story = {
  args: { addToReview: true },
  play: async ({ args, canvasElement, userEvent }) => {
    select(canvasElement, 'oldest first')
    const page = within(document.body)
    await userEvent.click(await page.findByRole('button', { name: 'Comment' }))
    await userEvent.type(await page.findByRole('textbox', { name: 'Comment' }), 'Later')
    await userEvent.click(page.getByRole('button', { name: 'Add to your review' }))
    await waitFor(() =>
      expect(args.onComment).toHaveBeenCalledWith(expect.objectContaining({ quote: 'oldest first' }), 'Later', true),
    )
  },
}

// On an older version, nothing can be added
export const Disabled: Story = {
  args: { enabled: false },
  play: async ({ canvasElement }) => {
    select(canvasElement, 'oldest first')
    await new Promise((resolve) => setTimeout(resolve, 50))
    await expect(document.body.querySelector('.selection-menu')).toBeNull()
  },
}
