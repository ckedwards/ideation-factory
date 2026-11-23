// ProseMirror's collab module (prosemirror-collab 1.3.1, by Marijn Haverbeke and others, MIT), kept
// here so that one thing can differ: where typing nobody has confirmed yet goes when someone else's
// lands at the same spot. Everything else is the module as published.
//
// The editor sends its steps to an authority (the idea's actor) with the count of steps it last
// saw; the authority takes them if that's the latest, or refuses them, and the editor takes what it
// missed and replays its own on top. Replaying is where the one change is:
//
// - **Your words stay whole.** Two people typing at the very same spot at the same moment: the
//   module replays your unconfirmed typing after theirs, while what the authority already confirmed
//   stays before it, so a word of yours can be split by theirs ("R" + "AAAA " + "RRR "). Here, typing
//   inserted exactly where theirs landed stays on the near side, beside what you typed before it.
//   Every editor still ends with the authority's document: what's replayed is sent again, and the
//   authority's order is the one everyone takes.
//
// The MIT notice: Copyright (C) 2015-2017 by Marijn Haverbeke <marijn@haverbeke.berlin> and others.
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
// associated documentation files (the "Software"), to deal in the Software without restriction,
// including without limitation the rights to use, copy, modify, merge, publish, distribute,
// sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions: The above copyright notice and this
// permission notice shall be included in all copies or substantial portions of the Software. THE
// SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
// LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
// IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
// CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
import type { Node } from '@milkdown/kit/prose/model'
import { type EditorState, Plugin, PluginKey, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import { type Mapping, ReplaceStep, type Step, type Transform } from '@milkdown/kit/prose/transform'

/** A step of ours not yet confirmed: with its inverse, to take it back while others' are applied. */
export class Rebaseable {
  constructor(
    readonly step: Step,
    readonly inverted: Step,
    readonly origin: Transform | null,
  ) {}
}

/** A step mapped through what came before it; typing inserted where someone else's landed stays before it. */
function mapNear(step: Step, mapping: Mapping): Step | null {
  if (step instanceof ReplaceStep && step.from === step.to) {
    const at = mapping.mapResult(step.from, -1)
    if (at.deletedAcross) {
      return null
    }
    return new ReplaceStep(at.pos, at.pos, step.slice, (step as unknown as { structure: boolean }).structure)
  }
  return step.map(mapping)
}

/** Takes back the steps given, applies `over`, and replays them on top (mapped): what's left of them. */
export function rebaseSteps(steps: Rebaseable[], over: Step[], transform: Transform): Rebaseable[] {
  for (let i = steps.length - 1; i >= 0; i--) {
    transform.step(steps[i]!.inverted)
  }
  for (const step of over) {
    transform.step(step)
  }
  const result: Rebaseable[] = []
  for (let i = 0, mapFrom = steps.length; i < steps.length; i++) {
    const mapped = mapNear(steps[i]!.step, transform.mapping.slice(mapFrom))
    mapFrom--
    if (mapped && !transform.maybeStep(mapped).failed) {
      // ProseMirror's own, marked internal: the replayed step mirrors the one taken back
      ;(transform.mapping as unknown as { setMirror(n: number, m: number): void }).setMirror(
        mapFrom,
        transform.steps.length - 1,
      )
      result.push(new Rebaseable(mapped, mapped.invert(transform.docs[transform.docs.length - 1]!), steps[i]!.origin))
    }
  }
  return result
}

/** What the plugin keeps: the count of the authority's steps last seen, and ours not yet confirmed. */
export class CollabState {
  constructor(
    readonly version: number,
    readonly unconfirmed: Rebaseable[],
  ) {}
}

function unconfirmedFrom(transform: Transform): Rebaseable[] {
  return transform.steps.map((step, i) => new Rebaseable(step, step.invert(transform.docs[i]!), transform))
}

const collabKey = new PluginKey<CollabState>('collab')

export interface CollabConfig {
  version?: number
  clientID?: string | number
  /** Steps of ours already in the document and not yet confirmed (an editor taking over from another). */
  unconfirmed?: Rebaseable[]
}

/** The collab plugin: it gathers what's typed, to send, and takes the authority's steps in. */
export function collab(config: CollabConfig = {}): Plugin<CollabState> {
  const conf = {
    version: config.version ?? 0,
    clientID: config.clientID ?? Math.floor(Math.random() * 0xffffffff),
  }
  return new Plugin<CollabState>({
    key: collabKey,
    state: {
      init: () => new CollabState(conf.version, config.unconfirmed ?? []),
      apply(tr, collabState) {
        const next = tr.getMeta(collabKey) as CollabState | undefined
        if (next) {
          return next
        }
        if (tr.docChanged) {
          return new CollabState(collabState.version, collabState.unconfirmed.concat(unconfirmedFrom(tr)))
        }
        return collabState
      },
    },
    config: conf,
    // tells the history plugin not to merge steps, so its history can be rebased
    historyPreserveItems: true,
  } as ConstructorParameters<typeof Plugin<CollabState>>[0])
}

/** Whether the state has the collab plugin. */
export function hasCollab(state: EditorState): boolean {
  return collabKey.get(state) !== undefined
}

function clientIDOf(state: EditorState): string | number {
  return (collabKey.get(state)!.spec as unknown as { config: { clientID: string | number } }).config.clientID
}

/**
 * A transaction taking in the authority's steps: ours among the first of them are confirmed, and the
 * rest of ours are rebased over the others'.
 */
export function receiveTransaction(
  state: EditorState,
  steps: Step[],
  clientIDs: Array<string | number>,
  options: { mapSelectionBackward?: boolean } = {},
): Transaction {
  const collabState = collabKey.getState(state)!
  const version = collabState.version + steps.length
  const ourID = clientIDOf(state)
  let ours = 0
  while (ours < clientIDs.length && clientIDs[ours] === ourID) {
    ++ours
  }
  let unconfirmed = collabState.unconfirmed.slice(ours)
  const theirs = ours ? steps.slice(ours) : steps
  if (!theirs.length) {
    return state.tr.setMeta(collabKey, new CollabState(version, unconfirmed))
  }
  const nUnconfirmed = unconfirmed.length
  const tr = state.tr
  if (nUnconfirmed) {
    unconfirmed = rebaseSteps(unconfirmed, theirs, tr)
  } else {
    for (const step of theirs) {
      tr.step(step)
    }
    unconfirmed = []
  }
  const next = new CollabState(version, unconfirmed)
  if (options.mapSelectionBackward && state.selection instanceof TextSelection) {
    tr.setSelection(
      TextSelection.between(
        tr.doc.resolve(tr.mapping.map(state.selection.anchor, -1)),
        tr.doc.resolve(tr.mapping.map(state.selection.head, -1)),
        -1,
      ),
    )
    // the selection was mapped, not set by hand: it doesn't scroll the view
    ;(tr as unknown as { updated: number }).updated &= ~1
  }
  return tr.setMeta('rebased', nUnconfirmed).setMeta('addToHistory', false).setMeta(collabKey, next)
}

/** What's to be sent: our unconfirmed steps, on the count last seen; null when there's nothing. */
export function sendableSteps(
  state: EditorState,
): { version: number; steps: Step[]; clientID: string | number } | null {
  const collabState = collabKey.getState(state)!
  if (collabState.unconfirmed.length === 0) {
    return null
  }
  return {
    version: collabState.version,
    steps: collabState.unconfirmed.map((s) => s.step),
    clientID: clientIDOf(state),
  }
}

/** The count of the authority's steps this state has seen. */
export function getVersion(state: EditorState): number {
  return collabKey.getState(state)!.version
}

/** Our unconfirmed steps, as they are now. */
export function unconfirmedOf(state: EditorState): Rebaseable[] {
  return collabKey.getState(state)?.unconfirmed ?? []
}

/** The document as the authority last confirmed it: without our unconfirmed steps. */
export function confirmedDoc(state: EditorState): Node {
  let doc = state.doc
  const unconfirmed = unconfirmedOf(state)
  for (let i = unconfirmed.length - 1; i >= 0; i--) {
    const result = unconfirmed[i]!.inverted.apply(doc)
    if (!result.doc) {
      break
    }
    doc = result.doc
  }
  return doc
}
