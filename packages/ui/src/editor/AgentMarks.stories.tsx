import { useEffect, useRef } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { EditorState } from '@milkdown/kit/prose/state'
import { EditorView } from '@milkdown/kit/prose/view'
import { expect, waitFor, within } from 'storybook/test'
import { Button } from '../controls/Button.tsx'
import { AGENT_FADE_MS, AGENT_MARK_MS, agentMarks, markAgentEdits } from './agent-marks.ts'
import { pageDocument } from './model.ts'
import './MarkdownEditor.css'

const SOURCE = '# Handover\n\nYou hand over on Monday morning. Bring the list of open jobs.\n'
const NAME = 'Claude for Tomás'

// An agent's edit in a live draft (agent-marks.ts): "Monday morning" becomes "Tuesday at nine", the
// new words underlined in violet dots with the agent's name above them, until the mark fades.
function AgentMarks({ holdMs, fadeMs }: { holdMs: number; fadeMs: number }) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  useEffect(() => {
    let gone = false
    void pageDocument(SOURCE, []).then(({ doc }) => {
      if (gone || !host.current) {
        return
      }
      view.current = new EditorView(host.current, {
        state: EditorState.create({ doc, plugins: [agentMarks(holdMs, fadeMs)] }),
      })
    })
    return () => {
      gone = true
      view.current?.destroy()
    }
  }, [holdMs, fadeMs])
  const edit = () => {
    const v = view.current
    const text = v?.state.doc.child(1).textContent ?? ''
    const at = text.indexOf('Monday morning')
    if (!v || at < 0) {
      return
    }
    // the heading is 0 to 10, the paragraph's text starts at 11
    const from = 11 + at
    const tr = v.state.tr.insertText('Tuesday at nine', from, from + 'Monday morning'.length)
    v.dispatch(markAgentEdits(tr, [{ name: NAME, ranges: [{ from, to: from + 'Tuesday at nine'.length }] }]))
  }
  return (
    <div style={{ display: 'grid', gap: '1rem', padding: '1rem', maxWidth: '34rem' }}>
      <div>
        <Button size="sm" onClick={edit}>
          Let the agent edit
        </Button>
      </div>
      <div ref={host} className="md-editor-page" />
    </div>
  )
}

const meta = {
  title: 'Editor/Agent marks',
  component: AgentMarks,
  args: { holdMs: AGENT_MARK_MS, fadeMs: AGENT_FADE_MS },
} satisfies Meta<typeof AgentMarks>

export default meta
type Story = StoryObj<typeof meta>

async function agentEdits(canvasElement: HTMLElement, click: (element: Element) => Promise<void>) {
  await waitFor(() => expect(canvasElement.querySelector('.ProseMirror p')).not.toBeNull())
  await click(within(canvasElement).getByRole('button', { name: 'Let the agent edit' }))
  return waitFor(() => {
    const words = canvasElement.querySelector<HTMLElement>('.agent-edit')
    expect(words).not.toBeNull()
    return words!
  })
}

// Its new words underlined, its name on a flag above them, and screen readers told what it wrote
export const Marked: Story = {
  play: async ({ canvasElement, userEvent }) => {
    const words = await agentEdits(canvasElement, (e) => userEvent.click(e))
    await expect(words.textContent).toBe('Tuesday at nine')
    await expect(getComputedStyle(words).textDecorationStyle).toBe('dotted')
    const flag = canvasElement.querySelector<HTMLElement>('.agent-flag')!
    await expect(getComputedStyle(flag, '::before').content).toBe(`"${NAME}"`)
    // the flag in the space above the line, as a caret's is: it drops only into the top of the words'
    // box, above their capitals
    const size = parseFloat(getComputedStyle(words).fontSize)
    await expect(flag.getBoundingClientRect().bottom - words.getBoundingClientRect().top).toBeLessThanOrEqual(
      0.4 * size,
    )
    // what it took out isn't shown: the paragraph reads as it does now
    await expect(canvasElement.querySelector('.ProseMirror p')!.textContent).toBe(
      'You hand over on Tuesday at nine. Bring the list of open jobs.',
    )
    await waitFor(() =>
      expect(
        [...document.querySelectorAll('[role="status"]')].some(
          (s) => s.textContent === `${NAME} changed the draft: “Tuesday at nine”.`,
        ),
      ).toBe(true),
    )
  },
}

// Pointing at the words starts the clock again, so the mark stays while it's pointed at; then it fades
// and goes (here a short clock: 0.4 s, and a 0.2 s fade)
export const PointedAtThenFaded: Story = {
  args: { holdMs: 400, fadeMs: 200 },
  play: async ({ canvasElement, userEvent }) => {
    const words = await agentEdits(canvasElement, (e) => userEvent.click(e))
    await userEvent.hover(words)
    await new Promise((resolve) => setTimeout(resolve, 900))
    await expect(canvasElement.querySelector('.agent-edit.is-fading')).toBeNull()
    await expect(canvasElement.querySelector('.agent-edit')).not.toBeNull()
    await userEvent.unhover(words)
    await waitFor(() => expect(canvasElement.querySelector('.agent-edit')).toBeNull(), { timeout: 3000 })
    await expect(canvasElement.querySelector('.agent-flag')).toBeNull()
  },
}
