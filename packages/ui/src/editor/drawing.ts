// How the editor draws the model's nodes (model.ts), in the browser: each block's identity as
// data-block-id (so it rides in the clipboard's HTML, identity.ts), raw HTML drawn as the page draws it
// (sanitized) with its mark, and a run of HTML with the Markdown inside. The model's schema with these
// added: the same nodes, the same document, drawn.
import { gfm } from '@milkdown/kit/preset/gfm'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import type { Node, NodeSpec } from '@milkdown/kit/prose/model'
import { sanitizeHtml } from '../document/html.ts'
import { htmlRunSchema, identifiedNodes, preset, rawSchema } from './model.ts'

// the mark on drawn HTML: what it is, and where it's changed
export const HTML_LABEL = 'HTML blocks are only editable in source view'
export const htmlMark = () => {
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

/** Extends a Milkdown node schema's spec (extendSchema's types are Milkdown's own, loosely typed here). */
function extend<T extends { extendSchema: (h: never) => unknown }>(schema: T, more: (spec: NodeSpec) => NodeSpec): T {
  return (
    schema.extendSchema as unknown as (handler: (prev: (ctx: unknown) => NodeSpec) => (ctx: unknown) => NodeSpec) => T
  )((prev) => (ctx) => more(prev(ctx)))
}

/** A block with an identity, drawn with it, and read back from data-block-id. */
const drawnIdentified = identifiedNodes.map((schema) =>
  extend(schema, (spec) => ({
    ...spec,
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
  })),
)

/** Raw source shown as text, or raw HTML drawn (sanitized) with its mark. */
export const drawnRaw = extend(rawSchema, (spec) => ({
  ...spec,
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
}))

/** A run of HTML: its opening and closing HTML kept on the element, the Markdown between inside. */
export const drawnHtmlRun = extend(htmlRunSchema, (spec) => ({
  ...spec,
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
}))

/** The model's schema, drawn: what the editor uses in place of model.ts's schemaPlugins. */
export const drawnSchemas: MilkdownPlugin[] = [preset, gfm, drawnIdentified.flat(), drawnRaw, drawnHtmlRun].flat()
