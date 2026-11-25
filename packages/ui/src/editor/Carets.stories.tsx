import { useEffect, useRef } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { EditorState } from '@milkdown/kit/prose/state'
import { EditorView } from '@milkdown/kit/prose/view'
import { expect, waitFor } from 'storybook/test'
import { carets, setCaret } from './carets.ts'
import { pageDocument } from './model.ts'
import './MarkdownEditor.css'

const SOURCE = '# Handover\n\nYou hand over on Monday morning.\n'

// Another window's caret in a live draft (carets.ts), drawn into the text where it is: here in the
// middle of a word, as it often is while someone types.
function Carets({ at }: { at: number }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let view: EditorView | null = null
    let gone = false
    void pageDocument(SOURCE, []).then(({ doc }) => {
      if (gone || !host.current) {
        return
      }
      view = new EditorView(host.current, { state: EditorState.create({ doc, plugins: [carets(() => {})] }) })
      view.dispatch(setCaret(view.state.tr, { id: 'w-1', name: 'Priya Natarajan', color: 3, anchor: at, head: at }))
    })
    return () => {
      gone = true
      view?.destroy()
    }
  }, [at])
  return <div ref={host} className="md-editor-page" style={{ padding: '2rem 1rem', maxWidth: '32rem' }} />
}

const meta = {
  title: 'Editor/Carets',
  component: Carets,
  // between "ha" and "nd" of "hand": the heading is 0 to 10, the paragraph's text starts at 11
  args: { at: 11 + 'You ha'.length },
} satisfies Meta<typeof Carets>

export default meta
type Story = StoryObj<typeof meta>

// The name is on the flag, but not in the text: the word the caret stands in is still one word, so
// the browser's spellchecker doesn't mark its halves ("ha", "nd") as misspelled
export const InAWord: Story = {
  play: async ({ canvasElement }) => {
    const paragraph = await waitFor(() => {
      const p = canvasElement.querySelector('p')
      expect(p?.querySelector('.live-caret')).toBeTruthy()
      return p!
    })
    await expect(paragraph.textContent).toBe('You hand over on Monday morning.')
    const flag = paragraph.querySelector('.live-flag')!
    await expect(getComputedStyle(flag, '::before').content).toBe('"Priya Natarajan"')
    // the flag in the space between the lines: dropped into the top of the caret's box, above the
    // line's capitals, not standing on top of it over the line above
    const caret = paragraph.querySelector('.live-caret')!.getBoundingClientRect()
    const box = flag.getBoundingClientRect()
    const size = parseFloat(getComputedStyle(paragraph).fontSize)
    await expect(box.bottom - caret.top).toBeCloseTo(0.38 * size, 0)
    // the word from "ha", as the browser finds words (and checks their spelling)
    const selection = getSelection()!
    selection.collapse(paragraph.firstChild, 'You '.length)
    selection.modify('extend', 'forward', 'word')
    await expect(selection.toString()).toBe('hand')
  },
}
