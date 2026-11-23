// One file of a live draft, as this browser has it (docs/handoff-live-editing.md, step 3): the
// document as the idea's actor last sent it, what's typed here and not confirmed yet, and the
// conversation with the actor through ProseMirror's collab module (collab.ts). The page editor
// attaches to it while it's drawn; without one (on the Markdown side, or before the editor has
// loaded) it carries on by itself, taking in other people's steps and sending what's left of ours.
//
// - **One send at a time,** on the count last seen. The actor takes it and sends it back to everyone
//   with whose it is, which is how it's confirmed here; or it's behind, and what was missed comes first.
// - **Saved means stored:** the actor sends steps back only once they're in its SQLite.
// - **A gap** (steps from further on than this has): it asks for what it missed.
// - **Offline,** typing carries on here; back online, it catches up and sends what's left.
import { Node } from '@milkdown/kit/prose/model'
import { EditorState, type Transaction } from '@milkdown/kit/prose/state'
import { Step } from '@milkdown/kit/prose/transform'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { MovedWords } from './identity.ts'
import {
  collab,
  confirmedDoc,
  getVersion,
  hasCollab,
  Rebaseable,
  receiveTransaction,
  sendableSteps,
  unconfirmedOf,
} from './collab.ts'

/** How a live document talks to the actor: the app's socket. */
export interface LiveTransport {
  /** Our steps, typed on `version` (the count of the actor's steps we had then). */
  send: (version: number, steps: unknown[], clientID: string) => void
  /** Everything after `version`: what we missed. */
  since: (version: number) => void
  /** Words seen cut from one block and pasted into another, so the draft counts them as moved. */
  moved?: (words: MovedWords) => void
}

/**
 * Where a live document is:
 * - `saved`: everything typed here is stored by the actor
 * - `saving`: something's on its way
 * - `offline`: the connection dropped; typing is kept here and sent once it's back
 * - `gone`: away too long for the actor to have what was missed; the page decides (step 8's fallback)
 * - `closed`: no longer editable here (edit access gone, or the page closed it)
 */
export type LiveStatus = 'saved' | 'saving' | 'offline' | 'gone' | 'closed'

/** The document as the actor sent it: its JSON, and the count of steps it's at. */
export interface LiveOpened {
  doc: unknown
  version: number
}

/** What the editor does for a live document it's attached to. */
export interface LiveHost {
  /** Shows `doc` in place of what's there, as a load: not typing, nothing to send, not in undo. */
  replace: (doc: Node) => void
}

export class LiveDoc {
  readonly clientID: string
  #transport: LiveTransport
  // the document before any editor has given it a schema: its JSON, and the steps since
  #json: unknown
  #jsonVersion: number
  #buffered: Array<{ steps: unknown[]; clientIDs: Array<string | number> }> = []
  // with an editor attached, its view; without one, the state it left
  #view: EditorView | null = null
  #host: LiveHost | null = null
  #bare: EditorState | null = null
  #inFlight = false
  // an editor being attached: its load isn't typing
  #attaching = false
  #online = true
  #status: LiveStatus = 'saved'
  #listeners = new Set<(status: LiveStatus) => void>()
  #settling: Array<(ok: boolean) => void> = []
  // words seen moved, waiting to go: sent once online, after what's typed
  #notes: MovedWords[] = []

  constructor(opened: LiveOpened, transport: LiveTransport, clientID?: string) {
    this.clientID = clientID ?? `c${Math.random().toString(36).slice(2, 10)}`
    this.#transport = transport
    this.#json = opened.doc
    this.#jsonVersion = opened.version
  }

  // ---- the state, wherever it is ----

  #state(): EditorState | null {
    if (this.#view && hasCollab(this.#view.state)) {
      return this.#view.state
    }
    return this.#bare
  }

  #dispatch(tr: Transaction) {
    if (this.#view && hasCollab(this.#view.state)) {
      this.#view.dispatch(tr)
    } else if (this.#bare) {
      this.#bare = this.#bare.apply(tr)
    }
  }

  /** The count of the actor's steps this has. */
  version(): number {
    const state = this.#state()
    if (state) {
      return getVersion(state)
    }
    return this.#jsonVersion + this.#buffered.reduce((n, b) => n + b.steps.length, 0)
  }

  /** How many steps typed here the actor hasn't confirmed. */
  pending(): number {
    const state = this.#state()
    return state ? unconfirmedOf(state).length : 0
  }

  /** The document now, with what's typed here; null before an editor has given it a schema. */
  doc(): Node | null {
    return this.#state()?.doc ?? null
  }

  /** The document as the actor last confirmed it, without what's typed here. */
  confirmed(): Node | null {
    const state = this.#state()
    return state ? confirmedDoc(state) : null
  }

  status(): LiveStatus {
    return this.#status
  }

  /** Called with each new status; returns the unsubscribe. */
  subscribe(listener: (status: LiveStatus) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #setStatus(status: LiveStatus) {
    if (status !== this.#status) {
      this.#status = status
      for (const listener of this.#listeners) {
        listener(status)
      }
    }
    if (status === 'saved' || status === 'gone' || status === 'closed') {
      const waiting = this.#settling
      this.#settling = []
      waiting.forEach((resolve) => resolve(status === 'saved'))
    }
  }

  #update() {
    if (this.#status === 'gone' || this.#status === 'closed') {
      return
    }
    if (!this.#online) {
      this.#setStatus('offline')
      return
    }
    this.#setStatus(this.pending() > 0 ? 'saving' : 'saved')
  }

  /** Resolves once everything typed here is stored (true), or it can't be for now (false: offline, gone, closed). */
  settle(): Promise<boolean> {
    if (this.#status === 'saved') {
      return Promise.resolve(true)
    }
    if (this.#status !== 'saving') {
      return Promise.resolve(false)
    }
    return new Promise((resolve) => {
      this.#settling.push(resolve)
    })
  }

  // ---- the editor ----

  /** The editor drawing this document: it shows the document, and its typing is sent from now on. */
  attach(view: EditorView, host: LiveHost): void {
    const schema = view.state.schema
    let doc: Node
    let version: number
    let unconfirmed: ReturnType<typeof unconfirmedOf> = []
    if (this.#bare) {
      // each editor makes its own schema: what the last one left is carried over to this one's
      const same = this.#bare.schema === schema
      const carried = (step: Step) => (same ? step : Step.fromJSON(schema, step.toJSON()))
      doc = same ? this.#bare.doc : Node.fromJSON(schema, this.#bare.doc.toJSON())
      version = getVersion(this.#bare)
      unconfirmed = unconfirmedOf(this.#bare).map((r) => new Rebaseable(carried(r.step), carried(r.inverted), null))
    } else {
      doc = Node.fromJSON(schema, this.#json)
      for (const batch of this.#buffered) {
        for (const json of batch.steps) {
          const result = Step.fromJSON(schema, json).apply(doc)
          if (!result.doc) {
            throw new Error(`a step from the draft doesn't apply: ${result.failed}`)
          }
          doc = result.doc
        }
      }
      version = this.version()
      this.#buffered = []
    }
    if (!view.state.doc.eq(doc)) {
      this.#attaching = true
      try {
        host.replace(doc)
      } finally {
        this.#attaching = false
      }
    }
    const plugins = view.state.plugins.filter((p) => !(p as unknown as { key: string }).key.startsWith('collab$'))
    view.updateState(
      view.state.reconfigure({ plugins: [...plugins, collab({ version, clientID: this.clientID, unconfirmed })] }),
    )
    this.#view = view
    this.#host = host
    this.#bare = null
    this.#inFlight = false
    this.#update()
    this.#send()
  }

  /** The editor's going: this carries on without it, from where it left off. */
  detach(view: EditorView): void {
    if (this.#view !== view) {
      return
    }
    const state = view.state
    if (hasCollab(state)) {
      this.#bare = EditorState.create({
        doc: state.doc,
        plugins: [collab({ version: getVersion(state), clientID: this.clientID, unconfirmed: unconfirmedOf(state) })],
      })
    }
    this.#view = null
    this.#host = null
  }

  /** Something was typed in the editor: send it, if nothing's on its way. */
  changed(): void {
    if (this.#attaching) {
      return
    }
    this.#update()
    this.#send()
  }

  // ---- the actor ----

  /** Words the editor saw cut from one block and pasted into another: sent, for the draft to count as moved. */
  moved(words: MovedWords): void {
    this.#notes.push(words)
    this.#send()
  }

  #send() {
    if (!this.#online || this.#status === 'gone' || this.#status === 'closed') {
      return
    }
    // the notes after the steps they're about: once nothing of ours is on its way
    if (!this.#inFlight && this.pending() === 0 && this.#notes.length > 0 && this.#transport.moved) {
      for (const words of this.#notes.splice(0)) {
        this.#transport.moved(words)
      }
    }
    if (this.#inFlight) {
      return
    }
    const state = this.#state()
    const sendable = state ? sendableSteps(state) : null
    if (!sendable) {
      return
    }
    this.#inFlight = true
    this.#transport.send(
      sendable.version,
      sendable.steps.map((s) => s.toJSON()),
      this.clientID,
    )
  }

  /** The actor's steps from count `from`, and whose each is: ours are confirmed, the rest applied. */
  receive(from: number, steps: unknown[], clientIDs: Array<string | number>): void {
    if (this.#status === 'gone' || this.#status === 'closed') {
      return
    }
    const version = this.version()
    if (from > version) {
      // a gap: what we missed first
      this.#transport.since(version)
      return
    }
    const skip = version - from
    const fresh = steps.slice(skip)
    const ids = clientIDs.slice(skip)
    if (fresh.length > 0) {
      const state = this.#state()
      if (!state) {
        this.#buffered.push({ steps: fresh, clientIDs: ids })
      } else {
        const schema = state.schema
        const before = unconfirmedOf(state).length
        this.#dispatch(
          receiveTransaction(
            state,
            fresh.map((s) => Step.fromJSON(schema, s)),
            ids,
            { mapSelectionBackward: true },
          ),
        )
        // ours were among them: the send is answered
        if (ids.includes(this.clientID) || unconfirmedOf(this.#state()!).length < before) {
          this.#inFlight = false
        }
      }
    }
    this.#update()
    this.#send()
  }

  /** Our send was behind the actor's count: what we missed arrives (or is asked for), then it goes again. */
  behind(version: number): void {
    this.#inFlight = false
    if (version > this.version()) {
      this.#transport.since(this.version())
    } else {
      this.#send()
    }
  }

  /** Our send was refused for another reason: it isn't sent again by itself (`problem` says why). */
  refused(): void {
    this.#inFlight = false
  }

  /** The connection dropped (false) or came back (true): back, it catches up and sends what's left. */
  online(on: boolean): void {
    this.#online = on
    this.#inFlight = false
    if (on && this.#status === 'offline') {
      this.#status = 'saving'
    }
    this.#update()
    if (on) {
      this.#transport.since(this.version())
    }
  }

  /** Away too long: the actor no longer has what was missed. What's typed here stays, unsent. */
  gone(): void {
    this.#inFlight = false
    this.#setStatus('gone')
  }

  /** No longer editable here: nothing more is sent or taken in. */
  close(): void {
    this.#inFlight = false
    this.#setStatus('closed')
  }

  /** Opened again from the actor's document as it is now, dropping anything unsent here. */
  reset(opened: LiveOpened): void {
    this.#inFlight = false
    this.#buffered = []
    this.#bare = null
    this.#json = opened.doc
    this.#jsonVersion = opened.version
    // told, so a page showing the gap shows it's over
    this.#setStatus('saved')
    const view = this.#view
    const host = this.#host
    if (view && host) {
      // a fresh start: the old collab state goes with the old document
      const plugins = view.state.plugins.filter((p) => !(p as unknown as { key: string }).key.startsWith('collab$'))
      view.updateState(view.state.reconfigure({ plugins }))
      this.#view = null
      this.attach(view, host)
      return
    }
    this.#update()
  }
}
