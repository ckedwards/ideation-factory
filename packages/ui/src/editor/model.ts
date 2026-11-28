// The page editor's document, apart from any view: its schema (Milkdown's presets with the draft's
// block identities, and the editor's read-only blocks), how a file is opened as a document, and how a
// document is written back as Markdown, block by block. The editor (milkdown.ts) draws it; the idea's
// actor holds it, in Bun, with no DOM (headless). Nothing here touches the DOM until a node is drawn.
//
// The rule both keep: a block nobody changed is never rewritten. Each top-level node remembers the
// source it was opened from and gives that back while it's unchanged; only a changed block is
// written, in the file's own style.
import { markdownTree, parseMarkdown } from '@ideaf/core'
import {
  commands,
  config,
  editorState,
  init,
  keymap,
  parser,
  parserCtx,
  pasteRule,
  remarkStringifyOptionsCtx,
  schema as schemaPlugin,
  schemaCtx,
  serializer,
  serializerCtx,
} from '@milkdown/kit/core'
import { Clock, Container, Ctx, type MilkdownPlugin } from '@milkdown/kit/ctx'
import {
  blockquoteSchema,
  codeBlockSchema,
  commonmark,
  headingSchema,
  hrSchema,
  paragraphSchema,
  remarkPreserveEmptyLinePlugin,
  syncHeadingIdPlugin,
} from '@milkdown/kit/preset/commonmark'
import { extendListItemSchemaForTask, gfm, tableSchema } from '@milkdown/kit/preset/gfm'
import { Fragment, type Node, type NodeSpec, type Schema } from '@milkdown/kit/prose/model'
import { Step, Transform } from '@milkdown/kit/prose/transform'
import { $nodeSchema } from '@milkdown/kit/utils'
import type { Html, Root, RootContent } from 'mdast'
import { htmlRuns } from '../document/html-runs.ts'
import { tableHandler, tableStyle } from './tables.ts'

/** full: a comment; inline: a suggestion's replacement (marks and links); page: a whole file, in the draft. */
export type Flavor = 'full' | 'inline' | 'page'

/** An empty line between a page's blocks, as it's written: Markdown has none of its own. */
export const EMPTY_LINE_SOURCE = '<br />'
export const EMPTY_LINE = /^\s*<br\s*\/?>\s*$/i

// the kinds core's parser finds that the editor shows as their source
export const RAW = new Set(['yaml', 'definition', 'html'])

/** One top-level block as it was opened: its source, and where it sat in the file. */
export interface Block {
  /** The first and last of the file's top-level blocks it covers: more than one for a run of HTML. */
  index: number
  last: number
  start: number
  end: number
  source: string
}

/** A block that isn't typed in, written back as it is: raw HTML (drawn), or other source (shown as text). Drawn in drawing.ts. */
export const rawSchema = $nodeSchema('ideaf_raw', () => ({
  group: 'block',
  atom: true,
  selectable: true,
  attrs: {
    value: { default: '', validate: 'string' },
    kind: { default: 'source', validate: 'string' },
    // its draft identity, on a page
    blockId: { default: null },
  },
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
export const htmlRunSchema = $nodeSchema('ideaf_html_run', () => ({
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

/** The blocks the draft knows, by node type: the ones that carry an identity. */
export const IDENTIFIED = new Set(['paragraph', 'heading', 'blockquote', 'code_block', 'hr', 'list_item', 'table'])

/** The same node, able to carry a blockId (the editor draws it, drawing.ts). */
function identified<T extends { extendSchema: (h: never) => unknown }>(schema: T): T {
  return (
    schema.extendSchema as unknown as (handler: (prev: (ctx: unknown) => NodeSpec) => (ctx: unknown) => NodeSpec) => T
  )((prev) => (ctx) => {
    const spec = prev(ctx)
    return { ...spec, attrs: { ...spec.attrs, blockId: { default: null } } }
  })
}

/** The draft's blocks, able to carry an identity: used after the presets, in their place. */
export const identifiedNodes = [
  paragraphSchema,
  headingSchema,
  blockquoteSchema,
  codeBlockSchema,
  hrSchema,
  extendListItemSchemaForTask,
  tableSchema,
].map(identified)
export const identifiedSchemas = identifiedNodes.flat() as MilkdownPlugin[]

/** How the file writes what remark could write more than one way. */
export function styleOf(source: string, tree: Root) {
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

export const slice = (source: string, node: RootContent) =>
  source.slice(node.position!.start.offset!, node.position!.end.offset!)

/** A table as GFM reads it: a row's cells past the header's are ignored, so they're dropped. */
export function asWide(table: Node): Node {
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

// Milkdown's empty lines put `<br />` in every empty paragraph, a list item's and a table cell's
// too; a page keeps only its own empty lines, between blocks (write and open). Nor Milkdown's heading
// IDs: each browser works them out for itself and writes them into the document as steps of its own,
// which a live draft would send to everyone (nothing reads them)
export const preset = commonmark.filter(
  (plugin) =>
    plugin !== remarkPreserveEmptyLinePlugin.plugin &&
    plugin !== remarkPreserveEmptyLinePlugin.options &&
    plugin !== syncHeadingIdPlugin,
)

/** The plugins that make the editor's schema: the editor uses them, and the rest of its plugins. */
export const schemaPlugins: MilkdownPlugin[] = [preset, gfm, identifiedSchemas, rawSchema, htmlRunSchema].flat()

/** How the editor writes a changed block, in the file's style: Milkdown's remark-stringify options. */
export function writeOptions<T extends { handlers?: unknown }>(source: string, prev: T) {
  const tree = markdownTree(source)
  return {
    ...prev,
    ...styleOf(source, tree),
    listItemIndent: 'one' as const,
    fences: true,
    // remark-stringify's handler type isn't a dependency here; tableHandler is one
    handlers: { ...(prev.handlers as object), table: tableHandler(tableStyle(source, tree)) as never },
  }
}

/** What a document was opened from: each top-level node's source, and where it sat in the file. */
export interface Opened {
  source: string
  blocks: Block[]
  origin: WeakMap<Node, Block>
  nodes: Node[]
}

/** A file's block as the draft knows it: its identity (null for new text), its Markdown, and the node position that holds the identity. */
export interface IdentifiedBlock {
  id: string | null
  source: string
  at: number | null
}

export interface Codec {
  /** The Markdown as nodes, each remembering the source it came from (and, on a page, its draft identity). */
  open: (source: string, ids?: string[]) => Node
  /** The doc as Markdown: unchanged blocks as they were opened, changed ones written in the file's style. */
  write: (doc: Node, span?: (node: Node, pos: number, start: number, end: number) => void) => string
  /** A top-level node with the draft's IDs for the blocks it holds. */
  identify: (node: Node, ids: Array<string | null>) => Node
  /** A page's blocks as the draft knows them, each with where its identity is held. */
  identities: (doc: Node) => IdentifiedBlock[]
  /** What the last open opened (load keeps it in step when Milkdown tidies what was opened). */
  opened: Opened
}

/** Opening and writing, for one editor or one held document: `opened` is what it last opened. */
export function createCodec(env: {
  schema: Schema
  parse: (markdown: string) => Node
  serialize: (node: Node) => string
  flavor: Flavor
}): Codec {
  const { schema, parse, serialize, flavor } = env
  let opened: Opened = { source: '', blocks: [], origin: new WeakMap(), nodes: [] }

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
    if (flavor === 'inline') {
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
        // an empty line, as a page writes one: drawn as one, to type in
        if (flavor === 'page' && child.type === 'html' && EMPTY_LINE.test(child.value)) {
          out.push({ nodes: [schema.nodes['paragraph']!.create()], first: i, last: i })
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
    // nothing but the empty line a document can't be without: an empty file (a new one, say), not a line
    const only = doc.childCount === 1 ? doc.firstChild! : null
    if (flavor === 'page' && only?.type.name === 'paragraph' && only.content.size === 0 && !opened.origin.has(only)) {
      return ''
    }
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
      // an empty line: Markdown has none, so a page's is written as `<br />`, drawn as one; a
      // comment's closes up, as it does once it's posted
      const empty = node.type.name === 'paragraph' && node.content.size === 0
      const text = empty ? (flavor === 'page' ? EMPTY_LINE_SOURCE : '') : serialize(node)
      if (text) {
        parts.push({ text, from: null, node, pos })
      }
    })
    if (flavor === 'inline') {
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
  function identities(doc: Node): Array<{ id: string | null; source: string; at: number | null }> {
    const { text, spans } = writeSpans(doc)
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

  return {
    open,
    write,
    identify,
    identities,
    get opened() {
      return opened
    },
    set opened(value) {
      opened = value
    },
  }
}

/**
 * The editor's schema, reader and writer with no view, so no DOM: Milkdown's plugins run as
 * Editor.create runs them, without editorView, the only one that draws. Written in `source`'s style.
 */
export async function headless(source: string): Promise<{
  schema: Schema
  parse: (markdown: string) => Node
  serialize: (node: Node) => string
}> {
  const ctx = new Ctx(new Container(), new Clock())
  const configure = config((c) => {
    c.update(remarkStringifyOptionsCtx, (prev) => writeOptions(source, prev))
  })
  const plugins: MilkdownPlugin[] = [
    schemaPlugin,
    parser,
    serializer,
    commands,
    keymap,
    pasteRule,
    editorState,
    // the editor is kept in a slice that nothing here reads
    init({} as never),
    configure,
    ...schemaPlugins,
  ]
  const handlers = plugins.map((plugin) => plugin(ctx.produce()))
  await Promise.all(handlers.map((h) => h()))
  const schema = ctx.get(schemaCtx)
  return {
    schema,
    parse: (markdown) => ctx.get(parserCtx)(markdown),
    serialize: (node) => ctx.get(serializerCtx)(schema.topNodeType.create(null, node)).replace(/\n+$/, ''),
  }
}

/** A file opened as a page editor opens it, with no DOM: its document, and its codec to write it back. */
export async function pageDocument(
  source: string,
  ids: string[],
): Promise<{ schema: Schema; codec: Codec; doc: Node }> {
  const env = await headless(source)
  const codec = createCodec({ ...env, flavor: 'page' })
  return { schema: env.schema, codec, doc: codec.open(source, ids) }
}

export type { Node, Schema } from '@milkdown/kit/prose/model'
export { Fragment } from '@milkdown/kit/prose/model'
export { Step, Transform } from '@milkdown/kit/prose/transform'
export { EditorState } from '@milkdown/kit/prose/state'

/** A node that holds a block's identity, and where: what the draft knows the file's blocks by. */
export interface Holder {
  pos: number
  id: string | null
  node: Node
}

/**
 * The nodes that hold the draft's identities, in order, as `identities` reads them: each top-level
 * block, or a list's items (nested ones too). A run of HTML holds several at once, in `blockIds`, and
 * isn't one of these.
 */
export function holders(doc: Node): Holder[] {
  const out: Holder[] = []
  doc.forEach((node, offset) => {
    const name = node.type.name
    if (name === 'bullet_list' || name === 'ordered_list') {
      node.descendants((n, p) => {
        if (n.type.name === 'list_item') {
          out.push({ pos: offset + 1 + p, id: (n.attrs['blockId'] as string | null) ?? null, node: n })
        }
        return true
      })
      return
    }
    if ('blockId' in node.attrs) {
      out.push({ pos: offset, id: (node.attrs['blockId'] as string | null) ?? null, node })
    }
  })
  return out
}

/** Whether two nodes read the same, whatever their identities. */
export function sameText(a: Node, b: Node): boolean {
  return bare(a).eq(bare(b))
}

/** The same document without identities: what's compared when only the text counts. */
function bare(node: Node): Node {
  if (node.isText) {
    return node
  }
  const content: Node[] = []
  node.forEach((child) => void content.push(bare(child)))
  const attrs =
    'blockId' in node.attrs
      ? { ...node.attrs, blockId: null }
      : 'blockIds' in node.attrs
        ? { ...node.attrs, blockIds: '' }
        : node.attrs
  return node.type.create(attrs, Fragment.from(content), node.marks)
}

/**
 * The steps that make `doc` read as `target` does, and carry its identities: one replace of the range
 * where their text differs (the smallest change: what's the same at either end stays), then each
 * identity set where it differs. A block that only takes another ID is never replaced, so typing in
 * it carries on. None when they're the same.
 */
export function stepsTo(doc: Node, target: Node): Step[] {
  const tr = new Transform(doc)
  const a = bare(doc)
  const b = bare(target)
  const start = a.content.findDiffStart(b.content)
  if (start !== null) {
    let { a: endA, b: endB } = a.content.findDiffEnd(b.content)!
    // what's the same at both ends can overlap where the difference is a repeat (an "a" typed after "a")
    const overlap = start - Math.min(endA, endB)
    if (overlap > 0) {
      endA += overlap
      endB += overlap
    }
    tr.replace(start, endA, target.slice(start, endB))
    if (!bare(tr.doc).eq(b)) {
      return whole(doc, target)
    }
  }
  // the same text: identities where they differ (an attribute changes no position)
  const now = tr.doc
  now.descendants((node, pos) => {
    const other = target.nodeAt(pos)
    if (!other || other.type !== node.type) {
      return true
    }
    for (const attr of ['blockId', 'blockIds']) {
      if (attr in node.attrs && node.attrs[attr] !== other.attrs[attr]) {
        tr.setNodeAttribute(pos, attr, other.attrs[attr])
      }
    }
    return true
  })
  return tr.doc.eq(target) ? tr.steps : whole(doc, target)
}

/** A range ProseMirror fitted differently: the whole content, which always lands. */
function whole(doc: Node, target: Node): Step[] {
  const tr = new Transform(doc)
  tr.replaceWith(0, doc.content.size, target.content)
  return tr.steps
}

/** Steps, as stored (JSON), applied in order. */
export function applySteps(schema: Schema, doc: Node, steps: unknown[]): Node {
  let out = doc
  for (const json of steps) {
    const result = Step.fromJSON(schema, json).apply(out)
    if (!result.doc) {
      throw new Error(`a draft step doesn't apply: ${result.failed}`)
    }
    out = result.doc
  }
  return out
}
