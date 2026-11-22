// The rich side of the editor, on Milkdown (ProseMirror, with remark for Markdown in and out). This is
// the only code that knows Milkdown; the rest of the editor talks to the RichEditor it makes.
//
// Markdown is what's stored, so the editor reads Markdown and gives Markdown back, under one rule: a
// block nobody changed is never rewritten. Markdown writers restyle what they write (remark pads
// tables, escapes brackets, renumbers lists), so each top-level block on screen remembers the source it
// was opened from, and gives that back while it's unchanged. Only a changed block is written, in the
// file's own style (its bullet, emphasis and rule characters, its list numbering and its tables).
//
// Blocks are found with core's parser, so they're the blocks the rest of the app sees. A few kinds
// can't be typed in. Raw HTML is drawn as the page draws it (sanitized, html.ts) and is read only; an
// opening HTML block and its closing one are drawn as one, with the Markdown between them inside, read
// only too. Front matter, link definitions, and HTML that makes no sense alone are shown as their
// source.
import { parseMarkdown } from '@ideaf/core'
import {
  commandsCtx,
  defaultValueCtx,
  Editor,
  editorViewCtx,
  editorViewOptionsCtx,
  parserCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
  schemaCtx,
  serializerCtx,
} from '@milkdown/kit/core'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { history } from '@milkdown/kit/plugin/history'
import {
  createCodeBlockCommand,
  blockquoteKeymap,
  bulletListKeymap,
  insertHardbreakCommand,
  listItemKeymap,
  orderedListKeymap,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInHeadingCommand,
  headingKeymap,
} from '@milkdown/kit/preset/commonmark'
import {
  addColAfterCommand,
  addColBeforeCommand,
  addRowAfterCommand,
  addRowBeforeCommand,
  insertTableCommand,
  strikethroughKeymap,
  tableKeymap,
  toggleStrikethroughCommand,
} from '@milkdown/kit/preset/gfm'
import { lift, toggleMark, wrapIn } from '@milkdown/kit/prose/commands'
import { redo, undo } from '@milkdown/kit/prose/history'
import { keymap } from '@milkdown/kit/prose/keymap'
import { Fragment, type MarkType, type Node, type NodeType, type Schema, Slice } from '@milkdown/kit/prose/model'
import { liftListItem } from '@milkdown/kit/prose/schema-list'
import {
  type Command,
  type EditorState,
  NodeSelection,
  Plugin,
  PluginKey,
  type Selection as Selection_,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state'
import { deleteColumn, deleteRow, deleteTable, goToNextCell, isInTable, selectedRect } from '@milkdown/kit/prose/tables'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose, $view } from '@milkdown/kit/utils'
import { sanitizeHtml, SLOT } from '../document/html.ts'
import { drawnHtmlRun, drawnSchemas, htmlMark } from './drawing.ts'
import { clipboardIdentity, type MovedWords } from './identity.ts'
import { type Block, type Codec, createCodec, type IdentifiedBlock, type Flavor, writeOptions } from './model.ts'

export type { Flavor } from './model.ts'

/** What the toolbar can do, on either side of the switch. */
export type Action =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'heading'
  | 'quote'
  | 'code'
  | 'link'
  | 'bullets'
  | 'numbers'
  | 'tasks'
  | 'table'
  | 'undo'
  | 'redo'
  | 'code-block'

export type TableOp =
  | 'row-above'
  | 'row-below'
  | 'column-left'
  | 'column-right'
  | 'align-left'
  | 'align-center'
  | 'align-right'
  | 'delete-row'
  | 'delete-column'
  | 'delete-table'

export interface RichOptions {
  /** Where the editor draws itself. */
  root: HTMLElement
  /** The Markdown it opens with. Its style is the style changed blocks are written in. */
  source: string
  /** A page's: the draft's ID for each of the source's blocks (core's units), in order. */
  ids?: string[] | undefined
  flavor: Flavor
  /** For screen readers: the box's name. */
  label: string
  placeholder?: string | undefined
  /** The Markdown, each time the text changes. */
  onChange: (markdown: string) => void
  /** Where the caret is: what the toolbar lights. */
  onSelection: (state: Selection) => void
  /** ⌘↵ and Esc. */
  onSubmit?: (() => void) | undefined
  onCancel?: (() => void) | undefined
  /** ⌘K: the toolbar's link popover. */
  onLink: () => void
  /**
   * A right click (or the menu key) where the editor has a menu of its own: in a table, on a link, on
   * drawn HTML. Where, on the screen, and what's there. Elsewhere the browser's own menu shows.
   */
  onContextMenu: (at: { x: number; y: number }, here: { table: boolean; link: string | null; html: boolean }) => void
  /** A page's: a comment's mark clicked, by its ID. */
  onComment?: ((id: string) => void) | undefined
}

export interface Selection {
  /** The toolbar's buttons that are lit. */
  active: Set<Action>
  /** The caret is in a table: the table button opens the table's menu. */
  inTable: boolean
  /** The link the caret is in, if it's in one. */
  link: string | null
  /** The selected text, or the text of the link the caret is in: what a new link's text starts as. */
  text: string
  /** The level of the heading the caret's in, 1 to 6, or 0 in other text. */
  heading: number
  /** Text is selected. */
  range: boolean
  /** In a table, what its menu can't do here: nothing goes above the header row, nor is it deleted alone. */
  tableOff: Set<TableOp>
  /** What can't be done where the caret is, and why ("not in a code block"): greyed out in the toolbar. */
  disabled: Set<Action>
  why: Partial<Record<Action, string>>
}

export interface RichEditor {
  /** The Markdown now. */
  markdown: () => string
  /** Opens other Markdown in place of what's there (the box was cleared or changed from outside); a page's with its blocks' IDs. */
  load: (source: string, ids?: string[]) => void
  /** A page's blocks, as the draft knows them: each with its identity (null for new text) and its Markdown now. */
  blocks: () => Array<{ id: string | null; source: string }>
  /** New blocks take the identities the draft gave them (once saved): the draft's blocks, matched by their text. */
  adopt: (units: Array<{ id: string; source: string }>) => void
  /** Words moved between blocks since this was last asked, to go to the draft as moves. */
  movedWords: () => MovedWords[]
  /** A page's comments, marked on their text as the document marks them, from where the draft has them. */
  markComments: (marks: PageMark[]) => void
  /** The comment that's active, lit: the one its card is open for. */
  activeComment: (id: string | null) => void
  run: (action: Exclude<Action, 'link' | 'table' | 'heading'>) => void
  /** The caret's block made a heading of this level, 1 to 6, or back into text with 0. */
  heading: (level: number) => void
  /** A new table of this size where the caret is, and the caret into its first cell. Rows count the header. */
  insertTable: (columns: number, rows: number) => void
  /**
   * Makes the selection (or the link the caret's in) a link to `href`, its words `text` (the address
   * when that's empty); null takes the link off.
   */
  link: (href: string | null, text?: string) => void
  table: (op: TableOp) => void
  focus: () => void
  /** Where the selection (or the link the caret's in) is on the screen: where the link box opens. */
  selectionRect: () => DOMRect
  /**
   * Marks where the caret is while focus is elsewhere (in a menu or the link box), since the browser
   * stops drawing it: the selection highlighted, or a caret drawn where it was. 'link' highlights the
   * whole link the caret's in, for the link box. false stops.
   */
  hold: (mark: 'selection' | 'link' | false) => void
  /** Each block as it was opened, and written afresh as if it had been changed: for the round-trip test. */
  rewritten: () => Array<{ source: string; written: string }>
  /** The text box itself, for focus and labelling. */
  dom: () => HTMLElement
  destroy: () => void
}

/**
 * A comment shown on a page: on some of a block's text (where, as plain-text offsets in the block,
 * and its words, to find them again if the block's text moved), or on a heading's section.
 */
export type PageMark =
  | { id: string; block: string; from: number; to: number; quote: string; resolved?: boolean }
  | { id: string; heading: string; resolved?: boolean }
  /** On a whole block, by its ID: its corner marks, as the document draws them. */
  | { id: string; whole: string; resolved?: boolean }

interface MarksState {
  marks: PageMark[]
  set: DecorationSet
  active: string | null
}
const marksKey = new PluginKey<MarksState>('ideaf-comments')
/** A transaction that opened the page again: its marks are found again in what it opened. */
const RELOADED = 'ideaf-reloaded'

// a page's comments, marked as the document marks them: made from where the draft has them, and
// kept on their words as typing moves them, until the draft says where they are again
const commentMarks = $prose(
  () =>
    new Plugin<MarksState>({
      key: marksKey,
      state: {
        init: () => ({ marks: [], set: DecorationSet.empty, active: null }),
        apply: (tr, was, _old, state) => {
          const meta = tr.getMeta(marksKey) as Partial<Pick<MarksState, 'marks' | 'active'>> | undefined
          const marks = meta?.marks ?? was.marks
          const active = meta && 'active' in meta ? (meta.active ?? null) : was.active
          if (meta?.marks || tr.getMeta(RELOADED)) {
            return { marks, set: markDecorations(state.doc, marks), active }
          }
          if (!tr.docChanged) {
            return { marks, set: was.set, active }
          }
          const set = was.set.map(tr.mapping, tr.doc)
          // pasted or dropped: a cut's blocks are back with their identities, and their comments with them
          const event = tr.getMeta('uiEvent') as string | undefined
          if (event === 'paste' || event === 'drop') {
            const there = new Set(set.find().map((d) => (d.spec as { id: string }).id))
            const missing = marks.filter((m) => !there.has(m.id))
            if (missing.length > 0) {
              return { marks, set: set.add(state.doc, markDecorations(state.doc, missing).find()), active }
            }
          }
          return { marks, set, active }
        },
      },
      props: {
        decorations: (state) => {
          const marks = marksKey.getState(state)
          if (!marks || marks.set === DecorationSet.empty) {
            return null
          }
          if (!marks.active) {
            return marks.set
          }
          // the one that's active, lit: its pieces drawn again with the class (a second decoration
          // over them would draw a second mark inside the first, which no style is for)
          const pieces = marks.set.find(undefined, undefined, (spec: MarkSpec) => spec.id === marks.active)
          const lit = pieces.map((d) => {
            const spec = d.spec as MarkSpec
            const attrs = { ...spec.attrs, class: `${spec.attrs.class} is-active` }
            return spec.heading
              ? Decoration.node(d.from, d.to, attrs, spec)
              : Decoration.inline(d.from, d.to, attrs, spec)
          })
          return marks.set.remove(pieces).add(state.doc, lit)
        },
      },
    }),
)

/** What a comment's decoration knows: whose it is, and how it's drawn (to draw it again, lit). */
interface MarkSpec {
  id: string
  heading?: boolean
  // one comment's mark (data-comment-id), or a whole block's, which may be shared (data-comment-ids)
  attrs: { class: string; 'data-comment-id'?: string; 'data-comment-ids'?: string; nodeName?: string }
}

/** Where each comment is on a page: its pieces of text (one per run of formatting), or its heading. */
function markDecorations(doc: Node, marks: PageMark[]): DecorationSet {
  const blocks = new Map<string, { node: Node; pos: number }>()
  doc.descendants((node, pos) => {
    const id = node.attrs['blockId'] as string | null | undefined
    if (id) {
      blocks.set(id, { node, pos })
    }
    return node.type.name !== 'table'
  })
  const out: Decoration[] = []
  for (const mark of marks) {
    const resolved = mark.resolved ? ' is-resolved' : ''
    if ('whole' in mark) {
      const at = blocks.get(mark.whole)
      if (at && at.node.type.name !== 'heading') {
        const attrs = { class: `md-block-mark${resolved}`, 'data-comment-ids': mark.id }
        // drawn as a node, as a heading's is
        const spec: MarkSpec = { id: mark.id, heading: true, attrs }
        out.push(Decoration.node(at.pos, at.pos + at.node.nodeSize, attrs, spec))
      }
      continue
    }
    if ('heading' in mark) {
      const at = blocks.get(mark.heading)
      if (at && at.node.type.name === 'heading') {
        const attrs = { class: `md-section-mark${resolved}`, 'data-comment-id': mark.id }
        const spec: MarkSpec = { id: mark.id, heading: true, attrs }
        out.push(Decoration.node(at.pos, at.pos + at.node.nodeSize, attrs, spec))
      }
      continue
    }
    const at = blocks.get(mark.block)
    if (!at) {
      continue
    }
    const range = inBlock(at.node, at.pos, mark)
    if (!range) {
      continue
    }
    const pieces: Array<[number, number]> = []
    doc.nodesBetween(range[0], range[1], (node, pos) => {
      if (node.isText) {
        pieces.push([Math.max(pos, range[0]), Math.min(pos + node.nodeSize, range[1])])
      }
      return true
    })
    pieces.forEach(([from, to], i) => {
      const ends = `${i === 0 ? ' is-first' : ''}${i === pieces.length - 1 ? ' is-last' : ''}`
      const attrs = { nodeName: 'mark', class: `md-mark${ends}${resolved}`, 'data-comment-id': mark.id }
      const spec: MarkSpec = { id: mark.id, attrs }
      out.push(Decoration.inline(from, to, attrs, spec))
    })
  }
  return DecorationSet.create(doc, out)
}

/**
 * A comment's words in a block, as positions in the document: at its offsets in the block's text if
 * its words are there, or else where its words are nearest them; null if they aren't in it.
 */
function inBlock(block: Node, pos: number, mark: { from: number; to: number; quote: string }): [number, number] | null {
  // each character of the block's text, as its plain text counts them, and where it is (-1 between
  // paragraphs and at a line break, which count as one)
  const at: number[] = []
  let text = ''
  let started = false
  block.descendants((node, offset) => {
    // a nested list's items are blocks of their own
    if (node !== block && (node.type.name === 'bullet_list' || node.type.name === 'ordered_list')) {
      return false
    }
    if (node.isTextblock) {
      if (started) {
        at.push(-1)
        text += '\n'
      }
      started = true
    } else if (node.isText) {
      for (let i = 0; i < node.text!.length; i++) {
        at.push(pos + 1 + offset + i)
      }
      text += node.text
    } else if (node.type.name === 'hardbreak') {
      at.push(-1)
      text += '\n'
    }
    return true
  })
  let from = mark.from
  let to = mark.to
  if (text.slice(from, to) !== mark.quote) {
    // its words moved in the block: the nearest place they are
    let best = -1
    for (let i = text.indexOf(mark.quote); i >= 0 && mark.quote; i = text.indexOf(mark.quote, i + 1)) {
      if (best < 0 || Math.abs(i - mark.from) < Math.abs(best - mark.from)) {
        best = i
      }
    }
    if (best < 0) {
      return null
    }
    from = best
    to = best + mark.quote.length
  }
  while (from < to && at[from] === -1) {
    from++
  }
  while (to > from && at[to - 1] === -1) {
    to--
  }
  if (from >= to || at[from] === undefined || at[to - 1] === undefined) {
    return null
  }
  return [at[from]!, at[to - 1]! + 1]
}

// a run drawn as its HTML with the blocks between where it left off, none of it typed in
const htmlRunView = $view(drawnHtmlRun.node, () => (node) => {
  const dom = document.createElement('div')
  dom.className = 'md-editor-html'
  dom.contentEditable = 'false'
  const drawn = document.createElement('div')
  drawn.className = 'md-html-drawn'
  drawn.innerHTML = sanitizeHtml(`${node.attrs['open'] as string}<div ${SLOT}></div>${node.attrs['close'] as string}`)
  let inside = drawn.querySelector<HTMLElement>(`[${SLOT}]`)
  if (!inside) {
    inside = document.createElement('div')
    drawn.append(inside)
  }
  dom.append(htmlMark(), drawn)
  return {
    dom,
    contentDOM: inside,
    update: (next) =>
      next.type === node.type &&
      next.attrs['open'] === node.attrs['open'] &&
      next.attrs['close'] === node.attrs['close'],
    // its details opening and closing is no change to the text
    ignoreMutation: () => true,
  }
})

export async function createRichEditor(options: RichOptions): Promise<RichEditor> {
  const latest = { options }
  // set once the editor's made: nothing writes before then
  let codec!: Codec
  const write = (doc: Node) => codec.write(doc)
  let emitted = ''
  // Values given out that the page hasn't given back yet. Typing quickly runs ahead of the page:
  // it's still rendering an older one ("H" after "Ha" went out), which is the page catching up, not
  // a new value to open. Cleared once the page gives back the latest.
  const unheard = new Set<string>()
  // opening Markdown isn't a change: what's on screen is what was given
  let loading = false

  // the keys, as the design has them (Milkdown's own differ): these run before Milkdown's
  const keys = $prose((ctx) => {
    const inTable: Command = (state) => isInTable(state)
    // ⌘↵ or Ctrl+↵ on any system, as the plain box takes them
    const submit: Command = () => {
      latest.options.onSubmit?.()
      return Boolean(latest.options.onSubmit)
    }
    return keymap({
      'Meta-Enter': submit,
      'Ctrl-Enter': submit,
      Escape: () => {
        latest.options.onCancel?.()
        return Boolean(latest.options.onCancel)
      },
      'Mod-k': (state) => {
        if (!unavailable(state).disabled.has('link')) {
          latest.options.onLink()
        }
        return true
      },
      // the formatting keys do nothing where their buttons are greyed out (Milkdown's own would, say,
      // turn a code block into a heading, or put drawn HTML in a list)
      ...Object.fromEntries(
        (
          [
            ['Mod-b', 'bold'],
            ['Mod-i', 'italic'],
            ['Mod-e', 'code'],
            ['Mod-Shift-x', 'strike'],
            ['Mod-Shift-.', 'quote'],
            ['Mod-Shift-7', 'numbers'],
            ['Mod-Shift-8', 'bullets'],
            ['Mod-Alt-0', 'heading'],
            ['Mod-Alt-1', 'heading'],
            ['Mod-Alt-2', 'heading'],
            ['Mod-Alt-3', 'heading'],
            ['Mod-Alt-4', 'heading'],
            ['Mod-Alt-5', 'heading'],
            ['Mod-Alt-6', 'heading'],
            ['Mod-]', 'bullets'],
            ['Mod-[', 'bullets'],
          ] as Array<[string, Action]>
        ).map(([key, what]): [string, Command] => [key, (state) => unavailable(state).disabled.has(what)]),
      ),
      'Mod-z': undo,
      'Mod-Shift-z': redo,
      'Mod-y': redo,
      // Tab moves focus out of the editor, except in a table, where it moves between cells
      Tab: (state, dispatch, view) => {
        if (!inTable(state)) {
          return false
        }
        if (goToNextCell(1)(state, dispatch)) {
          return true
        }
        // the last cell: a new row, and into its first cell
        ctx.get(commandsCtx).call(addRowAfterCommand.key)
        return view ? goToNextCell(1)(view.state, view.dispatch) : true
      },
      'Shift-Tab': (state, dispatch) => inTable(state) && (goToNextCell(-1)(state, dispatch) || true),
      // Enter in a table: the cell below, or a new row under the last
      Enter: (state, dispatch, view) => {
        if (options.flavor === 'inline') {
          return true
        }
        if (leaveCode(state, dispatch)) {
          return true
        }
        if (!inTable(state)) {
          return false
        }
        if (!down(state, dispatch)) {
          ctx.get(commandsCtx).call(addRowAfterCommand.key)
          if (view) {
            down(view.state, view.dispatch)
          }
        }
        return true
      },
      'Shift-Enter': () => options.flavor === 'inline' || ctx.get(commandsCtx).call(insertHardbreakCommand.key),
    })
  })

  // empty: says what the box is for
  const placeholder = $prose(
    () =>
      new Plugin({
        props: {
          decorations: (state) => {
            const only = state.doc.childCount === 1 ? state.doc.firstChild : null
            if (!only || only.type.name !== 'paragraph' || only.content.size > 0 || !latest.options.placeholder) {
              return null
            }
            return DecorationSet.create(state.doc, [
              Decoration.node(0, only.nodeSize, {
                class: 'md-editor-placeholder',
                'data-placeholder': latest.options.placeholder,
              }),
            ])
          },
        },
      }),
  )

  // drawn HTML is read only: typing with it selected leaves it be (Delete and Backspace still take it out)
  // where the caret is, still marked while focus is in a menu or the link box. A selection is marked with
  // a highlight (heldHighlight) rather than a decoration: a decoration redraws the text, and while focus
  // is on a toolbar button the browser still paints its selection there, so the redraw would slide the
  // selection's ends out to the paragraph's (seen as a flash). A caret has nothing painted to slide, so
  // it's drawn as a widget.
  let heldRange: Range | null = null
  const unhold = () => {
    if (heldRange) {
      heldHighlight()?.delete(heldRange)
      heldRange = null
    }
  }
  const holdKey = new PluginKey<DecorationSet>('ideaf-hold')
  const hold = $prose(
    () =>
      new Plugin<DecorationSet>({
        key: holdKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, held) => {
            const mark = tr.getMeta(holdKey) as 'selection' | 'link' | false | undefined
            if (mark === undefined) {
              // the caret's moved (back in the text, say): the mark's done. Never cleared by an update
              // of its own as focus comes back, since that would put the old selection back under a
              // press that's placing a new one; it's hidden while the text has focus (MarkdownEditor.css)
              return tr.selectionSet ? DecorationSet.empty : held.map(tr.mapping, tr.doc)
            }
            if (mark === false || tr.selection instanceof NodeSelection) {
              // a whole block selected keeps its own outline
              return DecorationSet.empty
            }
            const { from, to } = heldSpan(tr.selection, mark)
            if (from !== to) {
              // a highlight, not a decoration (above)
              return DecorationSet.empty
            }
            // a caret, drawn
            const caret = () => {
              const bar = document.createElement('span')
              bar.className = 'md-editor-held-caret'
              return bar
            }
            return DecorationSet.create(tr.doc, [Decoration.widget(from, caret, { side: -1, key: 'held-caret' })])
          },
        },
        props: {
          decorations: (state) => holdKey.getState(state) ?? null,
          // back in the text, the browser draws its own selection again (no update: see above)
          handleDOMEvents: {
            focus: () => {
              unhold()
              return false
            },
          },
        },
        view: () => ({
          update: (v, before) => {
            if (!v.state.selection.eq(before.selection)) {
              unhold()
            }
          },
          destroy: unhold,
        }),
      }),
  )

  // a click on a comment's mark opens its card, as on the page; the caret goes where it was clicked
  const commentClicks = $prose(
    () =>
      new Plugin({
        props: {
          handleClick: (_view, _pos, event) => {
            const id = (event.target as Element).closest('[data-comment-id]')?.getAttribute('data-comment-id')
            if (id) {
              options.onComment?.(id)
            }
            return false
          },
        },
      }),
  )

  // a right click in a table, on a link or on drawn HTML: the editor's menu for it, at the click
  const contextMenu = $prose(
    () =>
      new Plugin({
        props: {
          handleDOMEvents: {
            contextmenu: (view, event) => {
              const target = event.target as Element
              // from the menu key (or Shift+F10) it's the editor itself; from a click, what was clicked
              const keyboard = target === view.dom
              const html = target.closest('.md-editor-html')
              if (!keyboard && !target.closest('td, th, a') && !html) {
                return false
              }
              if (!keyboard) {
                // the caret (or the HTML block) where the click was, as a left click would put it
                let selection: Selection_ | null = null
                if (html) {
                  view.state.doc.forEach((_, offset) => {
                    if (view.nodeDOM(offset) === html) {
                      selection = NodeSelection.create(view.state.doc, offset)
                    }
                  })
                } else {
                  // where the click was, or (with no place on the screen to go by) where what was clicked starts
                  const placed = event.clientX !== 0 || event.clientY !== 0
                  let pos = placed
                    ? view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
                    : view.posAtDOM(target, 0)
                  // on a link: inside it (just before its first letter counts as outside)
                  const link = target.closest('a')
                  if (link && view.dom.contains(link)) {
                    const start = view.posAtDOM(link, 0)
                    if (pos === undefined || pos <= start) {
                      pos = start + 1
                    }
                  }
                  const { from, to } = view.state.selection
                  if (pos !== undefined && (pos < from || pos > to)) {
                    selection = TextSelection.near(view.state.doc.resolve(pos))
                  }
                }
                if (selection) {
                  view.dispatch(view.state.tr.setSelection(selection))
                }
              }
              const { state } = view
              const here = {
                table: isInTable(state) && !(state.selection instanceof NodeSelection),
                link: selectionOf(state).link,
                html:
                  state.selection instanceof NodeSelection &&
                  ['ideaf_raw', 'ideaf_html_run'].includes(state.selection.node.type.name),
              }
              if (!here.table && !here.link && !here.html) {
                return false
              }
              event.preventDefault()
              const caret = view.coordsAtPos(state.selection.from)
              const placed = !keyboard && (event.clientX !== 0 || event.clientY !== 0)
              latest.options.onContextMenu(
                placed ? { x: event.clientX, y: event.clientY } : { x: caret.left, y: caret.bottom },
                here,
              )
              return true
            },
          },
        },
      }),
  )

  const keepHtml = $prose(
    () =>
      new Plugin({
        props: {
          handleTextInput: (view) => {
            const { selection } = view.state
            return (
              selection instanceof NodeSelection && ['ideaf_raw', 'ideaf_html_run'].includes(selection.node.type.name)
            )
          },
        },
      }),
  )

  // a web address pasted over selected text makes it a link
  const pasteLink = $prose(
    (ctx) =>
      new Plugin({
        props: {
          handlePaste: (view, event) => {
            const text = event.clipboardData?.getData('text/plain').trim() ?? ''
            if (view.state.selection.empty || !/^https?:\/\/\S+$/.test(text)) {
              return false
            }
            const link = ctx.get(schemaCtx).marks['link']!
            const { from, to } = view.state.selection
            view.dispatch(view.state.tr.addMark(from, to, link.create({ href: text })))
            return true
          },
        },
      }),
  )

  // headings and lists don't mix: an edit that puts a heading in a list (typing "# " in one, say) is
  // refused; one that was there when it opened stays
  const noHeadingsInLists = $prose(
    () =>
      new Plugin({
        filterTransaction: (tr, state) =>
          !tr.docChanged || loading || headingsInLists(tr.doc) <= headingsInLists(state.doc),
        props: {
          // "# " typed in a list, or "- " at a heading's start: just text, not Markdown turning it into
          // the other (that edit would be refused, and the space lost with it)
          handleTextInput: (view, from, to, text) => {
            if (text !== ' ') {
              return false
            }
            const { $from } = view.state.selection
            const before = $from.parent.textBetween(0, $from.parentOffset)
            const mixing =
              (inList($from) && /^#{1,6}$/.test(before)) ||
              ($from.parent.type.name === 'heading' && /^(?:[-+*]|\d+[.)])$/.test(before))
            if (!mixing) {
              return false
            }
            view.dispatch(view.state.tr.insertText(text, from, to))
            return true
          },
        },
      }),
  )

  // the inline flavor holds one paragraph: no blocks, and what's pasted is flattened into it
  const inlineOnly = $prose(
    () =>
      new Plugin({
        filterTransaction: (tr) =>
          options.flavor !== 'inline' ||
          !tr.docChanged ||
          (tr.doc.childCount === 1 && tr.doc.firstChild!.type.name === 'paragraph'),
        props: {
          transformPasted: (pasted, view) => {
            if (options.flavor !== 'inline') {
              return pasted
            }
            const schema = view.state.schema
            const inline: Node[] = []
            pasted.content.descendants((node) => {
              if (node.isTextblock) {
                if (inline.length > 0) {
                  inline.push(schema.text(' '))
                }
                node.forEach((child) => inline.push(child))
                return false
              }
              return true
            })
            return new Slice(Fragment.from(inline), 0, 0)
          },
        },
      }),
  )

  // each change: the Markdown out, and the toolbar's state
  const watch = $prose(
    () =>
      new Plugin({
        view: () => ({
          update: (view: EditorView, before: EditorState) => {
            if (!view.state.doc.eq(before.doc) && !loading) {
              emitted = write(view.state.doc)
              unheard.add(emitted)
              latest.options.onChange(emitted)
            }
            if (
              !view.state.selection.eq(before.selection) ||
              !view.state.doc.eq(before.doc) ||
              view.state.storedMarks !== before.storedMarks
            ) {
              latest.options.onSelection(selectionOf(view.state))
            }
          },
        }),
      }),
  )

  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, options.root)
      ctx.set(defaultValueCtx, '')
      ctx.update(editorViewOptionsCtx, (prev) => ({
        ...prev,
        attributes: {
          // a page reads at the document's size, a comment at a comment's
          class: options.flavor === 'page' ? 'md-editor-surface prose' : 'md-editor-surface prose prose-compact',
          role: 'textbox',
          'aria-multiline': options.flavor === 'inline' ? 'false' : 'true',
          'aria-label': options.label,
        },
      }))
      ctx.update(remarkStringifyOptionsCtx, (prev) => writeOptions(options.source, prev))
      // the design's keys in place of Milkdown's: Tab leaves the editor outside a table
      ctx.update(listItemKeymap.key, (prev) => ({
        ...prev,
        SinkListItem: { ...prev.SinkListItem, shortcuts: 'Mod-]' },
        LiftListItem: { ...prev.LiftListItem, shortcuts: 'Mod-[' },
      }))
      ctx.update(tableKeymap.key, (prev) => ({
        ...prev,
        NextCell: { ...prev.NextCell, shortcuts: [] },
        PrevCell: { ...prev.PrevCell, shortcuts: [] },
        ExitTable: { ...prev.ExitTable, shortcuts: [] },
      }))
      ctx.update(strikethroughKeymap.key, (prev) => ({
        ...prev,
        ToggleStrikethrough: { ...prev.ToggleStrikethrough, shortcuts: 'Mod-Shift-x' },
      }))
      // Backspace at a heading's start joins it to the block before, as anywhere else: Milkdown's
      // takes the heading down a level instead, as if it were deleting a hidden #
      ctx.update(headingKeymap.key, (prev) => ({
        ...prev,
        DowngradeHeading: { ...prev.DowngradeHeading, shortcuts: [] },
      }))
      ctx.update(blockquoteKeymap.key, (prev) => ({
        ...prev,
        WrapInBlockquote: { ...prev.WrapInBlockquote, shortcuts: 'Mod-Shift-.' },
      }))
      ctx.update(bulletListKeymap.key, (prev) => ({
        ...prev,
        WrapInBulletList: { ...prev.WrapInBulletList, shortcuts: 'Mod-Shift-8' },
      }))
      ctx.update(orderedListKeymap.key, (prev) => ({
        ...prev,
        WrapInOrderedList: { ...prev.WrapInOrderedList, shortcuts: 'Mod-Shift-7' },
      }))
    })
    .use(keys)
    .use(inlineOnly)
    .use(noHeadingsInLists)
    .use(pasteLink)
    .use(keepHtml)
    .use(hold)
    .use(contextMenu)
    .use(commentClicks)
    .use(drawnSchemas)
    .use(htmlRunView)
    .use(history)
    // a page keeps its blocks' identities through the clipboard, ahead of Milkdown's paste
    .use(
      options.flavor === 'page'
        ? clipboardIdentity({
            sourceOf: (id) => blocks().find((b) => b.id === id)?.source ?? null,
            onWords: (w) => void moved.push(w),
          })
        : [],
    )
    .use(clipboard)
    .use(commentMarks)
    .use(placeholder)
    .use(watch)
    .create()

  const action = <T>(fn: (ctx: Parameters<Parameters<typeof editor.action>[0]>[0]) => T): T => editor.action(fn)
  const schema = action((ctx) => ctx.get(schemaCtx))
  const view = () => action((ctx) => ctx.get(editorViewCtx))
  const parse = (markdown: string): Node => action((ctx) => ctx.get(parserCtx)(markdown))
  const serialize = (node: Node): string =>
    action((ctx) => ctx.get(serializerCtx)(schema.topNodeType.create(null, node))).replace(/\n+$/, '')

  // words moved between blocks, not yet asked for
  let moved: MovedWords[] = []

  // opening and writing, shared with the idea's actor (model.ts)
  codec = createCodec({ schema, parse, serialize, flavor: options.flavor })
  const open = (source: string, ids?: string[]) => codec.open(source, ids)
  const identities = (): IdentifiedBlock[] => codec.identities(view().state.doc)

  const blocks = (): Array<{ id: string | null; source: string }> =>
    identities().map(({ id, source }) => ({ id, source }))

  /**
   * Blocks take the identities the draft has for them. Where the draft's blocks are the page's, one
   * for one, each takes its own, whatever it had (the draft discarded, say, back to the same text
   * with its old blocks); otherwise new blocks take the draft's blocks not on screen, matched by
   * their text.
   */
  function adopt(units: Array<{ id: string; source: string }>): void {
    const current = identities()
    const v = view()
    const tr = v.state.tr
    const same = current.length === units.length && current.every((b, i) => b.source.trim() === units[i]!.source.trim())
    if (same) {
      current.forEach((block, i) => {
        if (block.at !== null && block.id !== units[i]!.id) {
          tr.setNodeAttribute(block.at, 'blockId', units[i]!.id)
        }
      })
    } else {
      const held = new Set(current.flatMap((b) => (b.id ? [b.id] : [])))
      const free = units.filter((u) => !held.has(u.id))
      for (const block of current) {
        if (block.id !== null || block.at === null) {
          continue
        }
        const i = free.findIndex((u) => u.source.trim() === block.source.trim())
        if (i >= 0) {
          tr.setNodeAttribute(block.at, 'blockId', free[i]!.id)
          free.splice(i, 1)
        }
      }
    }
    if (tr.docChanged) {
      // the same text: nothing to tell the page. The comments are found again on the blocks as
      // they're now known
      loading = true
      v.dispatch(tr.setMeta('addToHistory', false).setMeta(RELOADED, true))
      loading = false
    }
  }

  /** Moves the caret to the cell below; false in the last row. */
  function down(state: EditorState, dispatch?: (tr: EditorState['tr']) => void): boolean {
    const rect = selectedRect(state)
    if (rect.bottom >= rect.map.height) {
      return false
    }
    const cell = rect.map.map[rect.bottom * rect.map.width + rect.left]!
    const pos = rect.tableStart + cell + 2
    dispatch?.(state.tr.setSelection(TextSelection.near(state.doc.resolve(pos))).scrollIntoView())
    return true
  }

  const load = (source: string, ids?: string[]) => {
    const v = view()
    const was = v.state.selection.from
    const doc = open(source, ids)
    const tr = v.state.tr.replaceWith(0, v.state.doc.content.size, doc.content).setMeta('addToHistory', false)
    if (options.flavor === 'page') {
      // a page opened again (someone else's change): the caret stays about where it was
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(was, tr.doc.content.size))))
    } else {
      // the caret at the end of the text, or at its start when it ends in a block that isn't typed in
      tr.setSelection(tr.doc.lastChild?.isTextblock ? TextSelection.atEnd(tr.doc) : TextSelection.atStart(tr.doc))
    }
    // its comments, found again in what's opened
    tr.setMeta(RELOADED, true)
    loading = true
    v.dispatch(tr)
    loading = false
    emitted = source
    unheard.clear()
    // Milkdown's own plugins tidy what's loaded (they even out a table's rows, say), making new
    // nodes: each takes the place, and the source, of the one it replaced
    const settled = view().state.doc
    if (settled !== tr.doc && settled.childCount === doc.childCount) {
      const origin = new WeakMap<Node, Block>()
      const nodes: Node[] = []
      settled.forEach((node, _, i) => {
        const block = codec.opened.origin.get(doc.child(i))
        if (block) {
          origin.set(node, block)
          nodes.push(node)
        }
      })
      codec.opened = { ...codec.opened, origin, nodes }
    }
  }
  load(options.source, options.ids)
  options.onSelection(selectionOf(view().state))

  const commands = () => action((ctx) => ctx.get(commandsCtx))
  const exec = (command: Command) => {
    const v = view()
    command(v.state, v.dispatch, v)
    v.focus()
  }

  return {
    markdown: () => write(view().state.doc),
    blocks,
    adopt: (units) => adopt(units),
    markComments: (marks) => {
      const v = view()
      v.dispatch(v.state.tr.setMeta(marksKey, { marks }))
    },
    activeComment: (id) => {
      const v = view()
      if (marksKey.getState(v.state)?.active !== id) {
        v.dispatch(v.state.tr.setMeta(marksKey, { active: id }))
      }
    },
    movedWords: () => {
      const out = moved
      moved = []
      return out
    },
    load: (source, ids) => {
      if (source === emitted || unheard.has(source)) {
        if (source === emitted) {
          // the page has caught up
          unheard.clear()
        }
        // the same text, saved: new blocks take the identities the draft gave them
        if (ids) {
          adopt(parseMarkdown(source).units.map((u, i) => ({ id: ids[i]!, source: source.slice(u.start, u.end) })))
        }
      } else {
        load(source, ids)
      }
    },
    run: (what) => {
      const state = view().state
      const here = selectionOf(state)
      switch (what) {
        case 'bold':
          commands().call(toggleStrongCommand.key)
          break
        case 'italic':
          commands().call(toggleEmphasisCommand.key)
          break
        case 'strike':
          commands().call(toggleStrikethroughCommand.key)
          break
        case 'code':
          commands().call(toggleInlineCodeCommand.key)
          break
        case 'quote':
          if (here.active.has('quote')) {
            exec(lift)
          } else {
            commands().call(wrapInBlockquoteCommand.key)
          }
          break
        case 'bullets':
        case 'numbers':
        case 'tasks':
          exec(toggleList(schema, what, here.active))
          break
        case 'undo':
          exec(undo)
          break
        case 'redo':
          exec(redo)
          break
        case 'code-block':
          if (here.active.has('code-block')) {
            commands().call(turnIntoTextCommand.key)
          } else {
            commands().call(createCodeBlockCommand.key)
          }
          break
      }
      view().focus()
    },
    heading: (level) => {
      if (level === 0) {
        commands().call(turnIntoTextCommand.key)
      } else {
        commands().call(wrapInHeadingCommand.key, level)
      }
      view().focus()
    },
    insertTable: (columns, rows) => {
      commands().call(insertTableCommand.key, { row: rows, col: columns })
      // the caret into the new table's first cell, to type its first heading
      const v = view()
      const after = v.state.selection.from
      let at = -1
      v.state.doc.descendants((node, pos) => {
        if (at < 0 && node.type.name === 'table' && pos + node.nodeSize >= after) {
          at = pos
        }
        return at < 0
      })
      if (at >= 0) {
        v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(at + 4))))
      }
      v.focus()
    },
    link: (href, text) => {
      const v = view()
      const type = schema.marks['link']!
      const { state } = v
      let { from, to } = state.selection
      if (state.selection.empty) {
        const range = markRange(state.selection, type)
        if (range) {
          ;({ from, to } = range)
        }
      }
      let tr = state.tr
      if (href === null) {
        tr = tr.removeMark(from, to, type)
      } else {
        // the text as given, or the address when there's none
        const words = text?.trim() || href
        if (from < to && words === state.doc.textBetween(from, to, ' ')) {
          // the same words: the link goes on them as they are, bold or whatever else they are
          tr = tr.removeMark(from, to, type).addMark(from, to, type.create({ href }))
        } else {
          // new words, with the marks the text there had, and the link
          const marks = type
            .create({ href })
            .addToSet(
              type.removeFromSet(
                state.doc.resolve(from).marksAcross(state.doc.resolve(to)) ?? state.doc.resolve(from).marks(),
              ),
            )
          tr = tr.replaceWith(from, to, schema.text(words, marks))
        }
      }
      v.dispatch(tr)
      v.focus()
    },
    table: (op) => {
      switch (op) {
        case 'row-above':
          // nothing goes above the header row (the menu greys this out there)
          if (!selectionOf(view().state).tableOff.has('row-above')) {
            commands().call(addRowBeforeCommand.key)
          }
          break
        case 'row-below':
          commands().call(addRowAfterCommand.key)
          break
        case 'column-left':
          commands().call(addColBeforeCommand.key)
          break
        case 'column-right':
          commands().call(addColAfterCommand.key)
          break
        case 'align-left':
        case 'align-center':
        case 'align-right':
          alignColumn(view(), op.slice(6) as 'left' | 'center' | 'right')
          break
        case 'delete-row':
          // a table keeps its header row and one more (the menu greys this out there)
          if (!selectionOf(view().state).tableOff.has('delete-row')) {
            exec(deleteRow)
          }
          break
        case 'delete-column':
          exec(deleteColumn)
          break
        case 'delete-table':
          exec(deleteTable)
          break
      }
      view().focus()
    },
    focus: () => view().focus(),
    selectionRect: () => {
      const v = view()
      let { from, to } = v.state.selection
      if (from === to) {
        const range = markRange(v.state.selection, schema.marks['link']!)
        if (range) {
          ;({ from, to } = range)
        }
      }
      const a = v.coordsAtPos(from)
      const b = v.coordsAtPos(to, -1)
      // on one line: from the first letter to the last; over several, the first line's start
      const left = b.top === a.top ? Math.min(a.left, b.left) : a.left
      const right = b.top === a.top ? Math.max(a.right, b.right) : a.left
      return DOMRect.fromRect({ x: left, y: a.top, width: right - left, height: Math.max(a.bottom, b.bottom) - a.top })
    },
    hold: (mark) => {
      const v = view()
      unhold()
      const { selection } = v.state
      if (mark && !(selection instanceof NodeSelection)) {
        const { from, to } = heldSpan(selection, mark)
        if (from !== to) {
          // a selection: highlighted over the text as it's drawn, the text left as it is (the hold plugin)
          const start = v.domAtPos(from)
          const end = v.domAtPos(to)
          const range = document.createRange()
          range.setStart(start.node, start.offset)
          range.setEnd(end.node, end.offset)
          heldRange = range
          heldHighlight()?.add(range)
          mark = false
        }
      }
      // no drawn caret to add or clear: no update (see the hold plugin)
      if (mark === false && holdKey.getState(v.state) === DecorationSet.empty) {
        return
      }
      v.dispatch(v.state.tr.setMeta(holdKey, mark))
    },
    rewritten: () =>
      codec.opened.nodes.map((node) => ({ source: codec.opened.origin.get(node)!.source, written: serialize(node) })),
    dom: () => view().dom,
    destroy: () => void editor.destroy(),
  }
}

/** Enter on an empty last line of a code block: the line goes, and the caret's in a new paragraph below. */
function leaveCode(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const { $from, empty } = state.selection
  const code = $from.parent
  if (
    !empty ||
    code.type.name !== 'code_block' ||
    $from.parentOffset !== code.content.size ||
    !code.textContent.endsWith('\n')
  ) {
    return false
  }
  if (dispatch) {
    const tr = state.tr.delete($from.pos - 1, $from.pos)
    const at = tr.mapping.map($from.after())
    tr.insert(at, state.schema.nodes['paragraph']!.create())
    tr.setSelection(TextSelection.create(tr.doc, at + 1))
    dispatch(tr.scrollIntoView())
  }
  return true
}

/** The toolbar's state where the caret is. */
function selectionOf(state: EditorState): Selection {
  const active = new Set<Action>()
  const { from, to, empty, $from } = state.selection
  const here = state.storedMarks ?? $from.marks()
  let link: string | null = null
  for (const [name, what] of MARKS) {
    const type = state.schema.marks[name]
    if (!type) {
      continue
    }
    const on = empty ? Boolean(type.isInSet(here)) : state.doc.rangeHasMark(from, to, type)
    if (on) {
      active.add(what)
    }
    if (name === 'link') {
      const mark = type.isInSet(empty ? here : ($from.marksAcross(state.selection.$to) ?? here))
      link = (mark?.attrs['href'] as string | undefined) ?? null
    }
  }
  let list = false
  let heading = 0
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    switch (node.type.name) {
      case 'heading':
        active.add('heading')
        heading = node.attrs['level'] as number
        break
      case 'blockquote':
        active.add('quote')
        break
      case 'table':
        active.add('table')
        break
      case 'code_block':
        active.add('code-block')
        break
      case 'list_item':
        if (!list) {
          list = true
          const parent = $from.node(d - 1)
          active.add(
            node.attrs['checked'] != null ? 'tasks' : parent.type.name === 'ordered_list' ? 'numbers' : 'bullets',
          )
        }
        break
    }
  }
  const linkType = state.schema.marks['link']
  const around = empty && linkType ? markRange(state.selection, linkType) : null
  const text = empty
    ? around
      ? state.doc.textBetween(around.from, around.to, ' ')
      : ''
    : state.doc.textBetween(from, to, ' ')
  const tableOff = new Set<TableOp>()
  if (isInTable(state) && !(state.selection instanceof NodeSelection)) {
    const rect = selectedRect(state)
    if (rect.top === 0) {
      tableOff.add('row-above')
      tableOff.add('delete-row')
    }
    // a table keeps its header row and at least one more
    if (rect.map.height <= 2) {
      tableOff.add('delete-row')
    }
  }
  return { active, inTable: isInTable(state), link, text, heading, range: !empty, tableOff, ...unavailable(state) }
}

const ACTIONS_ALL: Action[] = [
  'bold',
  'italic',
  'strike',
  'heading',
  'quote',
  'code',
  'link',
  'bullets',
  'numbers',
  'tasks',
  'table',
  'code-block',
]
const MARKS: Array<[string, Action]> = [
  ['strong', 'bold'],
  ['emphasis', 'italic'],
  ['strike_through', 'strike'],
  ['inlineCode', 'code'],
  ['link', 'link'],
]

/**
 * What the toolbar can't do where the caret is, and why. A block shown as it is (drawn HTML, front
 * matter) takes nothing: it's changed in source view. A code block is plain text: a quote can go around
 * it, nothing else. A table cell holds one paragraph: marks and links, no blocks. Headings and lists
 * don't mix: no list in a heading, no heading in a list.
 */
function unavailable(state: EditorState): { disabled: Set<Action>; why: Partial<Record<Action, string>> } {
  const why: Partial<Record<Action, string>> = {}
  const off = (actions: Action[], reason: string) => {
    for (const action of actions) {
      why[action] ??= reason
    }
  }
  const { selection } = state
  if (selection instanceof NodeSelection && ['ideaf_raw', 'ideaf_html_run'].includes(selection.node.type.name)) {
    const html = selection.node.type.name === 'ideaf_html_run' || selection.node.attrs['kind'] === 'html'
    off(ACTIONS_ALL, html ? 'HTML blocks are only editable in source view' : 'only editable in source view')
  } else if (selection.$from.parent.type.spec.code) {
    off(
      ACTIONS_ALL.filter((a) => a !== 'quote' && a !== 'code-block'),
      'not in a code block',
    )
  } else {
    if (isInTable(state)) {
      off(['heading', 'quote', 'bullets', 'numbers', 'tasks', 'code-block'], 'not in a table')
    }
    if (selection.$from.parent.type.name === 'heading') {
      off(['bullets', 'numbers', 'tasks'], 'not in a heading')
    }
    if (inList(selection.$from)) {
      off(['heading'], 'not in a list')
    }
    // marks where the text can't carry them
    for (const [name, what] of MARKS) {
      const type = state.schema.marks[name]
      if (type && !toggleMark(type)(state)) {
        off([what], 'not here')
      }
    }
  }
  return { disabled: new Set(Object.keys(why) as Action[]), why }
}

const inList = ($pos: Selection_['$from']) => {
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.name === 'list_item') {
      return true
    }
  }
  return false
}

/** How many headings sit in list items: an edit that adds one is refused (they don't mix). */
function headingsInLists(doc: Node): number {
  let count = 0
  const walk = (node: Node, listed: boolean) => {
    node.forEach((child) => {
      if (listed && child.type.name === 'heading') {
        count++
      }
      walk(child, listed || child.type.name === 'list_item')
    })
  }
  walk(doc, false)
  return count
}

/** The extent of the mark of this type around the caret: a whole link, say. */
/** What's held while focus is away: the selection, or for the link box a caret in a link, the link. */
function heldSpan(selection: Selection_, mark: 'selection' | 'link'): { from: number; to: number } {
  const { from, to } = selection
  const link = selection.$from.doc.type.schema.marks['link']
  if (from === to && mark === 'link' && link) {
    return markRange(selection, link) ?? { from, to }
  }
  return { from, to }
}

// the held selection's highlight (MarkdownEditor.css's ::highlight(md-editor-held)), shared by every
// editor on the page, each adding and taking out its own range. None where the browser has no highlights.
const HELD = 'md-editor-held'
function heldHighlight(): Highlight | null {
  if (typeof Highlight === 'undefined' || !('highlights' in CSS)) {
    return null
  }
  let held = CSS.highlights.get(HELD)
  if (!held) {
    held = new Highlight()
    CSS.highlights.set(HELD, held)
  }
  return held
}

function markRange(selection: Selection_, type: MarkType): { from: number; to: number } | null {
  const { $from } = selection
  const start = $from.start()
  const pieces: Array<{ from: number; to: number; mark: ReturnType<MarkType['isInSet']> }> = []
  $from.parent.forEach((child, pos) => {
    pieces.push({ from: start + pos, to: start + pos + child.nodeSize, mark: type.isInSet(child.marks) })
  })
  const i = pieces.findIndex((p) => p.mark && p.from <= $from.pos && $from.pos <= p.to)
  const mark = pieces[i]?.mark
  if (!mark) {
    return null
  }
  let a = i
  let b = i
  while (a > 0 && pieces[a - 1]!.mark?.eq(mark)) {
    a--
  }
  while (b < pieces.length - 1 && pieces[b + 1]!.mark?.eq(mark)) {
    b++
  }
  return { from: pieces[a]!.from, to: pieces[b]!.to }
}

/** A bulleted, numbered or task list: on, off, or turned from one kind into another. */
function toggleList(schema: Schema, kind: 'bullets' | 'numbers' | 'tasks', active: Set<Action>): Command {
  const bullet = schema.nodes['bullet_list']!
  const ordered = schema.nodes['ordered_list']!
  const item = schema.nodes['list_item']!
  const wanted: NodeType = kind === 'numbers' ? ordered : bullet
  // the list around the selection in this doc, and its items given (or rid of) their boxes
  const mark = (tr: Transaction) => {
    const { $from } = tr.selection
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d)
      if (node.type === bullet || node.type === ordered) {
        const pos = $from.before(d)
        tr.setNodeMarkup(pos, wanted, node.type === wanted ? node.attrs : null)
        node.forEach((child, offset) => {
          tr.setNodeMarkup(pos + 1 + offset, undefined, { ...child.attrs, checked: kind === 'tasks' ? false : null })
        })
        return tr
      }
    }
    return tr
  }
  return (state, dispatch) => {
    const current = (['bullets', 'numbers', 'tasks'] as const).find((k) => active.has(k))
    if (current === kind) {
      // off: the items back to paragraphs
      return liftListItem(item)(state, dispatch)
    }
    if (current) {
      dispatch?.(mark(state.tr))
      return true
    }
    return wrapIn(wanted)(state, dispatch && ((tr) => dispatch(mark(tr))))
  }
}

/** Sets the alignment of the caret's column, in every row. */
function alignColumn(view: EditorView, alignment: 'left' | 'center' | 'right') {
  const { state } = view
  const rect = selectedRect(state)
  const tr = state.tr
  for (let row = 0; row < rect.map.height; row++) {
    const cell = rect.map.map[row * rect.map.width + rect.left]!
    const pos = rect.tableStart + cell
    const node = state.doc.nodeAt(pos)
    if (node) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, alignment })
    }
  }
  view.dispatch(tr)
}
