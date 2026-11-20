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
import { markdownTree, parseMarkdown } from '@ideaf/core'
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
  commonmark,
  insertHardbreakCommand,
  listItemKeymap,
  orderedListKeymap,
  remarkPreserveEmptyLinePlugin,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInHeadingCommand,
} from '@milkdown/kit/preset/commonmark'
import {
  addColAfterCommand,
  addColBeforeCommand,
  addRowAfterCommand,
  addRowBeforeCommand,
  gfm,
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
import { $nodeSchema, $prose, $view } from '@milkdown/kit/utils'
import type { Html, Root, RootContent } from 'mdast'
import { htmlRuns, sanitizeHtml, SLOT } from '../document/html.ts'
import { clipboardIdentity, identifiedSchemas, type MovedWords } from './identity.ts'
import { tableHandler, tableStyle } from './tables.ts'

/** full: a comment; inline: a suggestion's replacement (marks and links); page: a whole file, in the draft. */
export type Flavor = 'full' | 'inline' | 'page'

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

// the kinds core's parser finds that the editor shows as their source
const RAW = new Set(['yaml', 'definition', 'html'])

/** One top-level block as it was opened: its source, and where it sat in the file. */
interface Block {
  /** The first and last of the file's top-level blocks it covers: more than one for a run of HTML. */
  index: number
  last: number
  start: number
  end: number
  source: string
}

// the mark on drawn HTML: what it is, and where it's changed
const HTML_LABEL = 'HTML blocks are only editable in source view'
const htmlMark = () => {
  const mark = document.createElement('span')
  mark.className = 'md-editor-html-mark'
  mark.contentEditable = 'false'
  mark.setAttribute('role', 'img')
  mark.setAttribute('aria-label', HTML_LABEL)
  mark.title = HTML_LABEL
  mark.innerHTML =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/></svg>'
  return mark
}

/** A block that isn't typed in, written back as it is: raw HTML (drawn), or other source (shown as text). */
const rawSchema = $nodeSchema('ideaf_raw', () => ({
  group: 'block',
  atom: true,
  selectable: true,
  attrs: {
    value: { default: '', validate: 'string' },
    kind: { default: 'source', validate: 'string' },
    // its draft identity, on a page
    blockId: { default: null },
  },
  toDOM: (node) => {
    const value = node.attrs['value'] as string
    const id = node.attrs['blockId'] as string | null
    if (node.attrs['kind'] !== 'html') {
      return ['pre', { class: 'md-editor-raw', 'data-raw': 'source', ...(id ? { 'data-block-id': id } : {}) }, value]
    }
    const dom = document.createElement('div')
    if (id) {
      dom.setAttribute('data-block-id', id)
    }
    dom.className = 'md-editor-html'
    dom.setAttribute('data-raw', 'html')
    dom.setAttribute('data-value', value)
    const drawn = document.createElement('div')
    drawn.className = 'md-html-drawn'
    drawn.innerHTML = sanitizeHtml(value)
    dom.append(htmlMark(), drawn)
    return dom
  },
  parseDOM: [
    {
      tag: '[data-raw]',
      getAttrs: (dom) => ({
        value: (dom as HTMLElement).getAttribute('data-value') ?? (dom as HTMLElement).textContent ?? '',
        kind: (dom as HTMLElement).getAttribute('data-raw') === 'html' ? 'html' : 'source',
        blockId: (dom as HTMLElement).getAttribute('data-block-id'),
      }),
    },
  ],
  parseMarkdown: {
    match: (node) => node.type === 'ideafRaw',
    runner: (state, node, type) => {
      state.addNode(type, { value: node['value'] as string })
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'ideaf_raw',
    runner: (state, node) => {
      state.addNode('html', undefined, node.attrs['value'] as string)
    },
  },
}))

/**
 * An HTML block left open and the one that closes it, drawn as one with the blocks between inside. It's
 * read only, whole: one unit, selected and deleted as one, changed on the Markdown side.
 */
const htmlRunSchema = $nodeSchema('ideaf_html_run', () => ({
  group: 'block',
  content: 'block*',
  atom: true,
  selectable: true,
  defining: true,
  isolating: true,
  attrs: {
    open: { default: '', validate: 'string' },
    close: { default: '', validate: 'string' },
    // the draft identities of the blocks it covers, on a page, space apart
    blockIds: { default: '', validate: 'string' },
  },
  toDOM: (node) => [
    'div',
    {
      'data-html-open': node.attrs['open'] as string,
      'data-html-close': node.attrs['close'] as string,
      ...(node.attrs['blockIds'] ? { 'data-block-ids': node.attrs['blockIds'] as string } : {}),
    },
    0,
  ],
  parseDOM: [
    {
      tag: 'div[data-html-open][data-html-close]',
      getAttrs: (dom) => ({
        open: (dom as HTMLElement).getAttribute('data-html-open') ?? '',
        close: (dom as HTMLElement).getAttribute('data-html-close') ?? '',
        blockIds: (dom as HTMLElement).getAttribute('data-block-ids') ?? '',
      }),
    },
  ],
  parseMarkdown: {
    match: (node) => node.type === 'ideafHtmlRun',
    runner: (state, node, type) => {
      state.openNode(type, { open: node['open'] as string, close: node['close'] as string })
      state.next(node.children ?? [])
      state.closeNode()
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'ideaf_html_run',
    runner: (state, node) => {
      state.addNode('html', undefined, node.attrs['open'] as string)
      state.next(node.content)
      state.addNode('html', undefined, node.attrs['close'] as string)
    },
  },
}))

// a run drawn as its HTML with the blocks between where it left off, none of it typed in
const htmlRunView = $view(htmlRunSchema.node, () => (node) => {
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

/** How the file writes what remark could write more than one way. */
function styleOf(source: string, tree: Root) {
  const at = (node: RootContent | undefined) => (node?.position ? source.charAt(node.position.start.offset ?? 0) : '')
  const first = <T extends RootContent['type']>(type: T): Extract<RootContent, { type: T }> | undefined => {
    let found: RootContent | undefined
    const walk = (nodes: RootContent[]) => {
      for (const node of nodes) {
        if (found) {
          return
        }
        if (node.type === type) {
          found = node
          return
        }
        if ('children' in node) {
          walk(node.children as RootContent[])
        }
      }
    }
    walk(tree.children)
    return found as Extract<RootContent, { type: T }> | undefined
  }
  const list = first('list')
  const bullet = list && !list.ordered ? at(list) : ''
  const ordered = (() => {
    if (!list?.ordered || !list.position) {
      return undefined
    }
    const lines = source
      .slice(list.position.start.offset ?? 0, list.position.end.offset ?? 0)
      .split('\n')
      .filter((line) => /^\s*\d+[.)]\s/.test(line))
    return lines.length > 1 && lines.every((line) => /^\s*1[.)]\s/.test(line)) ? 'same' : 'increment'
  })()
  const emphasis = at(first('emphasis'))
  const strong = at(first('strong'))
  const rule = at(first('thematicBreak'))
  return {
    bullet: (bullet === '*' || bullet === '+' ? bullet : '-') as '-' | '*' | '+',
    emphasis: (emphasis === '_' ? '_' : '*') as '_' | '*',
    strong: (strong === '_' ? '_' : '*') as '_' | '*',
    rule: (rule === '*' || rule === '_' ? rule : '-') as '-' | '*' | '_',
    incrementListMarker: ordered !== 'same',
  }
}

const slice = (source: string, node: RootContent) =>
  source.slice(node.position!.start.offset!, node.position!.end.offset!)

export async function createRichEditor(options: RichOptions): Promise<RichEditor> {
  const tree = markdownTree(options.source)
  const style = styleOf(options.source, tree)
  const latest = { options }
  let opened: { source: string; blocks: Block[]; origin: WeakMap<Node, Block>; nodes: Node[] } = {
    source: '',
    blocks: [],
    origin: new WeakMap(),
    nodes: [],
  }
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

  const preset = commonmark.filter(
    (plugin) => plugin !== remarkPreserveEmptyLinePlugin.plugin && plugin !== remarkPreserveEmptyLinePlugin.options,
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
      ctx.update(remarkStringifyOptionsCtx, (prev) => ({
        ...prev,
        ...style,
        listItemIndent: 'one' as const,
        fences: true,
        // remark-stringify's handler type isn't a dependency here; tableHandler is one
        handlers: { ...prev.handlers, table: tableHandler(tableStyle(options.source, tree)) as never },
      }))
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
    .use(preset)
    .use(gfm)
    // the draft's blocks can carry their identity (identity.ts)
    .use(identifiedSchemas)
    .use(rawSchema)
    .use(htmlRunSchema)
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

  /** The Markdown as blocks on screen, each remembering the source it came from (and, on a page, its draft identity). */
  function open(source: string, ids?: string[]): Node {
    // the draft's blocks, as core finds them, with their IDs: for the nodes built from them
    const units = ids
      ? parseMarkdown(source).units.map((u, i) => ({ start: u.start, kind: u.kind, id: ids[i] ?? null }))
      : []
    const tree = markdownTree(source)
    const origin = new WeakMap<Node, Block>()
    const blocks: Block[] = []
    const nodes: Node[] = []
    if (options.flavor === 'inline') {
      // one paragraph, whatever the text starts with: a leading "- " or "# " is text here, not a block
      const paragraph = parse(`x ${source.replace(/\n+/g, ' ')}`).firstChild
      const content = paragraph?.type.name === 'paragraph' ? paragraph.content.cut(2) : Fragment.empty
      const node = schema.nodes['paragraph']!.create(null, content)
      const block = { index: 0, last: 0, start: 0, end: source.length, source }
      origin.set(node, block)
      opened = { source, blocks: [block], origin, nodes: [node] }
      return schema.topNodeType.create(null, node)
    }
    const definitions = tree.children
      .filter((n) => n.type === 'definition')
      .map((n) => slice(source, n))
      .join('\n')
    tree.children.forEach((child, index) => {
      blocks.push({
        index,
        last: index,
        start: child.position!.start.offset!,
        end: child.position!.end.offset!,
        source: slice(source, child),
      })
    })
    // sibling blocks as nodes, each with the range of them it came from (an HTML run covers several)
    const build = (children: RootContent[]): Array<{ nodes: Node[]; first: number; last: number }> => {
      const draws = htmlRuns(children)
      const out: Array<{ nodes: Node[]; first: number; last: number }> = []
      for (let i = 0; i < children.length; i++) {
        const child = children[i]!
        const draw = draws.get(i)
        if (draw?.draw === 'run') {
          const inside = build(children.slice(i + 1, draw.to)).flatMap((b) => b.nodes)
          const run = schema.nodes['ideaf_html_run']!.create(
            { open: (child as Html).value, close: (children[draw.to] as Html).value },
            inside,
          )
          out.push({ nodes: [run], first: i, last: draw.to })
          i = draw.to
          continue
        }
        if (RAW.has(child.type)) {
          const kind = draw?.draw === 'alone' ? 'html' : 'source'
          out.push({
            nodes: [schema.nodes['ideaf_raw']!.create({ value: slice(source, child), kind })],
            first: i,
            last: i,
          })
          continue
        }
        // a reference link needs the file's definitions to be read as a link
        const text = slice(source, child)
        const doc = parse(definitions && text.includes('[') ? `${text}\n\n${definitions}` : text)
        const parsed: Node[] = []
        doc.forEach((node) => void parsed.push(node.type.name === 'table' ? asWide(node) : node))
        out.push({ nodes: parsed, first: i, last: i })
      }
      return out
    }
    for (const built of build(tree.children)) {
      if (built.nodes.length === 1) {
        const first = blocks[built.first]!
        const last = blocks[built.last]!
        if (ids) {
          const within = units.filter((u) => u.start >= first.start && u.start < last.end).map((u) => u.id)
          built.nodes[0] = identify(built.nodes[0]!, within)
        }
        origin.set(built.nodes[0]!, {
          index: first.index,
          last: last.index,
          start: first.start,
          end: last.end,
          source: source.slice(first.start, last.end),
        })
      }
      nodes.push(...built.nodes)
    }
    opened = { source, blocks, origin, nodes: nodes.filter((n) => origin.has(n)) }
    return schema.topNodeType.create(null, nodes.length > 0 ? nodes : schema.nodes['paragraph']!.create())
  }

  /** The doc as Markdown: unchanged blocks as they were opened, changed ones written in the file's style. */
  function write(doc: Node, span?: (node: Node, pos: number, start: number, end: number) => void): string {
    const used = new Set<Block>()
    const parts: Array<{ text: string; from: Block | null; node: Node; pos: number }> = []
    doc.forEach((node, pos) => {
      let from = opened.origin.get(node) ?? null
      if (!from || used.has(from)) {
        // changed and changed back: as good as unchanged
        const same = opened.nodes.find((n) => !used.has(opened.origin.get(n)!) && n.eq(node))
        from = same ? opened.origin.get(same)! : null
      }
      if (from) {
        used.add(from)
        parts.push({ text: from.source, from, node, pos })
        return
      }
      const text = node.type.name === 'paragraph' && node.content.size === 0 ? '' : serialize(node)
      if (text) {
        parts.push({ text, from: null, node, pos })
      }
    })
    if (options.flavor === 'inline') {
      return parts.map((p) => p.text).join(' ')
    }
    const { source, blocks } = opened
    let out = ''
    parts.forEach((part, i) => {
      const before = parts[i - 1]
      if (i === 0) {
        out += part.from?.index === 0 ? source.slice(0, part.from.start) : ''
      } else if (before?.from && part.from && part.from.index === before.from.last + 1) {
        out += source.slice(before.from.end, part.from.start)
      } else {
        out += '\n\n'
      }
      span?.(part.node, part.pos, out.length, out.length + part.text.length)
      out += part.text
    })
    const last = parts.at(-1)?.from
    if (last && last.last === blocks.length - 1) {
      out += source.slice(last.end)
    }
    return out
  }

  /**
   * A top-level node with the draft's IDs for the blocks it holds: a list's items each their own, a
   * run of HTML all of them, anything else the one.
   */
  function identify(node: Node, ids: Array<string | null>): Node {
    const name = node.type.name
    if (name === 'ideaf_html_run') {
      return node.type.create({ ...node.attrs, blockIds: ids.filter(Boolean).join(' ') }, node.content, node.marks)
    }
    if (name === 'bullet_list' || name === 'ordered_list') {
      const items: Node[] = []
      node.descendants((n) => {
        if (n.type.name === 'list_item') {
          items.push(n)
        }
        return true
      })
      if (items.length !== ids.length) {
        return node
      }
      let next = 0
      const walk = (n: Node): Node => {
        const content: Node[] = []
        n.forEach((child) => void content.push(child.isText ? child : walk(child)))
        const attrs = n.type.name === 'list_item' ? { ...n.attrs, blockId: ids[next++] ?? null } : n.attrs
        return n.type.create(attrs, Fragment.from(content), n.marks)
      }
      return walk(node)
    }
    return 'blockId' in node.attrs
      ? node.type.create({ ...node.attrs, blockId: ids[0] ?? null }, node.content, node.marks)
      : node
  }

  /** The doc as Markdown, and where each top-level node's Markdown is in it. */
  function writeSpans(doc: Node): {
    text: string
    spans: Array<{ node: Node; pos: number; start: number; end: number }>
  } {
    const spans: Array<{ node: Node; pos: number; start: number; end: number }> = []
    const text = write(doc, (node, pos, start, end) => void spans.push({ node, pos, start, end }))
    return { text, spans }
  }

  /** A page's blocks as the draft knows them, each with where its identity is held (null for none). */
  function identities(): Array<{ id: string | null; source: string; at: number | null }> {
    const { text, spans } = writeSpans(view().state.doc)
    const units = parseMarkdown(text).units
    const out: Array<{ id: string | null; source: string; at: number | null }> = []
    for (const span of spans) {
      const mine = units.filter((u) => u.start >= span.start && u.start < span.end)
      // who holds each unit's identity in this node: its list items, its run, or itself
      const holders: Array<{ id: string | null; at: number | null }> = []
      const name = span.node.type.name
      if (name === 'bullet_list' || name === 'ordered_list') {
        span.node.descendants((n, p) => {
          if (n.type.name === 'list_item') {
            holders.push({ id: (n.attrs['blockId'] as string | null) ?? null, at: span.pos + 1 + p })
          }
          return true
        })
      } else if (name === 'ideaf_html_run') {
        const ids = (span.node.attrs['blockIds'] as string).split(' ').filter(Boolean)
        ids.forEach((id) => holders.push({ id, at: null }))
      } else {
        holders.push({ id: (span.node.attrs['blockId'] as string | null | undefined) ?? null, at: span.pos })
      }
      const matched = holders.length === mine.length
      mine.forEach((u, i) => {
        const holder = matched ? holders[i]! : i === 0 && holders.length === 1 ? holders[0]! : { id: null, at: null }
        out.push({ id: holder.id, source: text.slice(u.start, u.end), at: holder.at })
      })
    }
    return out
  }

  const blocks = () => identities().map(({ id, source }) => ({ id, source }))

  /** New blocks take the identities the draft gave them: its blocks not on screen, matched by their text. */
  function adopt(units: Array<{ id: string; source: string }>): void {
    const current = identities()
    const held = new Set(current.flatMap((b) => (b.id ? [b.id] : [])))
    const free = units.filter((u) => !held.has(u.id))
    const v = view()
    const tr = v.state.tr
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
    if (tr.docChanged) {
      // the same text: nothing to tell the page
      loading = true
      v.dispatch(tr.setMeta('addToHistory', false))
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
    const doc = open(source, ids)
    const tr = v.state.tr.replaceWith(0, v.state.doc.content.size, doc.content).setMeta('addToHistory', false)
    // the caret at the end of the text, or at its start when it ends in a block that isn't typed in
    tr.setSelection(tr.doc.lastChild?.isTextblock ? TextSelection.atEnd(tr.doc) : TextSelection.atStart(tr.doc))
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
        const block = opened.origin.get(doc.child(i))
        if (block) {
          origin.set(node, block)
          nodes.push(node)
        }
      })
      opened = { ...opened, origin, nodes }
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
      opened.nodes.map((node) => ({ source: opened.origin.get(node)!.source, written: serialize(node) })),
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

/** A table as GFM reads it: a row's cells past the header's are ignored, so they're dropped. */
function asWide(table: Node): Node {
  const width = table.firstChild?.childCount ?? 0
  let trimmed = false
  const rows: Node[] = []
  table.forEach((row) => {
    if (row.childCount > width) {
      trimmed = true
      const cells: Node[] = []
      row.forEach((cell, _, i) => {
        if (i < width) {
          cells.push(cell)
        }
      })
      rows.push(row.copy(Fragment.from(cells)))
    } else {
      rows.push(row)
    }
  })
  return trimmed ? table.copy(Fragment.from(rows)) : table
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
