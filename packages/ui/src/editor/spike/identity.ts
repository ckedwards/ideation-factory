// SPIKE (docs/design-rich-text.md, "A spike before the page editor"): can a block on screen keep its
// draft identity through the clipboard, in a real browser? Throwaway: it answers that question and
// shows the shape of the wrapper the page editor would have; it isn't wired into anything.
//
// - **The identity:** an attribute (blockId) on the blocks the draft knows: paragraphs, headings,
//   quotes, code, rules, list items and tables. It's drawn as data-block-id, so it rides in the
//   clipboard's HTML, and it never reaches the Markdown.
// - **Cut:** the identities ride along, and the cut is noted on this page (any editor on it can take
//   it), with the blocks it took whole and, for a few words, the block and text they left.
// - **Copy:** the identities are stripped before they reach the clipboard: a copy is new text.
// - **Paste:** a paste whose identities belong to a cut not yet pasted is a move: they're kept, and
//   the cut is spent. Anything else (a second paste, a copy, text from another app carrying
//   data-block-id, ⌘⇧V) arrives as new text, with none.
// - **Drag:** a drag within an editor that moves is a move; a copying drag is a copy.
// - **Never twice:** no identity is on two blocks at once. One already on the page (put back by
//   undo, or kept by a block split in two) stays on the first, and the other is new.
import { defaultValueCtx, Editor, editorViewCtx, editorViewOptionsCtx, rootCtx } from '@milkdown/kit/core'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { history } from '@milkdown/kit/plugin/history'
import {
  blockquoteSchema,
  codeBlockSchema,
  commonmark,
  headingSchema,
  hrSchema,
  listItemSchema,
  paragraphSchema,
} from '@milkdown/kit/preset/commonmark'
import { gfm, tableSchema } from '@milkdown/kit/preset/gfm'
import { Fragment, type Node, type NodeSpec, Slice } from '@milkdown/kit/prose/model'
import { NodeSelection, Plugin, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

/** What the editors on the page did with the clipboard, for the spike's checks. */
export type SpikeEvent =
  | { kind: 'cut'; file: string; blocks: string[]; words: { from: string; text: string } | null }
  | { kind: 'copy'; file: string }
  | {
      kind: 'paste' | 'drop'
      file: string
      as: 'move' | 'new'
      blocks: string[]
      words: { from: string; text: string; to: string | null; at: number } | null
    }

interface Cut {
  /** Blocks it took whole, or that it left: every identity in it. */
  ids: Set<string>
  /** The blocks whose whole text it took, though the selection left them open at an end. */
  whole: Set<string>
  /** A few words out of one block. */
  words: { from: string; text: string } | null
  pasted: boolean
}

// one clipboard per page, as the browser has: a cut in one file can be pasted in another
const cuts: Cut[] = []
export const spikeLog: SpikeEvent[] = []
const listeners = new Set<() => void>()
function note(event: SpikeEvent) {
  spikeLog.push(event)
  listeners.forEach((l) => l())
}
export function onSpikeLog(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// ---- the identity, on the draft's blocks --------------------------------------------------------

type DOMSpec = ReturnType<NonNullable<NodeSpec['toDOM']>>

/** A node's DOM with data-block-id on its outer element. */
function withIdOnDom(spec: DOMSpec, id: string | null): DOMSpec {
  if (!id || !Array.isArray(spec)) {
    return spec
  }
  const [tag, second, ...rest] = spec as unknown as [string, unknown, ...unknown[]]
  if (second && typeof second === 'object' && !Array.isArray(second) && !(second instanceof globalThis.Node)) {
    return [tag, { ...(second as Record<string, unknown>), 'data-block-id': id }, ...rest] as unknown as DOMSpec
  }
  return [tag, { 'data-block-id': id }, ...(second === undefined ? [] : [second]), ...rest] as unknown as DOMSpec
}

/** The same node, with a blockId: drawn, and read back from data-block-id. */
function identified<T extends { extendSchema: (h: never) => unknown }>(schema: T): T {
  return (
    schema.extendSchema as unknown as (handler: (prev: (ctx: unknown) => NodeSpec) => (ctx: unknown) => NodeSpec) => T
  )((prev) => (ctx) => {
    const spec = prev(ctx)
    return {
      ...spec,
      attrs: { ...spec.attrs, blockId: { default: null } },
      parseDOM: (spec.parseDOM ?? []).map((rule) => ({
        ...rule,
        getAttrs: (dom: HTMLElement | string) => {
          const base = rule.getAttrs ? rule.getAttrs(dom as never) : (rule.attrs ?? {})
          if (base === false || base === null || typeof dom === 'string') {
            return base
          }
          return { ...(base as object), blockId: dom.getAttribute('data-block-id') }
        },
      })),
      toDOM: (node: Node) => withIdOnDom(spec.toDOM!(node), node.attrs['blockId'] as string | null),
    }
  })
}

const IDENTIFIED = new Set(['paragraph', 'heading', 'blockquote', 'code_block', 'hr', 'list_item', 'table'])

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

/** The identity of the block the position is in (the nearest one with one). */
function blockAt(view: EditorView, pos: number): string | null {
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
 * Where the selection takes whole blocks: from the start of a block's text to the end of a block's
 * text (a triple click, or a drag from one block's start to another's end), the range around those
 * blocks, so cutting takes them and not just their text, as a triple click in Google Docs takes the
 * paragraph's line break too. Null for less (a few words), or a selection of another kind.
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

// ---- the clipboard ------------------------------------------------------------------------------

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

function clipboardIdentity(file: string) {
  return $prose(() => {
    // which way the next serializing is going: copy, cut or a drag
    let going: 'copy' | 'cut' | 'drag' | null = null
    // the paste being handled is a move
    let moving = false
    return new Plugin({
      props: {
        handleDOMEvents: {
          copy: (view, event) => {
            going = 'copy'
            // whole blocks: copied as blocks, not their text
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
            // one whole block: dragged as the block
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
            const ids = idsIn(slice.content)
            const whole = wholeIn(slice)
            // a few words of one block
            const { $from, $to } = view.state.selection
            const words =
              whole.size === 0 && $from.sameParent($to) && $from.parent.isTextblock
                ? { from: blockAt(view, $from.pos) ?? '', text: slice.content.textBetween(0, slice.content.size) }
                : null
            cuts.push({ ids: new Set(ids), whole, words, pasted: false })
            note({ kind: 'cut', file, blocks: [...whole], words })
            return slice
          }
          if (way === 'drag') {
            // a drag carries them, and the drop decides
            return slice
          }
          note({ kind: 'copy', file })
          return new Slice(strip(slice.content), slice.openStart, slice.openEnd)
        },
        transformPasted: (slice, view, plain) => {
          const onPage = new Set(idsIn(view.state.doc.content))
          const ids = idsIn(slice.content)
          if (view.dragging) {
            // a drag within this editor: a move unless it copies
            const as = view.dragging.move ? 'move' : 'new'
            note({ kind: 'drop', file, as, blocks: as === 'move' ? ids : [], words: null })
            return as === 'move' ? slice : new Slice(strip(slice.content), slice.openStart, slice.openEnd)
          }
          const cut = plain
            ? undefined
            : cuts.find(
                (c) =>
                  !c.pasted &&
                  ((ids.length > 0 && ids.every((id) => c.ids.has(id))) ||
                    (c.words !== null && slice.content.textBetween(0, slice.content.size) === c.words.text)),
              )
          if (!cut) {
            note({ kind: 'paste', file, as: 'new', blocks: [], words: null })
            return new Slice(strip(slice.content), slice.openStart, slice.openEnd)
          }
          cut.pasted = true
          if (cut.words) {
            const at = view.state.selection.$from
            note({
              kind: 'paste',
              file,
              as: 'move',
              blocks: [],
              words: { ...cut.words, to: blockAt(view, at.pos), at: at.parentOffset },
            })
            return new Slice(strip(slice.content), slice.openStart, slice.openEnd)
          }
          // one already on the page (undo put it back) stays there; the pasted one is new
          const keep = new Set(ids.filter((id) => !onPage.has(id)))
          note({ kind: 'paste', file, as: 'move', blocks: [...keep], words: null })
          moving = keep.size > 0
          return new Slice(strip(slice.content, keep), slice.openStart, slice.openEnd)
        },
        // Milkdown's own paste makes a lone paragraph of plain text into bare text, joining the
        // block the caret's in: a moved block would lose itself, and a copied one would join
        // another. Whole blocks (a move, or a copy of whole blocks) are put in as blocks here,
        // ahead of it.
        handlePaste: (view, _, slice) => {
          const blocks = slice.openStart === 0 && slice.openEnd === 0 && Boolean(slice.content.firstChild?.isBlock)
          if (!moving && !blocks) {
            return false
          }
          moving = false
          const { selection } = view.state
          const $at = selection.$from
          // at the start of a block: above it, rather than splitting it and leaving its identity
          // on the empty half
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

// ---- an editor for one file -----------------------------------------------------------------------

export interface SpikeEditor {
  view: () => EditorView
  /** Each block with an identity, or none, in order: what the draft would be told. */
  blocks: () => Array<{ id: string | null; type: string; text: string }>
  /** Whether the document is the one opened, identities and all. */
  unchanged: () => boolean
  destroy: () => void
}

export async function createSpikeEditor(root: HTMLElement, file: string, source: string): Promise<SpikeEditor> {
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, source)
      ctx.update(editorViewOptionsCtx, (prev) => ({ ...prev, attributes: { class: 'prose spike-surface' } }))
    })
    .use(commonmark)
    .use(gfm)
    .use(
      [paragraphSchema, headingSchema, blockquoteSchema, codeBlockSchema, hrSchema, listItemSchema, tableSchema]
        .map(identified)
        .flat() as MilkdownPlugin[],
    )
    .use(history)
    // ahead of Milkdown's clipboard plugin, so a move is put in before it flattens it
    .use(clipboardIdentity(file))
    .use(clipboard)
    .create()
  const view = () => editor.action((ctx) => ctx.get(editorViewCtx))

  // the draft's identities, as the page would give them: the file's blocks in order
  const tr = view().state.tr
  let n = 0
  view().state.doc.descendants((node, pos, parent) => {
    const block = IDENTIFIED.has(node.type.name) && (parent === view().state.doc || node.type.name === 'list_item')
    if (block) {
      tr.setNodeAttribute(pos, 'blockId', `${file}-${++n}`)
    }
    return node.type.name !== 'table'
  })
  view().dispatch(tr.setMeta('addToHistory', false))
  const opened = view().state.doc

  return {
    view,
    blocks: () => {
      const out: Array<{ id: string | null; type: string; text: string }> = []
      view().state.doc.descendants((node, _, parent) => {
        if (IDENTIFIED.has(node.type.name) && (parent === view().state.doc || node.type.name === 'list_item')) {
          out.push({ id: node.attrs['blockId'] as string | null, type: node.type.name, text: node.textContent })
        }
        return node.type.name !== 'table'
      })
      return out
    },
    unchanged: () => view().state.doc.eq(opened),
    destroy: () => void editor.destroy(),
  }
}
