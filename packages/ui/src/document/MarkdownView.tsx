// A Markdown file, rendered from core's syntax tree (markdownTree), so what's
// shown and where comments land come from one parser. It renders the tree to
// React elements directly: Markdown never becomes an HTML string, and raw HTML
// in a file is shown as text, never run.
//
// Every block carries its source offsets (data-start, data-end), which is how
// the page maps between the document and comment anchors, sections and edits.
import type { Code, Definition, Nodes, PhrasingContent, Root, RootContent, Table } from 'mdast'
import type { ReactNode } from 'react'
import { Link } from '../link/Link.tsx'
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
  // the uploaded copy of an image, or null when there's none to show
  imageSrc?: (url: string) => string | null
  // draws a code block itself (a Mermaid diagram), or undefined to show the code
  renderCode?: (code: Code) => ReactNode | undefined
  onMarkClick?: (id: string) => void
  // before every id it gives headings and footnotes, when a page shows two files
  idPrefix?: string
  // compact: smaller, for a comment's text
  variant?: 'document' | 'compact'
}

interface Context extends Required<Pick<MarkdownViewProps, 'marks' | 'resolveLink' | 'imageSrc'>> {
  props: MarkdownViewProps
  definitions: Map<string, Definition>
  footnotes: Map<string, number>
  slugs: Map<string, number>
  tables: number
}

export function defaultResolveLink(url: string): ResolvedLink {
  return { href: url, kind: /^(https?:|mailto:)/i.test(url) ? 'external' : 'internal' }
}

export function MarkdownView(props: MarkdownViewProps) {
  const { tree, marks = [], resolveLink = defaultResolveLink, imageSrc = () => null } = props
  const ctx: Context = {
    props,
    marks,
    resolveLink,
    imageSrc,
    definitions: collectDefinitions(tree),
    footnotes: new Map(),
    slugs: new Map(),
    tables: 0,
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
      {tree.children.map((node, i) => block(node, ctx, i, true))}
    </div>
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

// GitHub's style: lowercase, punctuation dropped, spaces to hyphens, repeats numbered
function slug(text: string, ctx: Context): string {
  const base =
    text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s/g, '-') || 'section'
  const seen = ctx.slugs.get(base) ?? 0
  ctx.slugs.set(base, seen + 1)
  return `${ctx.props.idPrefix ?? ''}${seen === 0 ? base : `${base}-${seen}`}`
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
          {node.children.map((child, i) => block(child, ctx, i))}
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
      // shown, not run
      return (
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
          <div>{node.children.map((child, i) => block(child, ctx, i))}</div>
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
  ctx.tables += 1
  const headers = (node.children[0]?.children ?? []).map((cell) => plainText(cell).trim()).filter(Boolean)
  return `Table ${ctx.tables}${headers.length > 0 ? `: ${headers.join(', ')}` : ''}`
}

function footnoteNumber(identifier: string, ctx: Context): number {
  const known = ctx.footnotes.get(identifier)
  if (known !== undefined) {
    return known
  }
  const next = ctx.footnotes.size + 1
  ctx.footnotes.set(identifier, next)
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
      return <span key={key}>{marked(node.value, node, ctx)}</span>
    case 'emphasis':
      return <em key={key}>{inline(node.children, ctx)}</em>
    case 'strong':
      return <strong key={key}>{inline(node.children, ctx)}</strong>
    // <s>, not <del>: del is the redline's deleted text
    case 'delete':
      return <s key={key}>{inline(node.children, ctx)}</s>
    case 'inlineCode':
      return <code key={key}>{marked(node.value, node, ctx)}</code>
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
  const src = ctx.imageSrc(url)
  if (src) {
    return <img key={key} className="md-image" src={src} alt={alt ?? ''} />
  }
  return (
    <span key={key} className="md-image-missing">
      <span aria-hidden>🖼 </span>
      {alt || 'Image'} · not shown
    </span>
  )
}

// Text with the comment marks that fall in it. A node whose text is its source
// (no escapes or entities) is split exactly; otherwise a mark covers all of it.
function marked(value: string, node: Nodes, ctx: Context): ReactNode {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start === undefined || end === undefined || ctx.marks.length === 0) {
    return value
  }
  const hits = ctx.marks.filter((mark) => mark.start < end && start < mark.end)
  if (hits.length === 0) {
    return value
  }
  // inline code's value leaves out its backticks: it starts one in
  const skip = node.type === 'inlineCode' ? (end - start - value.length) / 2 : 0
  const exact = Number.isInteger(skip) && (node.type === 'inlineCode' || value.length === end - start)
  if (!exact) {
    return markElement(hits[0]!, value, 0)
  }
  const from = start + skip
  const cuts = new Set([0, value.length])
  for (const mark of hits) {
    cuts.add(Math.max(0, mark.start - from))
    cuts.add(Math.min(value.length, mark.end - from))
  }
  const points = [...cuts].filter((n) => n >= 0 && n <= value.length).sort((a, b) => a - b)
  const out: ReactNode[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    const text = value.slice(a, b)
    // where marks overlap, the active one, then the shortest, shows
    const covering = hits
      .filter((mark) => mark.start <= from + a && from + b <= mark.end)
      .sort((x, y) => Number(Boolean(y.active)) - Number(Boolean(x.active)) || x.end - x.start - (y.end - y.start))
    out.push(covering[0] ? markElement(covering[0], text, i) : text)
  }
  return out
}

function markElement(mark: MarkdownMark, text: string, key: number) {
  const classes = ['md-mark', mark.active && 'is-active', mark.resolved && 'is-resolved'].filter(Boolean).join(' ')
  return (
    <mark key={key} className={classes} data-comment-id={mark.id}>
      {text}
    </mark>
  )
}
