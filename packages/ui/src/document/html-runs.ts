// How HTML blocks among a file's blocks are drawn (html.ts): alone, as one with the Markdown between
// an opening block and the one that closes it, or as their source. Plain text work, with no DOM, so
// the idea's actor reads files as the editor does (editor/model.ts).
import type { RootContent } from 'mdast'

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
