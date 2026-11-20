// A Markdown file, rendered from core's syntax tree (markdownTree), so what's
// shown and where comments land come from one parser. It renders the tree to
// React elements directly: Markdown never becomes an HTML string. Raw HTML in a
// file is drawn only once it's sanitized to a short allowlist (html.ts), and
// never run; HTML that doesn't make sense alone is shown as its source.
//
// Every block carries its source offsets (data-start, data-end), which is how
// the page maps between the document and comment anchors, sections and edits.
import { markdownTree } from '@ideaf/core'
import type { Code, Definition, Html, Nodes, PhrasingContent, Root, RootContent, Table } from 'mdast'
import { Fragment, type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { htmlRuns, openCount, sanitizeHtml, SLOT } from './html.ts'
import { Link } from '../link/Link.tsx'
import { defaultImage, type ExternalImages, type ImageMedia, MarkdownImage } from './MarkdownImage.tsx'
import type { Deletion, RedlineBlock, SourceRange } from './redline.ts'
import './MarkdownView.css'

// A comment on some text: a range of source offsets, marked in the document.
export interface MarkdownMark {
  id: string
  start: number
  end: number
  active?: boolean
  resolved?: boolean
}

// A comment on a whole section: the source offset where its heading starts.
export interface SectionMark {
  id: string
  heading: number
  active?: boolean
  resolved?: boolean
}

// Where a link goes. internal: another file in the idea, or a heading in this
// one. missing: a file the idea doesn't have.
export interface ResolvedLink {
  href: string
  kind: 'internal' | 'external' | 'missing'
}

export interface MarkdownViewProps {
  tree: Root
  marks?: MarkdownMark[]
  sectionMarks?: SectionMark[]
  // source ranges changed against the target, shown as a rail in the margin
  changed?: { start: number; end: number }[]
  // where a link's URL goes; by default, as written
  resolveLink?: (url: string) => ResolvedLink
  // what an image's URL is in the version shown: uploaded, not uploaded (and
  // why), or on another site; by default, web addresses are external
  image?: (url: string) => ImageMedia
  // the deployment's setting for images from other sites; click by default
  externalImages?: ExternalImages
  // draws a code block itself (a Mermaid diagram), or undefined to show the code
  renderCode?: (code: Code) => ReactNode | undefined
  onMarkClick?: (id: string) => void
  // before every id it gives headings and footnotes, when a page shows two files
  idPrefix?: string
  // compact: smaller, for a comment's text
  variant?: 'document' | 'compact'
  // shows these blocks, a redline, instead of the tree's; use Redline
  redline?: {
    blocks: RedlineBlock[]
    // the older file's tree, for its link definitions
    base: Root
    // what an image's URL was in the older version
    baseImage?: (url: string) => ImageMedia
  }
}

interface Context extends Required<Pick<MarkdownViewProps, 'marks' | 'resolveLink' | 'image' | 'externalImages'>> {
  props: MarkdownViewProps
  definitions: Map<string, Definition>
  // shared by both files of a redline, so numbers and IDs don't repeat
  counters: { footnotes: Map<string, number>; slugs: Map<string, number>; tables: number }
  // the word changes of the block being drawn, in a redline
  edit: { inserted: SourceRange[]; deleted: Deletion[]; shown: Set<Deletion> } | null
}

export function defaultResolveLink(url: string): ResolvedLink {
  return { href: url, kind: /^(https?:|mailto:)/i.test(url) ? 'external' : 'internal' }
}

export function MarkdownView(props: MarkdownViewProps) {
  const { tree, marks = [], resolveLink = defaultResolveLink, image = defaultImage, externalImages = 'click' } = props
  const ctx: Context = {
    props,
    marks,
    resolveLink,
    image,
    externalImages,
    definitions: collectDefinitions(tree),
    counters: { footnotes: new Map(), slugs: new Map(), tables: 0 },
    edit: null,
  }
  return (
    <div
      className={props.variant === 'compact' ? 'prose prose-compact' : 'prose'}
      onClick={(event) => {
        const mark = (event.target as HTMLElement).closest<HTMLElement>('[data-comment-id]')
        if (mark?.dataset['commentId']) {
          props.onMarkClick?.(mark.dataset['commentId'])
        }
      }}
    >
      {props.redline
        ? props.redline.blocks.map((item, i) => redlineBlock(item, ctx, i))
        : blocks(tree.children, ctx, true)}
    </div>
  )
}

/**
 * Markdown that's a run of text, a suggested edit's old or new words say, drawn inline: its bold,
 * code and links, with no paragraph around them. Null if it's more than one paragraph (a list, two
 * paragraphs), which doesn't go inside a line.
 */
export function inlineMarkdown(source: string): ReactNode | null {
  if (source.trim() === '') {
    return ''
  }
  const tree = markdownTree(source)
  const [only] = tree.children
  if (tree.children.length !== 1 || only?.type !== 'paragraph') {
    return null
  }
  const ctx: Context = {
    props: { tree },
    marks: [],
    resolveLink: defaultResolveLink,
    image: defaultImage,
    externalImages: 'click',
    definitions: collectDefinitions(tree),
    counters: { footnotes: new Map(), slugs: new Map(), tables: 0 },
    edit: null,
  }
  return inline(only.children, ctx)
}

// One block of a redline. Every change has a rail in the margin and words for
// screen readers; deleted text is struck through and inserted text underlined,
// so none of it relies on color.
function redlineBlock(item: RedlineBlock, ctx: Context, key: number): ReactNode {
  const redline = ctx.props.redline!
  // the older file's blocks: its definitions and images, and no comments
  const old: Context = {
    ...ctx,
    marks: [],
    props: { ...ctx.props, sectionMarks: [], changed: [] },
    definitions: collectDefinitions(redline.base),
    image: redline.baseImage ?? ctx.image,
  }
  const said = (text: string) => <span className="visually-hidden">{text}</span>
  switch (item.kind) {
    case 'same':
      return block(item.node, ctx, key, true)
    case 'added':
      return (
        <div key={key} className="rl rl-added">
          {said('Added: ')}
          {block(item.node, ctx, 0)}
        </div>
      )
    case 'removed':
      return (
        <div key={key} className="rl rl-removed">
          {said('Removed: ')}
          {block(item.node, old, 0)}
        </div>
      )
    case 'edited': {
      ctx.edit = { inserted: item.inserted, deleted: item.deleted, shown: new Set() }
      const drawn = block(item.node, ctx, 0)
      // text taken out where nothing was left to show it in (only Markdown around it)
      const left = item.deleted.filter((deletion) => !ctx.edit!.shown.has(deletion))
      ctx.edit = null
      return (
        <div key={key} className="rl rl-edited">
          {said('Edited: ')}
          {drawn}
          {left.length > 0 && <p>{left.map((deletion, i) => deleted(deletion, i))}</p>}
        </div>
      )
    }
    case 'moved':
      return (
        <div key={key} className="rl rl-moved">
          <span className="rl-tag">Moved here</span>
          {block(item.node, ctx, 0)}
        </div>
      )
    case 'moved-from':
      return (
        <p key={key} className="rl-moved-from">
          Moved {item.down ? 'down' : 'up'}: {item.label} <span aria-hidden>{item.down ? '↓' : '↑'}</span>
        </p>
      )
    case 'image-changed':
      return (
        <div key={key} className="rl rl-image">
          <span className="rl-tag">Image changed</span>
          <div className="rl-image-pair">
            <div className="rl-image-before">
              <span className="rl-image-label">Before</span>
              {block(item.before, old, 0)}
            </div>
            <div className="rl-image-after">
              <span className="rl-image-label">After</span>
              {block(item.node, ctx, 0)}
            </div>
          </div>
        </div>
      )
  }
}

function deleted(deletion: Deletion, key: number): ReactNode {
  return (
    <del key={`del-${key}`}>
      <span className="visually-hidden">[deleted: </span>
      {deletion.text}
      <span className="visually-hidden">]</span>
    </del>
  )
}

function collectDefinitions(tree: Root): Map<string, Definition> {
  const out = new Map<string, Definition>()
  const visit = (node: Nodes) => {
    if (node.type === 'definition') {
      out.set(node.identifier, node)
    }
    if ('children' in node) {
      for (const child of node.children) {
        visit(child)
      }
    }
  }
  visit(tree)
  return out
}

function offsets(node: Nodes): { 'data-start'?: number; 'data-end'?: number } {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  return start === undefined || end === undefined ? {} : { 'data-start': start, 'data-end': end }
}

function isChanged(node: Nodes, ctx: Context): boolean {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start === undefined || end === undefined) {
    return false
  }
  return (ctx.props.changed ?? []).some((range) => range.start < end && start < range.end)
}

export function plainText(node: Nodes): string {
  if ('value' in node && node.type !== 'html' && node.type !== 'yaml') {
    return node.value
  }
  if ('children' in node) {
    return node.children.map((child) => plainText(child)).join('')
  }
  return ''
}

export interface HeadingInfo {
  // the id MarkdownView gives it, to link or jump to
  id: string
  title: string
  level: number
  // where it starts in the source
  offset: number
}

/** Every heading in a tree, in order, with the id MarkdownView gives it: for a table of contents. */
export function headings(tree: Root, idPrefix?: string): HeadingInfo[] {
  const slugs = new Map<string, number>()
  const out: HeadingInfo[] = []
  const visit = (node: Nodes) => {
    if (node.type === 'heading') {
      const title = plainText(node)
      out.push({
        id: slugFor(title, slugs, idPrefix),
        title,
        level: node.depth,
        offset: node.position?.start.offset ?? 0,
      })
    } else if ('children' in node) {
      node.children.forEach(visit)
    }
  }
  visit(tree)
  return out
}

function slug(text: string, ctx: Context): string {
  return slugFor(text, ctx.counters.slugs, ctx.props.idPrefix)
}

// GitHub's style: lowercase, punctuation dropped, spaces to hyphens, repeats numbered
function slugFor(text: string, slugs: Map<string, number>, idPrefix = ''): string {
  const base =
    text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s/g, '-') || 'section'
  const seen = slugs.get(base) ?? 0
  slugs.set(base, seen + 1)
  return `${idPrefix}${seen === 0 ? base : `${base}-${seen}`}`
}

/** Sibling blocks, with an HTML block that's left open drawn as one with the blocks up to its close. */
function blocks(nodes: RootContent[], ctx: Context, top = false): ReactNode[] {
  const draws = htmlRuns(nodes)
  const out: ReactNode[] = []
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    const draw = draws.get(i)
    if (draw?.draw === 'run') {
      out.push(
        <HtmlRun
          key={i}
          open={(node as Html).value}
          close={(nodes[draw.to] as Html).value}
          className={top && isChanged(node, ctx) ? 'is-changed' : undefined}
          at={offsets(node)}
        >
          {blocks(nodes.slice(i + 1, draw.to), ctx, top)}
        </HtmlRun>,
      )
      i = draw.to
      continue
    }
    out.push(block(node, ctx, i, top))
  }
  return out
}

/**
 * Raw HTML, sanitized and drawn. With `close`, it's an opening block and its closing one, and the
 * blocks between (children) go inside, where the opening one left off.
 */
function HtmlRun(props: {
  open: string
  close?: string
  children?: ReactNode
  className?: string | undefined
  at: ReturnType<typeof offsets>
}) {
  const host = useRef<HTMLDivElement>(null)
  const html = useMemo(
    () => sanitizeHtml(props.close === undefined ? props.open : `${props.open}<div ${SLOT}></div>${props.close}`),
    [props.open, props.close],
  )
  // where the blocks between go: undefined until it's been looked for
  const [slot, setSlot] = useState<Element | null | undefined>(undefined)
  useLayoutEffect(() => {
    setSlot(host.current?.querySelector(`[${SLOT}]`) ?? null)
  }, [html])
  return (
    <>
      <div
        ref={host}
        className={['md-html-drawn', props.className].filter(Boolean).join(' ')}
        {...props.at}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {props.children !== undefined &&
        (slot ? createPortal(props.children, slot) : slot === null ? props.children : null)}
    </>
  )
}

function block(node: RootContent, ctx: Context, key: number, top = false): ReactNode {
  const changed = top && isChanged(node, ctx) ? 'is-changed' : undefined
  const at = offsets(node)
  switch (node.type) {
    case 'heading': {
      const Tag = `h${node.depth}` as const
      const start = node.position?.start.offset
      const section = (ctx.props.sectionMarks ?? []).find((mark) => mark.heading === start)
      const classes = [
        changed,
        section && 'md-section-mark',
        section?.active && 'is-active',
        section?.resolved && 'is-resolved',
      ]
      return (
        <Tag
          key={key}
          id={slug(plainText(node), ctx)}
          className={classes.filter(Boolean).join(' ') || undefined}
          data-comment-id={section?.id}
          {...at}
        >
          {inline(node.children, ctx)}
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p key={key} className={changed} {...at}>
          {inline(node.children, ctx)}
        </p>
      )
    case 'blockquote':
      return (
        <blockquote key={key} className={changed} {...at}>
          {blocks(node.children, ctx)}
        </blockquote>
      )
    case 'list': {
      const items = node.children.map((item, i) => (
        <li key={i} className={item.checked != null ? 'md-task' : undefined} {...offsets(item)}>
          {item.checked != null && (
            <input type="checkbox" checked={item.checked} disabled aria-label={item.checked ? 'Done' : 'To do'} />
          )}
          {item.children.map((child, j) =>
            // a tight list's paragraphs are just its text
            child.type === 'paragraph' && !node.spread ? (
              <span key={j} {...offsets(child)}>
                {inline(child.children, ctx)}
              </span>
            ) : (
              block(child, ctx, j)
            ),
          )}
        </li>
      ))
      return node.ordered ? (
        <ol key={key} className={changed} start={node.start ?? undefined} {...at}>
          {items}
        </ol>
      ) : (
        <ul key={key} className={changed} {...at}>
          {items}
        </ul>
      )
    }
    case 'code': {
      const drawn = ctx.props.renderCode?.(node)
      if (drawn !== undefined) {
        return (
          <div key={key} className={changed} {...at}>
            {drawn}
          </div>
        )
      }
      return (
        // focusable, so a keyboard can scroll a long line into view
        <pre key={key} className={changed} tabIndex={0} {...at}>
          <code data-lang={node.lang ?? undefined}>{marked(node.value, node, ctx)}</code>
        </pre>
      )
    }
    case 'table':
      return (
        // a region you can tab to, so a keyboard can scroll a wide table
        <div
          key={key}
          className={['md-table', changed].filter(Boolean).join(' ')}
          role="region"
          aria-label={tableLabel(node, ctx)}
          tabIndex={0}
          {...at}
        >
          <table>
            <thead>
              <tr>
                {node.children[0]?.children.map((cell, i) => {
                  const style = { textAlign: node.align?.[i] ?? undefined }
                  // an empty corner cell heads nothing, so it isn't a header
                  return cell.children.length === 0 ? (
                    <td key={i} style={style} {...offsets(cell)} />
                  ) : (
                    <th key={i} style={style} {...offsets(cell)}>
                      {inline(cell.children, ctx)}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {node.children.slice(1).map((row, r) => (
                <tr key={r}>
                  {row.children.map((cell, i) => (
                    <td key={i} style={{ textAlign: node.align?.[i] ?? undefined }} {...offsets(cell)}>
                      {inline(cell.children, ctx)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'thematicBreak':
      return <hr key={key} {...at} />
    case 'html':
      // drawn, sanitized, when it makes sense alone; otherwise shown as its source
      return openCount(node.value) === 0 ? (
        <HtmlRun key={key} open={node.value} className={changed} at={at} />
      ) : (
        <pre key={key} className={['md-html', changed].filter(Boolean).join(' ')} tabIndex={0} {...at}>
          <code>{node.value}</code>
        </pre>
      )
    case 'footnoteDefinition': {
      const number = footnoteNumber(node.identifier, ctx)
      return (
        <div
          key={key}
          className={['md-footnote', changed].filter(Boolean).join(' ')}
          id={footnoteId(node.identifier, ctx)}
          {...at}
        >
          <span className="md-footnote-label">{number}.</span>
          <div>{blocks(node.children, ctx)}</div>
        </div>
      )
    }
    // front matter and link definitions aren't shown
    case 'yaml':
    case 'definition':
      return null
    default:
      return null
  }
}

// "Table 2: Case, What happens, Who decides": numbered, so each is distinct
function tableLabel(node: Table, ctx: Context): string {
  ctx.counters.tables += 1
  const headers = (node.children[0]?.children ?? []).map((cell) => plainText(cell).trim()).filter(Boolean)
  return `Table ${ctx.counters.tables}${headers.length > 0 ? `: ${headers.join(', ')}` : ''}`
}

function footnoteNumber(identifier: string, ctx: Context): number {
  const known = ctx.counters.footnotes.get(identifier)
  if (known !== undefined) {
    return known
  }
  const next = ctx.counters.footnotes.size + 1
  ctx.counters.footnotes.set(identifier, next)
  return next
}

function footnoteId(identifier: string, ctx: Context): string {
  return `${ctx.props.idPrefix ?? ''}fn-${identifier.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`
}

function inline(nodes: PhrasingContent[], ctx: Context): ReactNode[] {
  return nodes.map((node, i) => phrasing(node, ctx, i))
}

function phrasing(node: PhrasingContent, ctx: Context, key: number): ReactNode {
  switch (node.type) {
    case 'text':
      return (
        <span key={key} {...textOffsets(node.value, node)}>
          {marked(node.value, node, ctx)}
        </span>
      )
    case 'emphasis':
      return <em key={key}>{inline(node.children, ctx)}</em>
    case 'strong':
      return <strong key={key}>{inline(node.children, ctx)}</strong>
    // <s>, not <del>: del is the redline's deleted text
    case 'delete':
      return <s key={key}>{inline(node.children, ctx)}</s>
    case 'inlineCode':
      return (
        <code key={key} {...textOffsets(node.value, node)}>
          {marked(node.value, node, ctx)}
        </code>
      )
    case 'break':
      return <br key={key} />
    case 'link':
      return link(node.url, node.title, inline(node.children, ctx), ctx, key)
    case 'linkReference': {
      const definition = ctx.definitions.get(node.identifier)
      const children = inline(node.children, ctx)
      return definition ? link(definition.url, definition.title, children, ctx, key) : <span key={key}>{children}</span>
    }
    case 'image':
      return image(node.url, node.alt, ctx, key)
    case 'imageReference': {
      const definition = ctx.definitions.get(node.identifier)
      return definition ? image(definition.url, node.alt, ctx, key) : <span key={key}>{node.alt}</span>
    }
    case 'footnoteReference':
      return (
        <sup key={key} className="md-footnote-ref">
          <a href={`#${footnoteId(node.identifier, ctx)}`}>{footnoteNumber(node.identifier, ctx)}</a>
        </sup>
      )
    case 'html':
      return <code key={key}>{node.value}</code>
    default:
      return null
  }
}

function link(url: string, title: string | null | undefined, children: ReactNode, ctx: Context, key: number) {
  const resolved = ctx.resolveLink(url)
  if (resolved.kind === 'missing') {
    return (
      <span key={key} className="md-link-missing" title={`${url} isn’t in this idea`}>
        {children}
      </span>
    )
  }
  if (resolved.kind === 'external') {
    return (
      <a key={key} href={resolved.href} title={title ?? undefined} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    )
  }
  return (
    <Link key={key} href={resolved.href} title={title ?? undefined}>
      {children}
    </Link>
  )
}

function image(url: string, alt: string | null | undefined, ctx: Context, key: number) {
  return <MarkdownImage key={key} alt={alt ?? ''} media={ctx.image(url)} externalImages={ctx.externalImages} />
}

// Where a run of text starts and ends in the source, so a selection in the
// page can be turned back into source offsets (see SelectionMenu). inexact:
// its text isn't its source (an escape, an entity), so only its ends are known.
function textOffsets(value: string, node: Nodes) {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start === undefined || end === undefined) {
    return {}
  }
  const skip = node.type === 'inlineCode' ? (end - start - value.length) / 2 : 0
  const exact = Number.isInteger(skip) && (node.type === 'inlineCode' || value.length === end - start)
  return {
    'data-text-start': start + (exact ? skip : 0),
    'data-text-end': exact ? start + skip + value.length : end,
    ...(exact ? {} : { 'data-inexact': '' }),
  }
}

// Text with what falls in it: comment marks, and in a redline, inserted words
// and the place deleted ones were. A node whose text is its source (no escapes
// or entities) is split exactly; otherwise each covers all of it.
function marked(value: string, node: Nodes, ctx: Context): ReactNode {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start === undefined || end === undefined) {
    return value
  }
  const hits = ctx.marks.filter((mark) => mark.start < end && start < mark.end)
  const inserted = (ctx.edit?.inserted ?? []).filter((range) => range.start < end && start < range.end)
  const deletions = (ctx.edit?.deleted ?? []).filter(
    (deletion) => !ctx.edit!.shown.has(deletion) && start <= deletion.at && deletion.at <= end,
  )
  if (hits.length === 0 && inserted.length === 0 && deletions.length === 0) {
    return value
  }
  for (const deletion of deletions) {
    ctx.edit!.shown.add(deletion)
  }
  // inline code's value leaves out its backticks: it starts one in
  const skip = node.type === 'inlineCode' ? (end - start - value.length) / 2 : 0
  const exact = Number.isInteger(skip) && (node.type === 'inlineCode' || value.length === end - start)
  if (!exact) {
    const whole = wrap(value, hits[0], inserted.length > 0, 0)
    return [...deletions.map((deletion, i) => deleted(deletion, i)), whole]
  }
  const from = start + skip
  const clamp = (n: number) => Math.max(0, Math.min(value.length, n - from))
  const cuts = new Set([0, value.length])
  for (const range of [...hits, ...inserted]) {
    cuts.add(clamp(range.start))
    cuts.add(clamp(range.end))
  }
  for (const deletion of deletions) {
    cuts.add(clamp(deletion.at))
  }
  const points = [...cuts].sort((a, b) => a - b)
  const out: ReactNode[] = []
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!
    deletions
      .filter((deletion) => clamp(deletion.at) === a)
      .forEach((deletion, n) => out.push(deleted(deletion, i * 100 + n)))
    const b = points[i + 1]
    if (b === undefined) {
      break
    }
    // where marks overlap, the active one, then the shortest, shows
    const covering = hits
      .filter((mark) => mark.start <= from + a && from + b <= mark.end)
      .sort((x, y) => Number(Boolean(y.active)) - Number(Boolean(x.active)) || x.end - x.start - (y.end - y.start))
    const added = inserted.some((range) => range.start <= from + a && from + b <= range.end)
    out.push(wrap(value.slice(a, b), covering[0], added, i))
  }
  return out
}

function wrap(text: string, mark: MarkdownMark | undefined, added: boolean, key: number): ReactNode {
  const inner = added ? (
    <ins key={`ins-${key}`}>
      <span className="visually-hidden">[inserted: </span>
      {text}
      <span className="visually-hidden">]</span>
    </ins>
  ) : (
    text
  )
  return mark ? markElement(mark, inner, key) : <Fragment key={key}>{inner}</Fragment>
}

function markElement(mark: MarkdownMark, text: ReactNode, key: number) {
  const classes = ['md-mark', mark.active && 'is-active', mark.resolved && 'is-resolved'].filter(Boolean).join(' ')
  return (
    <mark key={key} className={classes} data-comment-id={mark.id}>
      {text}
    </mark>
  )
}
