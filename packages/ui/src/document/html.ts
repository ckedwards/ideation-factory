// Raw HTML in Markdown, drawn as HTML, made safe first. A file or a comment can hold any HTML, so it's
// cut down to a short list of elements and attributes before it's drawn (TAGS, ATTRIBUTES): text,
// lists, tables, links and details. No script, event handlers, frames, forms or styles, and nothing
// that loads from another site. An image becomes its alt text, since the app shows
// pictures from other sites only as the deployment allows (MarkdownImage); a Markdown image is the way
// to show one.
//
// Markdown splits HTML that has blank lines in it into several blocks, with Markdown between them:
//
//     <details><summary>Raw log</summary>
//
//     Some **Markdown**.
//
//     </details>
//
// is an HTML block, a paragraph and another HTML block. Drawn one at a time they'd make no sense, so a
// block that leaves an element open and the block that closes it are drawn as one, with the Markdown
// between them inside (`htmlRuns`). A block that closes what it never opened is shown as its source.
import createDOMPurify from 'dompurify'
import type { RootContent } from 'mdast'

// the element that stands for the Markdown between an opening block and its closing one
export const SLOT = 'data-html-slot'

// what may be drawn: an allowlist, kept short on purpose (widen it when there's a need). Everything
// else is taken out, its text kept.
const TAGS = [
  'p',
  'div',
  'span',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'del',
  'ins',
  'mark',
  'sub',
  'sup',
  'small',
  'code',
  'kbd',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'details',
  'summary',
  'table',
  'caption',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'a',
  'abbr',
]
const ATTRIBUTES = ['href', 'title', 'open', 'colspan', 'rowspan', 'align', 'start', SLOT]

let purify: ReturnType<typeof createDOMPurify> | null = null

function purifier() {
  if (purify) {
    return purify
  }
  purify = createDOMPurify(window)
  purify.addHook('uponSanitizeElement', (node, data) => {
    // an image: its alt text in its place
    if (data.tagName === 'img' && node instanceof Element) {
      const alt = node.getAttribute('alt')
      node.replaceWith(node.ownerDocument.createTextNode(alt ? `[${alt}]` : ''))
    }
  })
  purify.addHook('afterSanitizeAttributes', (node) => {
    // a link to another site opens on its own, and tells it nothing
    if (node instanceof HTMLAnchorElement && /^https?:/i.test(node.getAttribute('href') ?? '')) {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer nofollow')
    }
  })
  return purify
}

/** HTML cut down to what's safe to draw: the elements that shape text, lists, tables, links and details. */
export function sanitizeHtml(html: string): string {
  return purifier().sanitize(html, {
    ALLOWED_TAGS: TAGS,
    ALLOWED_ATTR: ATTRIBUTES,
    ALLOW_DATA_ATTR: false,
  })
}

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
])

/** Elements a piece of HTML leaves open: those it opens less those it closes (negative: it closes more). */
export function openCount(html: string): number {
  let open = 0
  const tags = /<(\/?)([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g
  for (const [, closing, name, selfClosing] of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(tags)) {
    if (VOID.has(name!.toLowerCase()) || selfClosing) {
      continue
    }
    open += closing ? -1 : 1
  }
  return open
}

/** How an HTML block is drawn: alone, as one with the blocks after it up to `to`, or as its source. */
export type HtmlBlock = { draw: 'alone' } | { draw: 'run'; to: number } | { draw: 'source' }

/**
 * For each HTML block among sibling blocks, how it's drawn (other blocks have no entry). A block that
 * leaves elements open runs on to the first HTML block after it that closes them all; the blocks
 * between are inside the run. A block left open with nothing to close it, or one that closes what it
 * didn't open, is shown as its source.
 */
export function htmlRuns(nodes: readonly RootContent[]): Map<number, HtmlBlock> {
  const draws = new Map<number, HtmlBlock>()
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    if (node.type !== 'html') {
      continue
    }
    const open = openCount(node.value)
    if (open === 0) {
      draws.set(i, { draw: 'alone' })
      continue
    }
    if (open < 0) {
      draws.set(i, { draw: 'source' })
      continue
    }
    let left = open
    let to = -1
    for (let j = i + 1; j < nodes.length; j++) {
      const next = nodes[j]!
      if (next.type === 'html') {
        left += openCount(next.value)
        if (left <= 0) {
          to = left === 0 ? j : -1
          break
        }
      }
    }
    if (to < 0) {
      draws.set(i, { draw: 'source' })
      continue
    }
    draws.set(i, { draw: 'run', to })
    i = to
  }
  return draws
}
