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
    // focusable, as the idea page's file is, for the arrow keys
    <div ref={document} tabIndex={0} role="region" aria-label="File">
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

/** Waits for the browser to draw `n` more frames. */
const frames = (n: number) =>
  new Promise<void>((done) => {
    const next = (left: number) => (left === 0 ? done() : requestAnimationFrame(() => next(left - 1)))
    next(n)
  })

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
    // the box has the focus once it's ready: typing goes straight in
    const box = await page.findByRole('textbox', { name: 'Comment' })
    await waitFor(() => expect(box).toHaveFocus())
    await userEvent.keyboard('Oldest by device clock?')
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

// A suggested edit starts from the text as written. The replacement and the reason are both
// editors; only the one in use shows its toolbar
export const Suggest: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    select(canvasElement, 'stops working')
    const page = within(document.body)
    await userEvent.click(await page.findByRole('button', { name: 'Suggest an edit' }))
    const replacement = await page.findByRole('textbox', { name: 'Replace it with' })
    await waitFor(() => expect(replacement).toHaveFocus())
    await expect(replacement).toHaveTextContent('stops working')
    const [forReplacement, forWhy] = [...document.querySelectorAll('.selection-menu .md-editor')]
    await waitFor(() => expect(forReplacement!.querySelector('.md-editor-bar')).toBeVisible())
    await expect(forWhy!.querySelector('.md-editor-bar')).not.toBeVisible()
    // the inline flavor: marks and links, no blocks
    await expect(within(forReplacement as HTMLElement).queryByRole('button', { name: 'Bulleted list' })).toBeNull()
    await userEvent.click(await page.findByRole('textbox', { name: 'Why' }))
    await waitFor(() => expect(forWhy!.querySelector('.md-editor-bar')).toBeVisible())
    await expect(forReplacement!.querySelector('.md-editor-bar')).not.toBeVisible()
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

// A selection cutting through formatting takes it whole, and the replacement shows it as it reads:
// what's sent is Markdown
export const SuggestFormatted: Story = {
  // as the page widens it (core's suggestionSource)
  args: { suggestionOf: () => 'app **stops working**' },
  play: async ({ args, canvasElement, userEvent }) => {
    // from "app " into the bold "stops working"
    const texts = document.createTreeWalker(canvasElement, NodeFilter.SHOW_TEXT)
    let before: Node | null = texts.nextNode()
    while (before && !before.textContent!.includes('today the app')) {
      before = texts.nextNode()
    }
    const bold = texts.nextNode()!
    const range = document.createRange()
    range.setStart(before!, before!.textContent!.indexOf('app'))
    range.setEnd(bold, 'stops'.length)
    getSelection()!.removeAllRanges()
    getSelection()!.addRange(range)
    bold.parentElement!.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    const page = within(document.body)
    await userEvent.click(await page.findByRole('button', { name: 'Suggest an edit' }))
    const replacement = await page.findByRole('textbox', { name: 'Replace it with' })
    await waitFor(() => expect(replacement).toHaveFocus())
    await expect(replacement.querySelector('strong')).toHaveTextContent('stops working')
    await expect(replacement).not.toHaveTextContent('**')
    // the caret's at the end, in the bold, so what's typed is bold too
    await userEvent.keyboard(' at once{Control>}{Enter}{/Control}')
    await expect(args.onSuggest).toHaveBeenCalledWith(
      expect.objectContaining({ quote: 'app stops' }),
      'app **stops working at once**',
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

// Point at a block, and a button beside it comments on the whole block: a table here. A heading's
// button comments on its section
export const BlockButton: Story = {
  args: { onBlockComment: fn() },
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(document.body)
    const table = canvasElement.querySelector<HTMLElement>('.md-table')!
    table.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
    const button = await page.findByRole('button', { name: 'Comment on this table' })
    // in the margin to its right, level with its first line
    const box = table.getBoundingClientRect()
    await expect(button.getBoundingClientRect().left).toBeGreaterThanOrEqual(box.right)
    await expect(Math.abs(button.getBoundingClientRect().top - box.top)).toBeLessThan(2)
    await userEvent.click(button)
    const form = await page.findByRole('dialog', { name: 'Comment on the block' })
    await expect(form).toHaveTextContent('Table ·')
    await userEvent.type(await within(form).findByRole('textbox', { name: 'Comment' }), 'Add a row for edits')
    await userEvent.click(within(form).getByRole('button', { name: 'Comment' }))
    await expect(args.onBlockComment).toHaveBeenCalledWith(
      { start: sample.indexOf('| Case'), end: expect.any(Number), label: 'table' },
      'Add a row for edits',
      false,
    )
    // a heading's: its section
    const heading = canvasElement.querySelector<HTMLElement>('#rollout')!
    heading.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
    await userEvent.click(await page.findByRole('button', { name: 'Comment on this section' }))
    const section = await page.findByRole('dialog', { name: 'Comment on the section' })
    await expect(section).toHaveTextContent('Section · Rollout')
  },
}

// With the document focused, the arrow keys move a block at a time, from the block clicked in: a
// list item is a block, a list isn't. C comments on the block in focus (a heading's section), and
// focus comes back to the block once the comment is sent, or the form put away
export const BlockKeys: Story = {
  args: { onBlockComment: fn(), onSectionComment: fn() },
  play: async ({ args, canvasElement, userEvent }) => {
    const page = within(document.body)
    const paragraph = within(canvasElement)
      .getByText(/One endpoint takes a batch/)
      .closest('p')!
    await userEvent.click(paragraph)
    await userEvent.keyboard('{ArrowDown}')
    // the block clicked in first, then the next
    await waitFor(() => expect(document.activeElement).toBe(paragraph))
    await userEvent.keyboard('{ArrowDown}')
    const code = canvasElement.querySelector('pre')!.closest<HTMLElement>('[data-start]')!
    await waitFor(() => expect(document.activeElement).toBe(code))
    // its button beside it
    await expect(await page.findByRole('button', { name: 'Comment on this code' })).toBeVisible()
    await userEvent.keyboard('{ArrowDown}')
    const conflicts = canvasElement.querySelector<HTMLElement>('#conflicts')!
    await waitFor(() => expect(document.activeElement).toBe(conflicts))
    await userEvent.keyboard('{ArrowUp}')
    await waitFor(() => expect(document.activeElement).toBe(code))

    // C: the form, on the block in focus
    await userEvent.keyboard('c')
    const form = await page.findByRole('dialog', { name: 'Comment on the block' })
    await expect(form).toHaveTextContent('Code ·')
    await userEvent.type(await within(form).findByRole('textbox', { name: 'Comment' }), 'Show a response too')
    await userEvent.click(within(form).getByRole('button', { name: 'Comment' }))
    await expect(args.onBlockComment).toHaveBeenCalledWith(
      { start: sample.indexOf('```ts'), end: expect.any(Number), label: 'code' },
      'Show a response too',
      false,
    )
    await waitFor(() => expect(document.activeElement).toBe(code))

    // on a heading, its section; Escape puts the form away, and focus is back on the heading
    await userEvent.keyboard('{ArrowDown}c')
    await expect(await page.findByRole('dialog', { name: 'Comment on the section' })).toHaveTextContent(
      'Section · Conflicts',
    )
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(conflicts))

    // the list's items, one at a time, not the list
    const items = [...canvasElement.querySelectorAll<HTMLElement>('ol > li')]
    await userEvent.click(within(canvasElement).getByText('Rollout'))
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    await waitFor(() => expect(document.activeElement).toBe(items[0]))
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() => expect(document.activeElement).toBe(items[1]))
  },
}

// From the document itself, with nothing clicked, the first block in view
export const BlockKeysFromTheDocument: Story = {
  args: { onBlockComment: fn(), onSectionComment: fn() },
  play: async ({ canvasElement, userEvent }) => {
    // at the top of the page, and staying there: the story before ends with a smooth scroll (the
    // block arrowed to, scrolled into view), which can still be running here and carry the page
    // down past the first block after a scroll to the top that had nothing to do
    await waitFor(async () => {
      window.scrollTo(0, 0)
      await frames(2)
      await expect(window.scrollY).toBe(0)
    })
    canvasElement.querySelector<HTMLElement>('[role="region"]')!.focus({ preventScroll: true })
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() => expect(document.activeElement).toBe(canvasElement.querySelector('h1')))
    await expect(await within(document.body).findByRole('button', { name: 'Comment on this section' })).toBeVisible()
  },
}
