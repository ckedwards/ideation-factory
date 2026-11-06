// Turning a selection in a rendered document back into the Markdown it came
// from. MarkdownView marks every run of text with where it starts and ends in
// the source (data-text-start, data-text-end), so a selection's ends become
// source offsets: what a comment or a suggested edit is anchored on.

/** Some selected text, as source offsets into the file. */
export interface TextSelection {
  // what was selected, as a reader sees it, whitespace collapsed
  quote: string
  start: number
  end: number
  // the section it's in: its heading's text and where the heading starts
  section: { title: string; heading: number } | null
}

const RUN = '[data-text-start]'

/** The selection's source offsets, or null when it holds no document text. */
export function selectionInSource(root: HTMLElement, range: Range): TextSelection | null {
  const runs = [...root.querySelectorAll<HTMLElement>(RUN)].filter((run) => range.intersectsNode(run))
  const first = runs[0]
  const last = runs.at(-1)
  if (!first || !last) {
    return null
  }
  const start = first.contains(range.startContainer)
    ? offsetIn(first, range.startContainer, range.startOffset, 'start')
    : Number(first.dataset['textStart'])
  const end = last.contains(range.endContainer)
    ? offsetIn(last, range.endContainer, range.endOffset, 'end')
    : Number(last.dataset['textEnd'])
  const quote = range.toString().replace(/\s+/g, ' ').trim()
  if (!quote || end <= start) {
    return null
  }
  return { quote, start, end, section: sectionAt(root, start) }
}

// a point inside a run, as a source offset; a run whose text isn't its source
// (an escape, an entity) only knows its ends
function offsetIn(run: HTMLElement, container: Node, offset: number, edge: 'start' | 'end'): number {
  const from = Number(run.dataset['textStart'])
  if (run.hasAttribute('data-inexact')) {
    return edge === 'start' ? from : Number(run.dataset['textEnd'])
  }
  const before = document.createRange()
  before.setStart(run, 0)
  before.setEnd(container, offset)
  let count = 0
  const walker = document.createTreeWalker(run, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    // a redline's deleted words and words for screen readers aren't source
    if (node.parentElement?.closest('del, .visually-hidden')) {
      continue
    }
    if (node === container) {
      count += offset
      break
    }
    if (before.comparePoint(node, node.length) !== 0) {
      break
    }
    count += node.length
  }
  return from + count
}

function sectionAt(root: HTMLElement, offset: number): TextSelection['section'] {
  let found: TextSelection['section'] = null
  for (const heading of root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')) {
    const at = Number(heading.dataset['start'])
    if (Number.isFinite(at) && at <= offset && (!found || at > found.heading)) {
      found = { title: heading.textContent?.trim() ?? '', heading: at }
    }
  }
  return found
}
