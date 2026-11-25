// Other people's carets and selections in a live draft (docs/handoff-live-editing.md, step 4): a thin
// caret in each window's color where it is, its selection tinted, and a flag with its name, always
// shown, in the space between the lines (as Confluence does). Each is in this document's positions,
// mapped through every change after it's placed, so typing anywhere keeps it on its words; live.ts
// places them, from where each window said it was.
//
// Flags on one line that would overlap move along it. Nothing slides or fades, so reduced motion
// needs nothing of its own. Carets are drawn for the eyes only: who's here is announced elsewhere.
import { type EditorState, Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'

/** Another window's caret: whose (its name, and color 1 to 8), and its selection in this document. */
export interface Caret {
  id: string
  name: string
  color: number
  anchor: number
  head: number
}

type Meta = { set: Caret } | { remove: string } | { clear: true }

interface CaretsState {
  carets: Map<string, Caret>
  decorations: DecorationSet
}

export const caretsKey = new PluginKey<CaretsState>('liveCarets')

/** A transaction that places a window's caret (or moves it there). */
export const setCaret = (tr: Transaction, caret: Caret) =>
  tr.setMeta(caretsKey, { set: caret } satisfies Meta).setMeta('addToHistory', false)
/** A transaction that takes a window's caret away. */
export const removeCaret = (tr: Transaction, id: string) =>
  tr.setMeta(caretsKey, { remove: id } satisfies Meta).setMeta('addToHistory', false)

/** The carets shown now (for tests, and the page). */
export const caretsOf = (state: EditorState): Caret[] => [...(caretsKey.getState(state)?.carets.values() ?? [])]

const clamp = (pos: number, state: EditorState) => Math.max(0, Math.min(pos, state.doc.content.size))

function decorate(state: EditorState, carets: Map<string, Caret>): DecorationSet {
  const decorations: Decoration[] = []
  for (const caret of carets.values()) {
    const style = `--live-c: var(--avatar-${caret.color})`
    const from = clamp(Math.min(caret.anchor, caret.head), state)
    const to = clamp(Math.max(caret.anchor, caret.head), state)
    if (from < to) {
      decorations.push(Decoration.inline(from, to, { class: 'live-selection', style }))
    }
    decorations.push(
      Decoration.widget(clamp(caret.head, state), () => caretElement(caret, style), {
        // the same caret isn't drawn again unless its name or color changes
        key: `caret:${caret.id}:${caret.color}:${caret.name}`,
        side: 10,
        ignoreSelection: true,
      }),
    )
  }
  return DecorationSet.create(state.doc, decorations)
}

function caretElement(caret: Caret, style: string): HTMLElement {
  const element = document.createElement('span')
  element.className = 'live-caret'
  element.setAttribute('style', style)
  element.setAttribute('contenteditable', 'false')
  element.setAttribute('aria-hidden', 'true')
  element.dataset['presence'] = caret.id
  // the name is drawn by CSS (content: attr(data-name)), not a text node: text in the widget would be
  // read as part of the word it stands in, so the browser's spellchecker marks both halves of it
  const flag = document.createElement('span')
  flag.className = 'live-flag'
  flag.dataset['name'] = caret.name
  element.append(flag)
  return element
}

/**
 * Flags on the same line that would overlap, moved along it so each name can be read; a line of them
 * that would run past the text's edge moves back as one, keeping them apart.
 */
export function spreadFlags(root: HTMLElement): void {
  const edge = root.getBoundingClientRect().right
  const flags = [...root.querySelectorAll<HTMLElement>('.live-flag')]
  for (const flag of flags) {
    flag.style.removeProperty('translate')
  }
  const placed = flags
    .map((flag) => ({ flag, rect: flag.getBoundingClientRect() }))
    .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)
  // by line: flags within a few pixels of each other's top
  const rows: Array<typeof placed> = []
  for (const p of placed) {
    const row = rows.at(-1)
    if (row && Math.abs(row[0]!.rect.top - p.rect.top) <= 4) {
      row.push(p)
    } else {
      rows.push([p])
    }
  }
  for (const row of rows) {
    let right = Number.NEGATIVE_INFINITY
    const shifts = row.map(({ rect }) => {
      const left = Math.max(rect.left, right + 2)
      right = left + rect.width
      return left - rect.left
    })
    const back = Math.max(0, right - edge)
    row.forEach(({ flag }, i) => {
      const shift = shifts[i]! - back
      if (shift !== 0) {
        flag.style.setProperty('translate', `${shift}px 0`)
      }
    })
  }
}

/**
 * The plugin: carets kept in step with the document, drawn, and, when this window's own caret moves
 * while the editor has focus, `onMove` (live.ts sends it).
 */
export function carets(onMove: () => void): Plugin<CaretsState> {
  return new Plugin<CaretsState>({
    key: caretsKey,
    state: {
      init: (_, state) => ({ carets: new Map(), decorations: DecorationSet.create(state.doc, []) }),
      apply: (tr, value, _, state) => {
        const meta = tr.getMeta(caretsKey) as Meta | undefined
        if (!tr.docChanged && !meta) {
          return value
        }
        const carets = new Map<string, Caret>()
        for (const [id, caret] of value.carets) {
          // a collapsed caret goes after text typed where it is, as its owner's does
          carets.set(id, {
            ...caret,
            anchor: tr.mapping.map(caret.anchor, caret.anchor === caret.head ? 1 : -1),
            head: tr.mapping.map(caret.head, 1),
          })
        }
        if (meta && 'set' in meta) {
          carets.set(meta.set.id, meta.set)
        } else if (meta && 'remove' in meta) {
          carets.delete(meta.remove)
        } else if (meta && 'clear' in meta) {
          carets.clear()
        }
        return { carets, decorations: decorate(state, carets) }
      },
    },
    props: {
      decorations: (state) => caretsKey.getState(state)?.decorations ?? null,
      handleDOMEvents: {
        focus: () => {
          onMove()
          return false
        },
      },
    },
    view: (view: EditorView) => {
      let frame = 0
      const spread = () => {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => spreadFlags(view.dom))
      }
      spread()
      // lines wrap again when the page is resized
      const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(spread)
      resized?.observe(view.dom)
      return {
        update: (view, before) => {
          if (view.hasFocus() && (!view.state.selection.eq(before.selection) || view.state.doc !== before.doc)) {
            onMove()
          }
          if (caretsKey.getState(view.state) !== caretsKey.getState(before)) {
            spread()
          }
        },
        destroy: () => {
          cancelAnimationFrame(frame)
          resized?.disconnect()
        },
      }
    },
  })
}
