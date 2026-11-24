// The live document (live.ts): its status as a page hears it, and other windows' carets drawn where they are.
import { describe, expect, test } from 'bun:test'
import { EditorState, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { caretsOf } from './carets.ts'
import { type LiveCaret, LiveDoc, type LiveStatus } from './live.ts'
import { type Node, pageDocument } from './model.ts'

test('opened again after a long gap, the page is told it’s saved', async () => {
  const { doc } = await pageDocument('# Plan\n\nShip it.\n', ['b1', 'b2'])
  const live = new LiveDoc({ doc: doc.toJSON(), version: 3 }, { send: () => {}, since: () => {} })
  const heard: LiveStatus[] = []
  live.subscribe((status) => heard.push(status))
  live.gone()
  live.reset({ doc: doc.toJSON(), version: 40 })
  expect(heard).toEqual(['gone', 'saved'])
  expect(live.status()).toBe('saved')
  expect(live.version()).toBe(40)
})

describe('carets', () => {
  /** An editor view as LiveDoc uses one: its state, dispatching and replacing it (no DOM). */
  function view(doc: Node): EditorView {
    const v = {
      state: EditorState.create({ doc }),
      dispatch: (tr: Transaction) => {
        v.state = v.state.apply(tr)
      },
      updateState: (state: EditorState) => {
        v.state = state
      },
      hasFocus: () => false,
    }
    return v as unknown as EditorView
  }

  /** Two windows on one file and the actor between them, in memory: steps go when `deliver` is called. */
  async function setup() {
    const { doc } = await pageDocument('# Plan\n\nShip it now.\n', ['b1', 'b2'])
    const authority = { steps: [] as unknown[], clients: [] as string[], doc }
    const windows: Array<{ live: LiveDoc; view: EditorView; outbox: Array<() => void> }> = []
    const sentCarets: LiveCaret[] = []
    const open = (name: string) => {
      const outbox: Array<() => void> = []
      const live = new LiveDoc(
        { doc: doc.toJSON(), version: 0 },
        {
          send: (version, steps) =>
            outbox.push(() => {
              if (version !== authority.steps.length) {
                live.behind(authority.steps.length)
                return
              }
              const from = authority.steps.length
              authority.steps.push(...steps)
              authority.clients.push(...steps.map(() => name))
              for (const w of windows) {
                w.live.receive(
                  from,
                  steps,
                  steps.map(() => name),
                )
              }
            }),
          since: (version) =>
            outbox.push(() => live.receive(version, authority.steps.slice(version), authority.clients.slice(version))),
          here: (caret) => sentCarets.push(caret),
        },
        name,
      )
      const v = view(doc)
      live.attach(v, { replace: () => {} })
      const w = { live, view: v, outbox }
      windows.push(w)
      return w
    }
    const deliver = (w: { outbox: Array<() => void> }) => {
      while (w.outbox.length > 0) {
        w.outbox.shift()!()
      }
    }
    const type = (w: { live: LiveDoc; view: EditorView }, at: number, text: string) => {
      w.view.dispatch(w.view.state.tr.insertText(text, at))
      w.live.changed()
    }
    return { open, deliver, type, sentCarets }
  }
  const textOf = (v: EditorView) => v.state.doc.child(1).textContent
  // "Ship it now." is the paragraph after the heading (6): its text starts at 7
  const SHIP = 7

  test('a caret sent on an older count is brought through the steps since', async () => {
    const { open, deliver, type } = await setup()
    const ana = open('ana')
    const raj = open('raj')
    // Raj types before where Ana's caret is, and it's stored; Ana's caret was sent on count 0
    type(raj, SHIP, 'We ')
    deliver(raj)
    expect(textOf(ana.view)).toBe('We Ship it now.')
    ana.live.presence('w-raj', { name: 'Raj', color: 2, anchor: SHIP + 5, head: SHIP + 7, version: 0 })
    const [caret] = caretsOf(ana.view.state)
    // still on "it", three letters further on
    expect(ana.view.state.doc.textBetween(caret!.anchor, caret!.head)).toBe('it')
    expect(caret).toMatchObject({ id: 'w-raj', name: 'Raj', color: 2 })
  })

  test('typing here, not yet confirmed, moves the carets drawn here, and is taken out of the caret sent', async () => {
    const { open, deliver, type, sentCarets } = await setup()
    const ana = open('ana')
    open('raj')
    ana.live.presence('w-raj', { name: 'Raj', color: 2, anchor: SHIP + 5, head: SHIP + 5, version: 0 })
    // Ana types at the start: unconfirmed, but Raj's caret moves along with the text here
    type(ana, SHIP, 'So ')
    expect(caretsOf(ana.view.state)[0]!.head).toBe(SHIP + 8)
    // her own caret, after "So ", is sent on count 0: where "So " isn't yet
    ana.view.dispatch(ana.view.state.tr.setSelection(TextSelection.create(ana.view.state.doc, SHIP + 3)))
    expect(ana.live.caret()).toEqual({ anchor: SHIP, head: SHIP, version: 0 })
    deliver(ana)
    expect(ana.live.caret()).toEqual({ anchor: SHIP + 3, head: SHIP + 3, version: 1 })
    expect(sentCarets).toEqual([])
  })

  test('a caret sent on a count not reached here yet waits for the steps', async () => {
    const { open, deliver, type } = await setup()
    const ana = open('ana')
    const raj = open('raj')
    type(raj, SHIP, 'We ')
    // Raj's caret, on count 1, comes before his step does
    ana.live.presence('w-raj', { name: 'Raj', color: 2, anchor: SHIP + 3, head: SHIP + 3, version: 1 })
    expect(caretsOf(ana.view.state)).toEqual([])
    deliver(raj)
    expect(caretsOf(ana.view.state)).toMatchObject([{ id: 'w-raj', head: SHIP + 3 }])
    // and gone when the window leaves the file
    ana.live.presence('w-raj', null)
    expect(caretsOf(ana.view.state)).toEqual([])
  })
})
