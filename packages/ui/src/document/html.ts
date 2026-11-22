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

export { type HtmlBlock, htmlRuns, openCount } from './html-runs.ts'
