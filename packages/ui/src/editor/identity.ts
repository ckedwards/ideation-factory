// A page's blocks keep their draft identity (docs/spike-editor-clipboard.md): each of the draft's
// blocks on screen carries the ID the draft knows it by, through typing, cutting and pasting, so the
// page can tell the draft what moved rather than what was deleted and typed again.
//
// - **The identity:** an attribute (blockId) on the blocks the draft knows: paragraphs, headings,
//   quotes, code, rules, list items and tables (and the editor's own read-only blocks). It's drawn
//   as data-block-id, so it rides in the clipboard's HTML, and never reaches the Markdown.
// - **Cut:** the identities ride along, and the cut is noted on the page (any page editor on it can
//   take it), with the blocks it took whole, or the block and Markdown a few words left.
// - **Copy:** the identities are stripped before they reach the clipboard: a copy is new text.
// - **Paste:** a paste whose identities belong to a cut, and aren't on the page, is a move: they're
//   kept. Pasted again while they're there, it's new text, as a copy, text from elsewhere and ⌘⇧V
//   are; with the paste undone, they're gone again, and the next paste is the move.
//   A few words cut are moved by their first paste.
// - **A block's whole text is the block:** a cut, copy or drag from the start of a block's text to
//   the end of a block's text takes the blocks, as Google Docs' triple click takes the line break.
// - **Whole blocks are pasted here,** ahead of Milkdown's paste, which makes a lone paragraph of
//   plain text into bare text joining the block at the caret; at a block's start, above it.
// - **Never twice:** an identity already on the page (put back by undo, or kept by a block split in
//   two) stays on the first; the other is new.
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { Fragment, type Node, Slice } from '@milkdown/kit/prose/model'
import { NodeSelection, Plugin, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

/** Words cut from one block and pasted into another: their Markdown, and next to what they went. */
export interface MovedWords {
  from: string
  old: string
  to: { in: string; after: string } | { in: string; before: string }
}

// ---- reading identities ----

/** Every identity in some content, outermost first. */
function idsIn(content: Fragment): string[] {
  const ids: string[] = []
  content.descendants((node) => {
    const id = node.attrs['blockId'] as string | null | undefined
    if (id) {
      ids.push(id)
    }
    return true
  })
  return ids
}

/** The content with identities taken off (except `keep`): new text. */
function strip(content: Fragment, keep: Set<string> = new Set()): Fragment {
  const nodes: Node[] = []
  content.forEach((node) => {
    const id = node.attrs['blockId'] as string | null | undefined
    const attrs = id && !keep.has(id) ? { ...node.attrs, blockId: null } : node.attrs
    nodes.push(node.isText ? node : node.type.create(attrs, strip(node.content, keep), node.marks))
  })
  return Fragment.from(nodes)
}

const stripped = (slice: Slice) => new Slice(strip(slice.content), slice.openStart, slice.openEnd)

/** The identity of the block a position is in (the nearest one with one). */
export function blockAt(view: EditorView, pos: number): string | null {
  const $pos = view.state.doc.resolve(pos)
  for (let depth = $pos.depth; depth > 0; depth--) {
    const id = $pos.node(depth).attrs['blockId'] as string | null | undefined
    if (id) {
      return id
    }
  }
  return null
}

/**
 * Where the selection takes whole blocks (from the start of a block's text to the end of a block's
 * text): the range around them. Null for less, or a selection of another kind.
 */
function wholeRange(view: EditorView): { from: number; to: number } | null {
  const { selection, doc } = view.state
  if (selection.empty || !(selection instanceof TextSelection)) {
    return null
  }
  const around = (pos: number) => {
    const $pos = doc.resolve(pos)
    for (let depth = $pos.depth; depth > 0; depth--) {
      if ($pos.node(depth).attrs['blockId']) {
        return { start: $pos.before(depth), end: $pos.after(depth) }
      }
    }
    return null
  }
  const first = around(selection.from)
  const last = around(selection.to)
  if (
    !first ||
    !last ||
    doc.textBetween(first.start, selection.from) !== '' ||
    doc.textBetween(selection.to, last.end) !== ''
  ) {
    return null
  }
  // every item of a list: the list, so cutting them doesn't leave a list with an empty item
  const $first = doc.resolve(first.start)
  const list = $first.parent
  if (
    $first.depth > 0 &&
    (list.type.name === 'bullet_list' || list.type.name === 'ordered_list') &&
    first.start === $first.start() &&
    last.end === $first.end()
  ) {
    return { from: $first.before(), to: $first.after() }
  }
  return { from: first.start, to: last.end }
}

/** The identities of the blocks a slice has whole: all but those it's open around. */
function wholeIn(slice: Slice): Set<string> {
  const whole = new Set<string>()
  slice.content.forEach((child, _, i) => {
    const open = (i === 0 && slice.openStart > 0) || (i === slice.content.childCount - 1 && slice.openEnd > 0)
    if (!open) {
      idsIn(Fragment.from(child)).forEach((id) => whole.add(id))
    }
  })
  return whole
}

// ---- the clipboard ----

interface Cut {
  ids: Set<string>
  /** A few words of one block: which, and its Markdown before they were cut. */
  words: { from: string; text: string; before: string } | null
  /** The words were pasted (whole blocks are pasted as long as they're not on the page). */
  pasted: boolean
}

// one clipboard per page, as the browser has: a cut in one file can be pasted in another
const cuts: Cut[] = []

/** Puts some of the document on the clipboard, as ProseMirror would (transformCopied included). */
function toClipboard(view: EditorView, event: ClipboardEvent, slice: Slice): boolean {
  if (!event.clipboardData) {
    return false
  }
  const { dom, text } = view.serializeForClipboard(slice)
  event.preventDefault()
  event.clipboardData.clearData()
  event.clipboardData.setData('text/html', dom.innerHTML)
  event.clipboardData.setData('text/plain', text)
  return true
}

/** Where `after` differs from `before`: what was taken out, and what went in, between a common start and end. */
function difference(before: string, after: string): { start: number; removed: string; added: string } {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) {
    start++
  }
  let end = 0
  while (end < before.length - start && end < after.length - start && before.at(-1 - end) === after.at(-1 - end)) {
    end++
  }
  return { start, removed: before.slice(start, before.length - end), added: after.slice(start, after.length - end) }
}

export interface IdentityHooks {
  /** A block's Markdown now, by its identity. */
  sourceOf: (id: string) => string | null
  /** Words were cut from one block and pasted into another. */
  onWords: (words: MovedWords) => void
}

/** The page's handling of the clipboard; used ahead of Milkdown's clipboard plugin. */
export function clipboardIdentity(hooks: IdentityHooks): MilkdownPlugin {
  return $prose(() => {
    // which way the next serializing is going: copy, cut or a drag
    let going: 'copy' | 'cut' | 'drag' | null = null
    // the paste being handled is a move of whole blocks
    let moving = false
    // words pasted, waiting for the paste to land: then their Markdown either side is known
    let landing: { cut: NonNullable<Cut['words']>; to: string; before: string } | null = null
    return new Plugin({
      props: {
        handleDOMEvents: {
          copy: (view, event) => {
            going = 'copy'
            const range = wholeRange(view)
            return range ? toClipboard(view, event, view.state.doc.slice(range.from, range.to)) : false
          },
          cut: (view, event) => {
            going = 'cut'
            const range = wholeRange(view)
            if (!range || !toClipboard(view, event, view.state.doc.slice(range.from, range.to))) {
              return false
            }
            view.dispatch(view.state.tr.delete(range.from, range.to).scrollIntoView().setMeta('uiEvent', 'cut'))
            return true
          },
          dragstart: (view) => {
            going = 'drag'
            // one whole block is dragged as the block
            const range = wholeRange(view)
            const node = range ? view.state.doc.nodeAt(range.from) : null
            if (range && node && range.from + node.nodeSize === range.to) {
              view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, range.from)))
            }
            return false
          },
        },
        transformCopied: (slice, view) => {
          const way = going
          going = null
          if (way === 'cut') {
            const whole = wholeIn(slice)
            const { $from, $to } = view.state.selection
            const from = blockAt(view, $from.pos)
            const words =
              whole.size === 0 && from && $from.sameParent($to) && $from.parent.isTextblock
                ? { from, text: slice.content.textBetween(0, slice.content.size), before: hooks.sourceOf(from) ?? '' }
                : null
            cuts.push({ ids: new Set(idsIn(slice.content)), words, pasted: false })
            return slice
          }
          // a drag carries them, and the drop decides
          return way === 'drag' ? slice : stripped(slice)
        },
        transformPasted: (slice, view, plain) => {
          const onPage = new Set(idsIn(view.state.doc.content))
          const ids = idsIn(slice.content)
          if (view.dragging) {
            // a drag within this editor: a move unless it copies
            return view.dragging.move ? slice : stripped(slice)
          }
          const text = slice.content.textBetween(0, slice.content.size)
          // a cut's blocks, any of them not on the page; or a cut's words, not pasted yet
          const cut = plain
            ? undefined
            : cuts.find((c) =>
                c.words === null
                  ? ids.length > 0 && ids.every((id) => c.ids.has(id)) && ids.some((id) => !onPage.has(id))
                  : !c.pasted && text === c.words.text,
              )
          if (!cut) {
            return stripped(slice)
          }
          if (cut.words) {
            cut.pasted = true
            const to = blockAt(view, view.state.selection.from)
            if (to && to !== cut.words.from) {
              landing = { cut: cut.words, to, before: hooks.sourceOf(to) ?? '' }
            }
            return stripped(slice)
          }
          // one already on the page (undo put it back) stays there; the pasted one is new
          const keep = new Set(ids.filter((id) => !onPage.has(id)))
          moving = keep.size > 0
          return new Slice(strip(slice.content, keep), slice.openStart, slice.openEnd)
        },
        // whole blocks (a move, or a copy of whole blocks) go in as blocks, ahead of Milkdown's paste
        handlePaste: (view, _, slice) => {
          const blocks = slice.openStart === 0 && slice.openEnd === 0 && Boolean(slice.content.firstChild?.isBlock)
          if (!moving && !blocks) {
            return false
          }
          moving = false
          const { selection } = view.state
          const $at = selection.$from
          // at the start of a block: above it, rather than splitting it and leaving its identity on
          // the empty half
          let before = -1
          if (selection.empty && $at.parentOffset === 0) {
            for (let depth = $at.depth; depth > 0; depth--) {
              if ($at.node(depth).attrs['blockId'] && $at.start(depth) + (depth === $at.depth ? 0 : 1) >= $at.pos - 1) {
                before = $at.before(depth)
                break
              }
            }
          }
          const tr =
            before >= 0 ? view.state.tr.replaceRange(before, before, slice) : view.state.tr.replaceSelection(slice)
          view.dispatch(tr.scrollIntoView().setMeta('uiEvent', 'paste'))
          return true
        },
      },
      // words pasted have landed: what each block lost and gained, in Markdown
      view: () => ({
        update: (view, previous) => {
          if (!landing || view.state.doc.eq(previous.doc)) {
            return
          }
          const { cut, to, before } = landing
          landing = null
          const from = hooks.sourceOf(cut.from)
          const after = hooks.sourceOf(to)
          if (from === null || after === null) {
            return
          }
          const lost = difference(cut.before, from).removed
          const at = difference(before, after).start
          if (!lost.trim()) {
            return
          }
          hooks.onWords({
            from: cut.from,
            old: lost,
            to: at > 0 ? { in: to, after: before.slice(0, at) } : { in: to, before },
          })
        },
      }),
      // never one identity on two blocks: the first keeps it
      appendTransaction: (transactions, _, state) => {
        if (!transactions.some((t) => t.docChanged)) {
          return null
        }
        const seen = new Set<string>()
        const tr = state.tr
        state.doc.descendants((node, pos) => {
          const id = node.attrs['blockId'] as string | null | undefined
          if (id) {
            if (seen.has(id)) {
              tr.setNodeAttribute(pos, 'blockId', null)
            }
            seen.add(id)
          }
          return true
        })
        return tr.docChanged ? tr.setMeta('addToHistory', false) : null
      },
    })
  })
}
