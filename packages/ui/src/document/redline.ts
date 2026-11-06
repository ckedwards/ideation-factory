// The rendered redline: what changed in a file between two versions, block by
// block. Unchanged blocks are shown as they are; an edited block shows its
// word changes inline; a block that moved (the same text somewhere else) is
// marked as moved, not shown as a removal and an addition; and a block whose
// image changed (the same Markdown, a different picture) shows before and
// after.
//
// Blocks are a file's top-level Markdown nodes, compared by their source text.
// Word changes are found on the source too, so their offsets point into the
// newer file, the same offsets comments use.
import { diffArrays, diffWordsWithSpace } from 'diff'
import type { Nodes, Root, RootContent } from 'mdast'

/** A file's Markdown and the tree markdownTree made from it. */
export interface MarkdownSource {
  source: string
  tree: Root
}

/** A range of source offsets in the newer file. */
export interface SourceRange {
  start: number
  end: number
}

/** Text that was taken out, shown at an offset in the newer file. */
export interface Deletion {
  at: number
  text: string
}

// node is from the newer file, except for removed and moved-from (the older
// one). label: the first words of a block that moved, to say what went where.
export type RedlineBlock =
  | { kind: 'same'; node: RootContent }
  | { kind: 'added'; node: RootContent }
  | { kind: 'removed'; node: RootContent }
  | { kind: 'edited'; node: RootContent; inserted: SourceRange[]; deleted: Deletion[] }
  | { kind: 'moved'; node: RootContent; label: string }
  | { kind: 'moved-from'; node: RootContent; label: string; down: boolean }
  | { kind: 'image-changed'; node: RootContent; before: RootContent }

// Below this share of words in common, an edit reads better as the old block
// struck out and the new one added.
const SIMILAR = 0.45
// Blocks compared whole: a word diff inside them doesn't read well
const WHOLE = new Set(['code', 'table', 'html', 'thematicBreak', 'yaml', 'definition'])

/**
 * The redline from `base` to `current`. `sameImages` says whether a block's
 * images are the same in both versions (by default they are); the page knows,
 * from what was uploaded with each.
 */
export function redline(
  base: MarkdownSource,
  current: MarkdownSource,
  sameImages: (before: RootContent, after: RootContent) => boolean = () => true,
): RedlineBlock[] {
  const old = base.tree.children.filter(hasPosition)
  const now = current.tree.children.filter(hasPosition)
  const key = (file: MarkdownSource, node: RootContent) => file.source.slice(start(node), end(node)).trim()
  const oldKeys = old.map((node) => key(base, node))
  const nowKeys = now.map((node) => key(current, node))
  const changes = diffArrays(oldKeys, nowKeys)

  // the same text taken out in one place and put in another moved
  const removed = new Set(changes.filter((c) => c.removed).flatMap((c) => c.value))
  const added = new Set(changes.filter((c) => c.added).flatMap((c) => c.value))
  const moved = new Set([...removed].filter((text) => added.has(text) && text.length > 3))

  const out: RedlineBlock[] = []
  let i = 0
  let j = 0
  for (let c = 0; c < changes.length; c++) {
    const change = changes[c]!
    if (!change.added && !change.removed) {
      for (let n = 0; n < change.value.length; n++) {
        const before = old[i++]!
        const after = now[j++]!
        out.push(
          sameImages(before, after) ? { kind: 'same', node: after } : { kind: 'image-changed', node: after, before },
        )
      }
      continue
    }
    // a run of removals and additions: moved blocks first set aside, the rest paired up
    const gone: RootContent[] = []
    const come: RootContent[] = []
    for (; c < changes.length && (changes[c]!.added || changes[c]!.removed); c++) {
      const run = changes[c]!
      for (const text of run.value) {
        if (run.removed) {
          const node = old[i++]!
          if (moved.has(text)) {
            out.push({ kind: 'moved-from', node, label: label(text), down: nowKeys.indexOf(text) >= j })
          } else {
            gone.push(node)
          }
        } else {
          const node = now[j++]!
          if (moved.has(text)) {
            out.push({ kind: 'moved', node, label: label(text) })
          } else {
            come.push(node)
          }
        }
      }
    }
    c--
    for (let n = 0; n < Math.max(gone.length, come.length); n++) {
      const before = gone[n]
      const after = come[n]
      const edit = before && after ? wordChanges(base, before, current, after) : null
      if (edit) {
        out.push({ kind: 'edited', node: after!, ...edit })
        continue
      }
      if (before) {
        out.push({ kind: 'removed', node: before })
      }
      if (after) {
        out.push({ kind: 'added', node: after })
      }
    }
  }
  return out
}

/** The source ranges that differ: what to show as changed in the margin. */
export function changedRanges(blocks: RedlineBlock[]): SourceRange[] {
  return blocks
    .filter((block) => block.kind !== 'same' && block.kind !== 'removed' && block.kind !== 'moved-from')
    .map((block) => ({ start: start(block.node), end: end(block.node) }))
}

/** One block's word changes, or null when they're too different to read as one edited block. */
function wordChanges(
  base: MarkdownSource,
  before: RootContent,
  current: MarkdownSource,
  after: RootContent,
): { inserted: SourceRange[]; deleted: Deletion[] } | null {
  if (!comparable(before, after)) {
    return null
  }
  const oldText = base.source.slice(start(before), end(before))
  const newText = current.source.slice(start(after), end(after))
  const parts = diffWordsWithSpace(oldText, newText)
  const common = parts.filter((p) => !p.added && !p.removed).reduce((n, p) => n + p.value.trim().length, 0)
  if (common / Math.max(oldText.trim().length, newText.trim().length, 1) < SIMILAR) {
    return null
  }
  const inserted: SourceRange[] = []
  const deleted: Deletion[] = []
  let a = start(before)
  let b = start(after)
  for (const part of parts) {
    const length = part.value.length
    if (part.added) {
      inserted.push({ start: b, end: b + length })
      b += length
    } else if (part.removed) {
      const text = visibleText(before, a, a + length)
      if (text) {
        deleted.push({ at: snap(after, b), text })
      }
      a += length
    } else {
      a += length
      b += length
    }
  }
  return { inserted, deleted }
}

function comparable(before: RootContent, after: RootContent): boolean {
  if (before.type !== after.type || WHOLE.has(after.type)) {
    return false
  }
  if (before.type === 'heading' && after.type === 'heading') {
    return before.depth === after.depth
  }
  if (before.type === 'list' && after.type === 'list') {
    return before.ordered === after.ordered
  }
  return true
}

// A deletion's place moved onto text the reader can see: one that falls in
// Markdown syntax (after a paragraph's last word, at a list marker) goes at the
// end of the text before it, or the start of the first
function snap(node: Nodes, at: number): number {
  const runs: SourceRange[] = []
  const visit = (child: Nodes) => {
    if (child.type === 'text' || child.type === 'inlineCode') {
      runs.push({ start: start(child), end: end(child) })
    } else if ('children' in child) {
      child.children.forEach(visit)
    }
  }
  visit(node)
  if (runs.length === 0 || runs.some((run) => run.start <= at && at <= run.end)) {
    return at
  }
  const before = runs.filter((run) => run.end <= at).at(-1)
  return before ? before.end : runs[0]!.start
}

// The text a reader saw in [from, to) of the older file: its words without the
// Markdown around them, so a deleted "**soon**" shows as "soon"
function visibleText(node: Nodes, from: number, to: number): string {
  if (node.type === 'text' || node.type === 'inlineCode') {
    const s = start(node)
    const e = end(node)
    if (e <= from || to <= s) {
      return ''
    }
    const skip = node.type === 'inlineCode' ? (e - s - node.value.length) / 2 : 0
    if (node.type === 'text' && node.value.length !== e - s) {
      return node.value
    }
    const at = s + skip
    return node.value.slice(Math.max(0, from - at), Math.max(0, Math.min(node.value.length, to - at)))
  }
  if ('children' in node) {
    return node.children.map((child) => visibleText(child, from, to)).join('')
  }
  return ''
}

// "Sync endpoint", "One endpoint takes a batch…": what a moved block was
function label(text: string): string {
  const first = (text.split('\n')[0] ?? '')
    .replace(/^#+\s*|^\s*(?:[-*+]|\d+\.)\s+|^>\s*/g, '')
    .replace(/[`*_~]/g, '')
    .trim()
  return first.length > 60 ? `${first.slice(0, 60)}…` : first
}

const hasPosition = (node: RootContent) =>
  node.position?.start.offset !== undefined && node.position.end.offset !== undefined
const start = (node: Nodes) => node.position?.start.offset ?? 0
const end = (node: Nodes) => node.position?.end.offset ?? 0
