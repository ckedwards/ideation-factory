// The collab module as the page editor uses it (collab.ts): two editors and an authority in memory,
// each editor's steps sent on the count it last saw, refused when behind, and replayed on what it missed.
import { describe, expect, test } from 'bun:test'
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import { Step } from '@milkdown/kit/prose/transform'
import { collab, getVersion, receiveTransaction, sendableSteps } from './collab.ts'
import { type Node, pageDocument } from './model.ts'

async function setup(source: string) {
  const { schema, doc } = await pageDocument(source, ['b1', 'b2'])
  const authority = { doc, steps: [] as Array<{ step: unknown; client: string }> }
  const editor = (client: string) => {
    let state = EditorState.create({ doc, plugins: [collab({ version: 0, clientID: client })] })
    return {
      get state() {
        return state
      },
      text: () => state.doc.textContent,
      /** Types at a position, as a keystroke does: one step. */
      type(at: number, text: string) {
        const tr = state.tr.insertText(text, at)
        state = state.apply(tr.setSelection(TextSelection.create(tr.doc, at + text.length)))
      },
      /** Sends what's unconfirmed: taken if it's on the latest count. */
      send(): boolean {
        const sendable = sendableSteps(state)
        if (!sendable) {
          return true
        }
        if (sendable.version !== authority.steps.length) {
          return false
        }
        for (const step of sendable.steps) {
          const result = step.apply(authority.doc)
          authority.doc = result.doc!
          authority.steps.push({ step: step.toJSON(), client })
        }
        return true
      },
      /** Takes in what the authority has that this doesn't. */
      pull() {
        const from = getVersion(state)
        const missed = authority.steps.slice(from)
        state = state.apply(
          receiveTransaction(
            state,
            missed.map((s) => Step.fromJSON(schema, s.step)),
            missed.map((s) => s.client),
            { mapSelectionBackward: true },
          ),
        )
      },
    }
  }
  return { authority, editor, text: (doc: Node) => doc.textContent }
}

describe('the page editor’s collab module', () => {
  test('two people typing at the very same spot keep their words whole', async () => {
    const { authority, editor, text } = await setup('One two.\n\nThree.\n')
    const ana = editor('ana')
    const raj = editor('raj')
    // both carets after "One "
    const at = 1 + 'One '.length
    // Raj's first letter reaches the authority first
    raj.type(at, 'R')
    expect(raj.send()).toBe(true)
    ana.pull()
    // Ana's caret is after Raj's letter, where Raj is typing on: she types there meanwhile, as he
    // does, neither having seen the other's yet
    ana.type(at + 1, 'A')
    ana.type(at + 2, 'A')
    ana.type(at + 3, 'A')
    raj.type(at + 1, 'R')
    raj.type(at + 2, 'R')
    // Ana's go first; Raj is behind, takes them, replays his own and sends again
    expect(ana.send()).toBe(true)
    expect(raj.send()).toBe(false)
    raj.pull()
    expect(raj.send()).toBe(true)
    ana.pull()
    raj.pull()
    const result = text(authority.doc)
    expect(ana.text()).toBe(result)
    expect(raj.text()).toBe(result)
    // Raj's three letters together, not split by Ana's
    expect(result).toContain('RRR')
    expect(result).toContain('AAA')
  })

  test('typing in different paragraphs merges, the same for everyone', async () => {
    const { authority, editor, text } = await setup('One two.\n\nThree.\n')
    const ana = editor('ana')
    const raj = editor('raj')
    ana.type(1, 'Ana: ')
    const second = ana.state.doc.child(0).nodeSize + 1
    raj.type(raj.state.doc.child(0).nodeSize + 1, 'Raj: ')
    expect(ana.send()).toBe(true)
    expect(raj.send()).toBe(false)
    raj.pull()
    expect(raj.send()).toBe(true)
    ana.pull()
    expect(text(authority.doc)).toBe('Ana: One two.Raj: Three.')
    expect(ana.text()).toBe(text(authority.doc))
    expect(raj.text()).toBe(text(authority.doc))
    expect(second).toBeGreaterThan(1)
  })
})
