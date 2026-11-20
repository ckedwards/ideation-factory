import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { Button } from '../controls/Button.tsx'
import { MarkdownEditor, type MarkdownEditorProps } from './MarkdownEditor.tsx'

// the box with its value in state, as a page holds it; the last Markdown it gave is on the page too
function Box(
  props: Omit<MarkdownEditorProps, 'value' | 'onChange'> & {
    value: string
    width: string
    onChange?: (v: string) => void
  },
) {
  const [value, setValue] = useState(props.value)
  const { width, ...rest } = props
  return (
    <div style={{ maxWidth: width }}>
      <MarkdownEditor
        {...rest}
        value={value}
        onChange={(next) => {
          setValue(next)
          props.onChange?.(next)
        }}
      />
      <pre data-testid="markdown" hidden>
        {value}
      </pre>
    </div>
  )
}

const comment = `Two things before this goes to review:

- The banner should say **how many** changes are waiting, not only that the app is offline.
- \`sync-states.md\` calls this state *queued*. Use the same word here.

The [web app's connection notice](https://example.com/notice) has wording we can copy.`

const meta = {
  title: 'Editor/MarkdownEditor',
  component: Box,
  args: {
    value: '',
    width: '40rem',
    label: 'Comment',
    placeholder: 'Add a comment…',
    onChange: fn(),
    onSubmit: fn(),
    onCancel: fn(),
    footer: (
      <>
        <Button size="sm">Add to your review</Button>
        <Button size="sm" variant="primary">
          Comment
        </Button>
      </>
    ),
  },
  beforeEach: () => {
    try {
      localStorage.removeItem('ideaf:editor:markdown')
    } catch {
      // no storage: nothing to clear
    }
  },
} satisfies Meta<typeof Box>

export default meta
type Story = StoryObj<typeof meta>

// the rich text box, once it's loaded and drawn (the text stands in until then, the box hidden)
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
// typing into the rich text a key at a time, as a person does: ProseMirror reads what each key did
// before the next, where a burst of synthetic keys can outrun it
const typing = userEvent.setup({ delay: 20 })

// a selection set from a script reaches ProseMirror on the next selectionchange: wait for it
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))
const markdown = (canvas: HTMLElement) => within(canvas).getByTestId('markdown').textContent

// A comment, as it'll read: the list, bold, code and link drawn, not their Markdown. Opening it changes nothing
export const Comment: Story = {
  args: { value: comment },
  play: async ({ args, canvasElement }) => {
    const box = await surface(canvasElement)
    await waitFor(() => expect(box).toHaveAttribute('contenteditable', 'true'))
    await expect(within(box).getByText('how many').tagName).toBe('STRONG')
    await expect(within(box).getByRole('link', { name: "web app's connection notice" })).toBeVisible()
    await expect(box.querySelectorAll('li')).toHaveLength(2)
    await expect(args.onChange).not.toHaveBeenCalled()
  },
}

// Empty, it says what it's for
export const Empty: Story = {
  play: async ({ canvasElement }) => {
    const box = await surface(canvasElement)
    await waitFor(() => expect(box.querySelector('[data-placeholder="Add a comment…"]')).not.toBeNull())
  },
}

// Markdown typed by hand turns into what it means; what's given back is Markdown
export const TypingMarkdown: Story = {
  play: async ({ canvasElement }) => {
    const box = await surface(canvasElement)
    await userEvent.click(box)
    await settle()
    await typing.keyboard('Some **bold** text and `code`')
    await waitFor(() => expect(within(box).getByText('bold').tagName).toBe('STRONG'))
    await expect(within(box).getByText('code').tagName).toBe('CODE')
    await typing.keyboard('{Enter}- one')
    await waitFor(() => expect(box.querySelector('ul li')).not.toBeNull())
    await expect(markdown(canvasElement)).toBe('Some **bold** text and `code`\n\n- one')
  },
}

// The toolbar: a button acts on the selection and lights while the caret's in what it made; keys work too
export const Toolbar: Story = {
  args: { value: 'Make this word bold.' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = await surface(canvasElement)
    await waitFor(() => expect(box).toHaveAttribute('contenteditable', 'true'))
    const word = within(box).getByText(/Make this word bold/)
    // select "word"
    const text = word.firstChild!
    const range = document.createRange()
    range.setStart(text, 10)
    range.setEnd(text, 14)
    box.focus()
    getSelection()!.removeAllRanges()
    getSelection()!.addRange(range)
    await settle()
    await userEvent.click(canvas.getByRole('button', { name: 'Bold' }))
    await waitFor(() => expect(markdown(canvasElement)).toBe('Make this **word** bold.'))
    await expect(canvas.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.keyboard('{Control>}i{/Control}')
    await waitFor(() => expect(markdown(canvasElement)).toMatch(/\*\*_word_\*\*|_\*\*word\*\*_|\*\*\*word\*\*\*/))
    await userEvent.click(canvas.getByRole('button', { name: 'Bulleted list' }))
    await waitFor(() => expect(markdown(canvasElement)).toMatch(/^- Make this/))
    await expect(canvas.getByRole('button', { name: 'Bulleted list' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(canvas.getByRole('button', { name: 'Numbered list' }))
    await waitFor(() => expect(markdown(canvasElement)).toMatch(/^1\. Make this/))
  },
}

// One tab stop: the arrow keys move along the toolbar, and Tab leaves the editor, outside a table
export const Keyboard: Story = {
  args: { value: 'Some text.' },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const box = await surface(canvasElement)
    await waitFor(() => expect(box).toHaveAttribute('contenteditable', 'true'))
    await userEvent.click(box)
    await settle()
    await userEvent.tab({ shift: true })
    await expect(canvas.getByRole('button', { name: 'Bold' })).toHaveFocus()
    await userEvent.keyboard('{End}')
    await expect(canvas.getByRole('button', { name: 'View Markdown source' })).toHaveFocus()
    await userEvent.keyboard('{Home}')
    await expect(canvas.getByRole('button', { name: 'Bold' })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(canvas.getByRole('button', { name: 'Italic' })).toHaveFocus()
    // from the text, Tab goes on to the box's buttons
    await userEvent.click(box)
    await settle()
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Add to your review' })).toHaveFocus()
    // ⌘↵ sends, Esc gives up
    await userEvent.click(box)
    await settle()
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    await expect(args.onSubmit).toHaveBeenCalled()
    await userEvent.keyboard('{Escape}')
    await expect(args.onCancel).toHaveBeenCalled()
  },
}

// View Markdown source: the source in the plain box, where the toolbar types Markdown; remembered for next time
export const MarkdownSwitch: Story = {
  args: { value: 'Hello *there*.' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await surface(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'View Markdown source' }))
    const source = canvas.getByRole('textbox', { name: 'Comment' })
    await expect(source.tagName).toBe('TEXTAREA')
    await expect(source).toHaveValue('Hello *there*.')
    await expect(source).toHaveFocus()
    await expect(canvas.getByRole('button', { name: 'View Markdown source' })).toHaveAttribute('aria-pressed', 'true')
    // its tooltip says where it goes now
    await expect(canvas.getByRole('button', { name: 'View Markdown source' })).toHaveAttribute(
      'title',
      'View formatted text',
    )
    await expect(localStorage.getItem('ideaf:editor:markdown')).toBe('1')
    // the toolbar wraps the selection in Markdown
    ;(source as HTMLTextAreaElement).setSelectionRange(0, 5)
    await userEvent.click(canvas.getByRole('button', { name: 'Bold' }))
    await expect(source).toHaveValue('**Hello** *there*.')
    // and back: rich, with the change
    await userEvent.click(canvas.getByRole('button', { name: 'View Markdown source' }))
    const box = await surface(canvasElement)
    await waitFor(() => expect(within(box).getByText('Hello').tagName).toBe('STRONG'))
    await expect(localStorage.getItem('ideaf:editor:markdown')).toBeNull()
  },
}

// The source view is as tall as its text, as the rich side is: nothing hidden behind a scroll, and it
// grows as lines are added
export const SourceFitsItsText: Story = {
  args: { value: comment },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await surface(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'View Markdown source' }))
    const source = canvas.getByRole<HTMLTextAreaElement>('textbox', { name: 'Comment' })
    await waitFor(() => expect(source.scrollHeight).toBeLessThanOrEqual(source.clientHeight))
    const before = source.clientHeight
    source.setSelectionRange(source.value.length, source.value.length)
    await userEvent.keyboard('{Enter}{Enter}One more line.')
    await waitFor(() => expect(source.clientHeight).toBeGreaterThan(before))
    await expect(source.scrollHeight).toBeLessThanOrEqual(source.clientHeight)
  },
}

// In the comments column: five buttons, then More with the rest and their keys
export const Narrow: Story = {
  args: { value: 'Is `sync-states.md` meant to list the **conflict** state too?', width: '22rem' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await surface(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Bold' })).toBeVisible()
    await expect(canvasElement.querySelector('[aria-label="Strikethrough"]')).not.toBeVisible()
    canvas.getByRole('button', { name: 'More formatting' }).focus()
    await userEvent.keyboard('{Enter}')
    const menu = await within(document.body).findByRole('menu')
    await expect(within(menu).getByRole('menuitem', { name: /Strikethrough/ })).toBeVisible()
    // Table under More asks the size too
    await userEvent.click(within(menu).getByRole('menuitem', { name: /Table/ }))
    const picker = await within(document.body).findByRole('dialog', { name: 'Insert a table' })
    await waitFor(() => expect(within(picker).getByRole('group', { name: 'Table size' })).toHaveFocus())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(within(document.body).queryByRole('dialog', { name: 'Insert a table' })).toBeNull())
  },
}

// A table: the button adds one; Tab moves between cells and adds a row after the last; the button then
// opens the table's menu
export const Table: Story = {
  args: { value: 'Before the table.' },
  // the table's being written: its last header is still empty, as it is until it's typed in
  parameters: { a11y: { config: { rules: [{ id: 'empty-table-header', enabled: false }] } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = await surface(canvasElement)
    await waitFor(() => expect(box).toHaveAttribute('contenteditable', 'true'))
    await userEvent.click(box)
    await settle()
    // the button asks the size: three by three to start, Enter takes it
    await userEvent.click(canvas.getByRole('button', { name: 'Table' }))
    const picker = await within(document.body).findByRole('dialog', { name: 'Insert a table' })
    await waitFor(() => expect(within(picker).getByRole('group', { name: 'Table size' })).toHaveFocus())
    await expect(picker).toHaveTextContent('3 columns, 3 rows')
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(box.querySelector('table')).not.toBeNull())
    await expect(box.querySelectorAll('tr')).toHaveLength(3)
    await settle()
    await typing.keyboard('Name')
    await typing.keyboard('{Tab}What')
    await waitFor(() => expect(markdown(canvasElement)).toContain('| Name | What |'))
    // on to the last cell, and Tab from there: a new row
    for (let i = 0; i < 8; i++) {
      await userEvent.keyboard('{Tab}')
    }
    await waitFor(() => expect(box.querySelectorAll('tr')).toHaveLength(4))
    // the caret's in the table: the button opens its menu
    canvas.getByRole('button', { name: 'Table: change it' }).focus()
    await userEvent.keyboard('{Enter}')
    const menu = await within(document.body).findByRole('menu')
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Column to the right' }))
    await waitFor(() => expect(box.querySelector('tr')!.children).toHaveLength(4))
    await expect(markdown(canvasElement)).toMatch(/^Before the table\.\n\n\| Name \|  \| What \|/)
  },
}

// The size by pointer: the grid lights up to the cell under it, and a click adds that table
export const TableSize: Story = {
  args: { value: '' },
  // the new table's headers are empty, as they are until they're typed in
  parameters: { a11y: { config: { rules: [{ id: 'empty-table-header', enabled: false }] } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = await surface(canvasElement)
    await userEvent.click(box)
    await settle()
    await userEvent.click(canvas.getByRole('button', { name: 'Table' }))
    const picker = await within(document.body).findByRole('dialog', { name: 'Insert a table' })
    // the fifth column of the fourth row: five columns, a header and three rows
    const cell = picker.querySelectorAll('.md-editor-table-cell')[3 * 8 + 4]!
    await userEvent.hover(cell)
    await expect(picker).toHaveTextContent('5 columns, 4 rows')
    await userEvent.click(cell)
    await waitFor(() => expect(box.querySelectorAll('tr')).toHaveLength(4))
    await expect(box.querySelector('tr')!.children).toHaveLength(5)
  },
}

// On the Markdown side the picker types the table's Markdown
export const TableInMarkdown: Story = {
  args: { value: 'Before.' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await surface(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'View Markdown source' }))
    const source = canvas.getByRole('textbox', { name: 'Comment' }) as HTMLTextAreaElement
    source.setSelectionRange(source.value.length, source.value.length)
    await userEvent.click(canvas.getByRole('button', { name: 'Table' }))
    const picker = await within(document.body).findByRole('dialog', { name: 'Insert a table' })
    await waitFor(() => expect(within(picker).getByRole('group', { name: 'Table size' })).toHaveFocus())
    await userEvent.keyboard('{ArrowLeft}{ArrowUp}{Enter}')
    await waitFor(() =>
      expect(markdown(canvasElement)).toBe('Before.\n\n| Column | Column |\n| --- | --- |\n|  |  |\n'),
    )
    await expect(canvas.getByRole('textbox', { name: 'Comment' })).toBe(source)
  },
}

// Enter on an empty last line of a code block leaves it, for a paragraph below
export const LeavingCode: Story = {
  play: async ({ canvasElement }) => {
    const box = await surface(canvasElement)
    await userEvent.click(box)
    await settle()
    await typing.keyboard('```ts ')
    await waitFor(() => expect(box.querySelector('pre')).not.toBeNull())
    await typing.keyboard('const a = 1{Enter}{Enter}after')
    await waitFor(() => expect(markdown(canvasElement)).toBe('```ts\nconst a = 1\n```\n\nafter'))
    await expect(box.querySelector('pre')).toHaveTextContent(/^const a = 1$/)
  },
}

// A comment written by an agent: a table, a code block and raw HTML. It opens with the HTML drawn as
// the page draws it, read only, and nothing's rewritten
export const FromAnAgent: Story = {
  args: {
    value: `Checked the three states against the sync code:

| State | In the code | Note |
|---|---|---|
| Waiting | \`pending\` | |
| Sent | \`acked\` | renamed in v2 |

\`\`\`ts
type SyncState = 'pending' | 'acked'
\`\`\`

<div align="center"><b>All three match.</b><script>alert(1)</script></div>

<details><summary>Raw log</summary>

Sent 3, acked 3.

</details>`,
  },
  play: async ({ args, canvasElement }) => {
    const box = await surface(canvasElement)
    await waitFor(() => expect(box.querySelector('table')).not.toBeNull())
    await expect(box.querySelector('pre code')).toHaveTextContent("type SyncState = 'pending' | 'acked'")
    // the HTML drawn, never run, each piece marked read only
    await expect(box.querySelector('script')).toBeNull()
    await expect(within(box).getByText('All three match.').tagName).toBe('B')
    const marks = within(box).getAllByRole('img', { name: 'HTML blocks are only editable in source view' })
    await expect(marks).toHaveLength(2)
    // the details, with the Markdown inside it, and none of it typed in
    const details = box.querySelector('details')!
    await expect(details.closest('[contenteditable="false"]')).not.toBeNull()
    await expect(details.querySelector('[contenteditable="true"]')).toBeNull()
    await expect(details).toHaveTextContent('Sent 3, acked 3.')
    await expect(args.onChange).not.toHaveBeenCalled()
  },
}

// A run of HTML is one read-only unit: Delete with it selected takes the whole of it out
export const DeletingHtml: Story = {
  args: { value: 'Before.\n\n<details><summary>Notes</summary>\n\nA note.\n\n</details>\n\nAfter.' },
  play: async ({ canvasElement }) => {
    const box = await surface(canvasElement)
    const after = await waitFor(() => within(box).getByText('After.'))
    // the caret at the start of "After.", then Backspace selects the HTML before it, and again deletes it
    box.focus()
    const start = document.createRange()
    start.setStart(after.firstChild!, 0)
    start.collapse(true)
    getSelection()!.removeAllRanges()
    getSelection()!.addRange(start)
    await settle()
    await typing.keyboard('{Backspace}')
    await waitFor(() => expect(box.querySelector('.ProseMirror-selectednode')).not.toBeNull())
    // selected whole: no caret blinking at the end of the block before
    await expect(getComputedStyle(box).caretColor).toBe('rgba(0, 0, 0, 0)')
    // nothing in the toolbar applies to it, and the tooltip says why
    const bold = within(canvasElement).getByRole('button', { name: 'Bold' })
    await expect(bold).toHaveAttribute('aria-disabled', 'true')
    await expect(bold).toHaveAttribute('title', 'Bold: HTML blocks are only editable in source view')
    // typing doesn't replace it
    await typing.keyboard('x')
    await expect(markdown(canvasElement)).toBe(
      'Before.\n\n<details><summary>Notes</summary>\n\nA note.\n\n</details>\n\nAfter.',
    )
    await typing.keyboard('{Backspace}')
    await waitFor(() => expect(markdown(canvasElement)).toBe('Before.\n\nAfter.'))
  },
}

// Put the caret at the end of an element's text
async function caretAtEnd(box: HTMLElement, element: Element) {
  box.focus()
  const end = document.createRange()
  end.selectNodeContents(element)
  end.collapse(false)
  getSelection()!.removeAllRanges()
  getSelection()!.addRange(end)
  await settle()
}

// In a code block: plain text, so only a quote can go around it
export const InACodeBlock: Story = {
  args: { value: '```\nconst a = 1\n```' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = await surface(canvasElement)
    await caretAtEnd(box, await waitFor(() => box.querySelector('pre code')!))
    const bold = canvas.getByRole('button', { name: 'Bold' })
    await waitFor(() => expect(bold).toHaveAttribute('aria-disabled', 'true'))
    await expect(bold).toHaveAttribute('title', 'Bold: not in a code block')
    for (const name of ['Italic', 'Strikethrough', 'Heading', 'Code', 'Link', 'Table']) {
      await expect(canvas.getByRole('button', { name })).toHaveAttribute('aria-disabled', 'true')
    }
    for (const name of ['Bulleted list', 'Numbered list', 'Task list']) {
      await expect(canvas.getByRole('button', { name })).toHaveAttribute('aria-disabled', 'true')
    }
    // a quote can go around it, nothing else
    await expect(canvas.getByRole('button', { name: 'Quote' })).not.toHaveAttribute('aria-disabled')
    // pressing it, or its keys, does nothing
    await userEvent.click(bold)
    await typing.keyboard('{Control>}b{/Control}x')
    await waitFor(() => expect(markdown(canvasElement)).toBe('```\nconst a = 1x\n```'))
  },
}

// Headings and lists don't mix: no list in a heading, no heading in a list, by button or by typing
export const HeadingsAndLists: Story = {
  args: { value: '## A heading\n\n- an item' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = await surface(canvasElement)
    await caretAtEnd(box, await waitFor(() => box.querySelector('h2')!))
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Bulleted list' })).toHaveAttribute('aria-disabled', 'true'),
    )
    await expect(canvas.getByRole('button', { name: 'Bulleted list' })).toHaveAttribute(
      'title',
      'Bulleted list: not in a heading',
    )
    await caretAtEnd(box, box.querySelector('li')!)
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Heading' })).toHaveAttribute('aria-disabled', 'true'),
    )
    await expect(canvas.getByRole('button', { name: 'Heading' })).toHaveAttribute('title', 'Heading: not in a list')
    // "# " typed in a new item stays text
    await typing.keyboard('{Enter}# not a heading')
    await waitFor(() => expect(markdown(canvasElement)).toBe('## A heading\n\n- an item\n- \\# not a heading'))
    await expect(box.querySelector('li h1')).toBeNull()
  },
}

// In a table cell: marks and links, no blocks
export const InATable: Story = {
  args: { value: '| Name | What |\n| --- | --- |\n| a | b |' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = await surface(canvasElement)
    await caretAtEnd(box, await waitFor(() => box.querySelector('td')!))
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Heading' })).toHaveAttribute('aria-disabled', 'true'),
    )
    await expect(canvas.getByRole('button', { name: 'Heading' })).toHaveAttribute('title', 'Heading: not in a table')
    await expect(canvas.getByRole('button', { name: 'Bulleted list' })).toHaveAttribute('aria-disabled', 'true')
    await expect(canvas.getByRole('button', { name: 'Bold' })).not.toHaveAttribute('aria-disabled')
  },
}

// Heading: a menu of levels, the current one checked; and on the Markdown side, its #s
export const Headings: Story = {
  args: { value: 'A title' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = await surface(canvasElement)
    await caretAtEnd(box, await waitFor(() => box.querySelector('p')!))
    canvas.getByRole('button', { name: 'Heading' }).focus()
    await userEvent.keyboard('{Enter}')
    let menu = await within(document.body).findByRole('menu')
    await expect(within(menu).getAllByRole('menuitem')).toHaveLength(7)
    await userEvent.click(within(menu).getByRole('menuitem', { name: /^Heading 2/ }))
    await waitFor(() => expect(markdown(canvasElement)).toBe('## A title'))
    canvas.getByRole('button', { name: 'Heading' }).focus()
    await userEvent.keyboard('{Enter}')
    menu = await within(document.body).findByRole('menu')
    await expect(within(menu).getByRole('menuitem', { name: /^Heading 2 \(now\)/ })).toBeVisible()
    await userEvent.click(within(menu).getByRole('menuitem', { name: /^Normal text/ }))
    await waitFor(() => expect(markdown(canvasElement)).toBe('A title'))
    // the Markdown side
    await userEvent.click(canvas.getByRole('button', { name: 'View Markdown source' }))
    const source = canvas.getByRole('textbox', { name: 'Comment' }) as HTMLTextAreaElement
    source.setSelectionRange(0, 0)
    canvas.getByRole('button', { name: 'Heading' }).focus()
    await userEvent.keyboard('{Enter}')
    menu = await within(document.body).findByRole('menu')
    await userEvent.click(within(menu).getByRole('menuitem', { name: /^Heading 3/ }))
    await waitFor(() => expect(source).toHaveValue('### A title'))
  },
}

// The link box: its text and its address. The text starts as what's selected, and is the address when
// it's left empty
export const LinkText: Story = {
  args: { value: 'Read more.' },
  play: async ({ canvasElement }) => {
    const box = await surface(canvasElement)
    await caretAtEnd(box, await waitFor(() => box.querySelector('p')!))
    // nothing selected: the text is empty, and the address stands for it
    await userEvent.keyboard('{Control>}k{/Control}')
    let address = await within(document.body).findByRole('textbox', { name: 'Link address' })
    await expect(within(document.body).getByRole('textbox', { name: 'Text' })).toHaveValue('')
    await waitFor(() => expect(address).toHaveFocus())
    await userEvent.type(address, 'https://example.com/a{Enter}')
    await waitFor(() =>
      expect(markdown(canvasElement)).toMatch(
        /^Read more\.(?:<https:\/\/example\.com\/a>|\[https:\/\/example\.com\/a\]\(https:\/\/example\.com\/a\))$/,
      ),
    )
    // in the link: its text and address, and new text replaces the old
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}')
    await settle()
    await userEvent.keyboard('{Control>}k{/Control}')
    address = await within(document.body).findByRole('textbox', { name: 'Link address' })
    const text = within(document.body).getByRole('textbox', { name: 'Text' })
    await expect(address).toHaveValue('https://example.com/a')
    await expect(text).toHaveValue('https://example.com/a')
    await userEvent.clear(text)
    await userEvent.type(text, 'the notice{Enter}')
    await waitFor(() => expect(markdown(canvasElement)).toBe('Read more.[the notice](https://example.com/a)'))
  },
}

// On the Markdown side the link box types the link's Markdown
export const LinkInMarkdown: Story = {
  args: { value: 'See the notice.' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await surface(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'View Markdown source' }))
    const source = canvas.getByRole('textbox', { name: 'Comment' }) as HTMLTextAreaElement
    source.setSelectionRange(8, 14)
    await userEvent.click(canvas.getByRole('button', { name: 'Link' }))
    const address = await within(document.body).findByRole('textbox', { name: 'Link address' })
    await expect(within(document.body).getByRole('textbox', { name: 'Text' })).toHaveValue('notice')
    await waitFor(() => expect(address).toHaveFocus())
    await userEvent.type(address, 'https://example.com/notice{Enter}')
    await waitFor(() => expect(source).toHaveValue('See the [notice](https://example.com/notice).'))
  },
}

// With focus in the link box, the text the link goes on stays marked
export const LinkKeepsSelection: Story = {
  args: { value: 'See the notice.' },
  play: async ({ canvasElement }) => {
    const box = await surface(canvasElement)
    const text = (await waitFor(() => within(box).getByText('See the notice.'))).firstChild!
    const range = document.createRange()
    range.setStart(text, 8)
    range.setEnd(text, 14)
    box.focus()
    getSelection()!.removeAllRanges()
    getSelection()!.addRange(range)
    await settle()
    await userEvent.keyboard('{Control>}k{/Control}')
    const address = await within(document.body).findByRole('textbox', { name: 'Link address' })
    await waitFor(() => expect(address).toHaveFocus())
    await expect(held()).toEqual(['notice'])
    await userEvent.keyboard('{Escape}')
    // back in the text: the browser's own selection again, the mark gone
    await waitFor(() => expect(box).toHaveFocus())
    await expect(held()).toEqual([])
  },
}

// what's marked as held, from the editor's highlight
const held = () => [...(CSS.highlights.get('md-editor-held') ?? [])].map((range) => String(range))

// Pressing the Link icon leaves the selection as it is. Focus goes to the button on the press, and the
// browser still paints the selection: marking it held must not touch the text under it, or the
// selection's ends slide out to the paragraph's (a flash before the link box opens)
export const LinkPressKeepsSelection: Story = {
  args: { value: comment },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = await surface(canvasElement)
    const item = await waitFor(() => box.querySelector('li p')!)
    // "ay how many cha": from plain text, over the bold, into plain text again
    const [before, , after] = [...item.childNodes]
    const range = document.createRange()
    range.setStart(before!, 'The banner should s'.length)
    range.setEnd(after!.firstChild ?? after!, ' cha'.length)
    box.focus()
    getSelection()!.removeAllRanges()
    getSelection()!.addRange(range)
    await settle()
    await expect(getSelection()!.toString()).toBe('ay how many cha')
    const link = canvas.getByRole('button', { name: /^Link/ })
    // one pointer, pressed then let go: a click
    const mouse = userEvent.setup()
    await mouse.pointer({ keys: '[MouseLeft>]', target: link })
    await waitFor(() => expect(held()).toEqual(['ay how many cha']))
    await expect(getSelection()!.toString()).toBe('ay how many cha')
    await mouse.pointer({ keys: '[/MouseLeft]', target: link })
    const text = await within(document.body).findByRole('textbox', { name: 'Text' })
    await expect(text).toHaveValue('ay how many cha')
    await expect(held()).toEqual(['ay how many cha'])
  },
}

// In a menu, the caret's place stays marked: a drawn caret where it was, gone once back in the text
export const CaretMarkedInMenus: Story = {
  args: { value: 'A title' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = await surface(canvasElement)
    await caretAtEnd(box, await waitFor(() => box.querySelector('p')!))
    await expect(box.querySelector('.md-editor-held-caret')).toBeNull()
    canvas.getByRole('button', { name: 'Heading' }).focus()
    await waitFor(() => expect(box.querySelector('.md-editor-held-caret')).not.toBeNull())
    await userEvent.keyboard('{Enter}')
    await within(document.body).findByRole('menu')
    await expect(box.querySelector('.md-editor-held-caret')).not.toBeNull()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(box)
    // back in the text: the browser's own caret again, the drawn one hidden (and gone with the next move)
    await waitFor(() => {
      const caret = box.querySelector('.md-editor-held-caret')
      expect(caret === null || getComputedStyle(caret).display === 'none').toBe(true)
    })
  },
}

// A press elsewhere closes the link box and focus stays where it went (pulling it back to the text would
// undo a press placing the caret); Escape closes it and puts focus back in the text
export const LinkBoxLetsFocusGo: Story = {
  args: { value: 'See the notice.' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = await surface(canvasElement)
    await caretAtEnd(box, await waitFor(() => box.querySelector('p')!))
    await userEvent.keyboard('{Control>}k{/Control}')
    await waitFor(() => expect(within(document.body).getByRole('textbox', { name: 'Link address' })).toHaveFocus())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(box).toHaveFocus())
    await userEvent.keyboard('{Control>}k{/Control}')
    await waitFor(() => expect(within(document.body).getByRole('textbox', { name: 'Link address' })).toHaveFocus())
    const comment = canvas.getByRole('button', { name: /^Comment$/ })
    await userEvent.click(comment)
    await waitFor(() => expect(within(document.body).queryByRole('textbox', { name: 'Link address' })).toBeNull())
    await new Promise((resolve) => setTimeout(resolve, 100))
    await expect(comment).toHaveFocus()
  },
}

const rightClick = (target: Element) => userEvent.pointer({ keys: '[MouseRight]', target })

// A right click in a table: the table's menu, acting on the cell clicked
export const TableMenuOnRightClick: Story = {
  args: { value: '| Name | What |\n| --- | --- |\n| a | b |' },
  play: async ({ canvasElement }) => {
    const box = await surface(canvasElement)
    // on the header row: nothing goes above it, and it's not deleted on its own
    await rightClick(await waitFor(() => box.querySelector('th')!))
    const header = await within(document.body).findByRole('menu', { name: 'Editing' })
    await expect(within(header).getByRole('menuitem', { name: 'Row above' })).toHaveAttribute('aria-disabled', 'true')
    await expect(within(header).getByRole('menuitem', { name: 'Row' })).toHaveAttribute('aria-disabled', 'true')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(within(document.body).queryByRole('menu', { name: 'Editing' })).toBeNull())
    const cell = box.querySelectorAll('td')[1]!
    await rightClick(cell)
    const menu = await within(document.body).findByRole('menu', { name: 'Editing' })
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Row below' }))
    await waitFor(() => expect(box.querySelectorAll('tr')).toHaveLength(3))
    await rightClick(box.querySelectorAll('td')[1]!)
    await userEvent.click(
      within(await within(document.body).findByRole('menu', { name: 'Editing' })).getByRole('menuitem', {
        name: 'Column',
      }),
    )
    await waitFor(() => expect(box.querySelector('tr')!.children).toHaveLength(1))
  },
}

// A right click on a link: edit, open or remove it
export const LinkMenuOnRightClick: Story = {
  args: { value: 'See [the notice](https://example.com/notice).' },
  play: async ({ canvasElement }) => {
    const box = await surface(canvasElement)
    const link = await waitFor(() => within(box).getByRole('link', { name: 'the notice' }))
    await rightClick(link)
    const menu = await within(document.body).findByRole('menu', { name: 'Editing' })
    await expect(within(menu).getByRole('menuitem', { name: 'Open link' })).toBeVisible()
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Remove link' }))
    await waitFor(() => expect(markdown(canvasElement)).toBe('See the notice.'))
  },
}

// A right click on drawn HTML: the way to change it; and on plain text, the browser's own menu
export const HtmlMenuOnRightClick: Story = {
  args: { value: 'Some text.\n\n<div align="center"><b>Centered</b></div>' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = await surface(canvasElement)
    // plain text: not the editor's to take
    const text = await waitFor(() => within(box).getByText('Some text.'))
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 })
    await expect(text.dispatchEvent(event)).toBe(true)
    await rightClick(within(box).getByText('Centered'))
    const menu = await within(document.body).findByRole('menu', { name: 'Editing' })
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Edit in source view' }))
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'Comment' }).tagName).toBe('TEXTAREA'))
  },
}

// A suggested edit's replacement: marks and links only, no blocks; Enter makes no new paragraph
export const Inline: Story = {
  args: {
    value: '- not a list here',
    flavor: 'inline',
    label: 'Comment',
    placeholder: 'Replace with…',
    footer: null,
    width: '24rem',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = await surface(canvasElement)
    await waitFor(() => expect(box).toHaveAttribute('contenteditable', 'true'))
    await expect(box.querySelector('ul')).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Heading' })).toBeNull()
    await expect(canvas.getByRole('button', { name: 'Link' })).toBeVisible()
    // the caret at the end (user-event's End key can't place it in rich text)
    box.focus()
    const end = document.createRange()
    end.selectNodeContents(box.querySelector('p')!)
    end.collapse(false)
    getSelection()!.removeAllRanges()
    getSelection()!.addRange(end)
    await settle()
    await typing.keyboard('{Enter} more')
    await waitFor(() => expect(markdown(canvasElement)).toMatch(/more$/))
    await expect(box.querySelectorAll('p')).toHaveLength(1)
  },
}

// A link: ⌘K opens the box for its address
export const Link: Story = {
  args: { value: 'See the notice.' },
  play: async ({ canvasElement }) => {
    const box = await surface(canvasElement)
    await waitFor(() => expect(box).toHaveAttribute('contenteditable', 'true'))
    const text = within(box).getByText('See the notice.').firstChild!
    const range = document.createRange()
    range.setStart(text, 8)
    range.setEnd(text, 14)
    box.focus()
    getSelection()!.removeAllRanges()
    getSelection()!.addRange(range)
    await settle()
    await userEvent.keyboard('{Control>}k{/Control}')
    const address = await within(document.body).findByRole('textbox', { name: 'Link address' })
    await waitFor(() => expect(address).toHaveFocus())
    await userEvent.type(address, 'https://example.com/notice{Enter}')
    await waitFor(() => expect(markdown(canvasElement)).toBe('See the [notice](https://example.com/notice).'))
  },
}

// a page slower than the typing: each value comes back a moment after the editor gave it, and it can
// clear the box itself, as a page does once a comment's sent
function SlowPage() {
  const [value, setValue] = useState('')
  return (
    <div style={{ maxWidth: '30rem' }}>
      <MarkdownEditor
        label="Comment"
        value={value}
        onChange={(next) => setTimeout(() => setValue(next), 40)}
        footer={<Button onClick={() => setValue('')}>Send</Button>}
      />
      <output data-testid="markdown">{value}</output>
    </div>
  )
}

// Typing that runs ahead of the page keeps every key: an older value coming back late isn't opened
// over what's been typed since. A value the page sets itself still is
export const PageBehind: Story = {
  render: () => <SlowPage />,
  play: async ({ canvasElement }) => {
    const box = await surface(canvasElement)
    await userEvent.click(box)
    await userEvent.setup({ delay: 5 }).keyboard('Half a thought')
    await waitFor(() => expect(markdown(canvasElement)).toBe('Half a thought'))
    await expect(box).toHaveTextContent('Half a thought')
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(box).toHaveTextContent(''))
  },
}
