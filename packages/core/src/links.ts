// Links between an idea's files, and the fixes renaming or moving files needs so they still point
// where they did (docs: Files in the browser, Rename).
//
// - **Which links:** relative ones, in links, images and link definitions: `[states](sync-states.md)`,
//   `![](images/a.png)`, `[ref]: ../notes.md#costs`. A link with a scheme (`https:`, `mailto:`), one
//   from the root (`/…`) and one to a heading of its own file (`#…`) never change.
// - **Fixed when** the file a link points at is renamed, or the file the link is in moves to another
//   folder (its links to anything, the idea's files or not, are rewritten from its new folder).
// - **As block edits:** each block whose links change gets its new source, so a fix is an ordinary
//   change in the draft, with its comments kept and Undo like any other. Only the link's address is
//   rewritten; its text, title, a `#heading` or `?query` after it stay as they are.
// - **Several at once:** a folder renamed is every file in it renamed together, so links between
//   two of them, which don't change, aren't touched.
import type { Root, RootContent } from 'mdast'
import type { DraftChange } from './draft.ts'
import { type Idea, pathProblem } from './idea.ts'
import { markdownTree, parseMarkdown } from './markdown.ts'

/** A file to rename, by ID, and its new path. */
export interface Rename {
  file: string
  path: string
}

/** A block's new source, with its links fixed; `was`, its source before. */
export interface LinkFix {
  file: string
  id: string
  was: string
  source: string
  /** How many of its links changed. */
  links: number
}

/** Where a relative link's address is in a file: its offsets, and the address as written. */
interface Address {
  start: number
  end: number
  raw: string
  /** Written in angle brackets (`<my notes.md>`), where spaces are allowed. */
  angle: boolean
}

/** The fixes renaming `renames` together needs, a block at a time, in file order. */
export function linkFixes(idea: Idea, renames: readonly Rename[]): LinkFix[] {
  const newPath = new Map(renames.map((r) => [r.file, r.path]))
  // a link names a file by its path: the path each file had, to the one it will have
  const byOldPath = new Map(idea.files.map((f) => [f.path, newPath.get(f.id) ?? f.path]))
  const fixes: LinkFix[] = []
  for (const file of idea.files) {
    const from = folderOf(file.path)
    const to = folderOf(newPath.get(file.id) ?? file.path)
    const edits: Array<{ start: number; end: number; text: string }> = []
    for (const address of relativeAddresses(file.source)) {
      const { path, rest } = splitAddress(address.raw)
      const target = resolve(from, decode(path))
      const moved = byOldPath.get(target) ?? target
      // as written, it still leads there from where its file will be: leave it
      if (resolve(to, decode(path)) === moved) {
        continue
      }
      edits.push({ start: address.start, end: address.end, text: encode(relativeTo(to, moved), address.angle) + rest })
    }
    if (edits.length === 0) {
      continue
    }
    const parsed = parseMarkdown(file.source)
    parsed.units.forEach((unit, i) => {
      const inside = edits.filter((e) => e.start >= unit.start && e.end <= unit.end)
      if (inside.length === 0) {
        return
      }
      const was = file.source.slice(unit.start, unit.end)
      let source = was
      for (const edit of [...inside].sort((a, b) => b.start - a.start)) {
        source = source.slice(0, edit.start - unit.start) + edit.text + source.slice(edit.end - unit.start)
      }
      fixes.push({ file: file.id, id: file.unitIds[i]!, was, source, links: inside.length })
    })
  }
  return fixes
}

/**
 * The draft changes that rename `renames` together: each file's rename, then the link fixes. With
 * how many links were fixed, or why they can't be renamed: a path that's no good, or one another
 * file has (or will have) in any case.
 */
export function renameChanges(
  idea: Idea,
  renames: readonly Rename[],
): { ok: true; changes: DraftChange[]; links: number } | { ok: false; message: string } {
  const after = new Map(idea.files.map((f) => [f.id, f.path]))
  for (const { file, path } of renames) {
    if (!after.has(file)) {
      return { ok: false, message: `${file} isn't in the draft` }
    }
    const problem = pathProblem(path)
    if (problem) {
      return { ok: false, message: `${path}: ${problem}` }
    }
    after.set(file, path)
  }
  const seen = new Map<string, string>()
  for (const [id, path] of after) {
    const other = seen.get(path.toLowerCase())
    if (other !== undefined) {
      return { ok: false, message: `There’s already a file called ${path}` }
    }
    seen.set(path.toLowerCase(), id)
  }
  // renamed one at a time, each takes a path that's free by then: a file moving out goes first
  const changes: DraftChange[] = []
  const paths = new Map(idea.files.map((f) => [f.id, f.path]))
  const taken = (path: string, self: string) =>
    [...paths].some(([id, p]) => id !== self && p.toLowerCase() === path.toLowerCase())
  const waiting = renames.filter((r) => paths.get(r.file) !== r.path)
  while (waiting.length > 0) {
    const next = waiting.findIndex((r) => !taken(r.path, r.file))
    if (next < 0) {
      // files swapping paths
      const r = waiting[0]!
      return {
        ok: false,
        message: `${r.path} is still taken when ${paths.get(r.file)} is renamed: rename one of them to a free name first`,
      }
    }
    const [{ file, path }] = waiting.splice(next, 1) as [Rename]
    changes.push({ kind: 'rename-file', file, path, was: paths.get(file)! })
    paths.set(file, path)
  }
  const fixes = linkFixes(idea, renames)
  for (const fix of fixes) {
    changes.push({ kind: 'edit', id: fix.id, source: fix.source, was: fix.was })
  }
  return { ok: true, changes, links: fixes.reduce((n, f) => n + f.links, 0) }
}

/** The renames that move a folder (its path, `research`) to `to`: every file under it. */
export function folderRenames(idea: Idea, folder: string, to: string): Rename[] {
  const prefix = `${folder}/`
  return idea.files
    .filter((f) => f.path.startsWith(prefix))
    .map((f) => ({ file: f.id, path: `${to}/${f.path.slice(prefix.length)}` }))
}

/** The files under a folder (its path, `research`), by ID. */
export function filesInFolder(idea: Idea, folder: string): string[] {
  const prefix = `${folder}/`
  return idea.files.filter((f) => f.path.startsWith(prefix)).map((f) => f.id)
}

/** The relative addresses in a file's links, images and link definitions. */
function relativeAddresses(source: string): Address[] {
  const found: Address[] = []
  const visit = (node: Root | RootContent) => {
    if (node.type === 'link' || node.type === 'image' || node.type === 'definition') {
      const address = addressOf(source, node)
      if (address && isRelative(address.raw)) {
        found.push(address)
      }
    }
    if ('children' in node) {
      for (const child of node.children) {
        visit(child)
      }
    }
  }
  visit(markdownTree(source))
  return found
}

/** Where a link's address is: after `](` for a link or image, after `]:` for a definition. */
function addressOf(source: string, node: RootContent): Address | null {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start === undefined || end === undefined) {
    return null
  }
  let at: number
  if (node.type === 'definition') {
    at = source.indexOf(']:', start)
    if (at < 0 || at >= end) {
      return null
    }
    at += 2
  } else {
    // a link's text ends at its last child; an image's alt has none, so after the first "]("
    const last = 'children' in node && node.children.length > 0 ? node.children.at(-1)!.position?.end.offset : start
    at = source.indexOf('](', last ?? start)
    if (at < 0 || at >= end) {
      // a reference link ([text][ref]) has no address of its own: its definition does
      return null
    }
    at += 2
  }
  while (at < end && /\s/.test(source[at]!)) {
    at++
  }
  if (source[at] === '<') {
    const close = source.indexOf('>', at)
    if (close < 0 || close > end) {
      return null
    }
    return { start: at + 1, end: close, raw: source.slice(at + 1, close), angle: true }
  }
  // a bare address runs to whitespace, or to the ")" that closes the link (with balanced parentheses)
  let depth = 0
  let stop = at
  while (stop < end) {
    const c = source[stop]!
    if (c === '\\') {
      stop += 2
      continue
    }
    if (/\s/.test(c)) {
      break
    }
    if (c === '(') {
      depth++
    } else if (c === ')') {
      if (depth === 0) {
        break
      }
      depth--
    }
    stop++
  }
  return stop > at ? { start: at, end: stop, raw: source.slice(at, stop), angle: false } : null
}

function isRelative(raw: string): boolean {
  return raw !== '' && !raw.startsWith('#') && !raw.startsWith('/') && !/^[a-z][a-z0-9+.-]*:/i.test(raw)
}

/** An address's path, and what follows it (`?query`, `#heading`), which a fix keeps. */
function splitAddress(raw: string): { path: string; rest: string } {
  const at = raw.search(/[?#]/)
  return at < 0 ? { path: raw, rest: '' } : { path: raw.slice(0, at), rest: raw.slice(at) }
}

function decode(path: string): string {
  try {
    return decodeURIComponent(path.replace(/\\(.)/g, '$1'))
  } catch {
    return path
  }
}

/** A path written so it reads back as itself in a link: spaces and parentheses escaped. */
function encode(path: string, angle: boolean): string {
  return angle
    ? path.replace(/>/g, '%3E')
    : path.replace(/[ ()<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

/** The folder a path is in (`research` for research/interviews.md), or '' at the top. */
function folderOf(path: string): string {
  const at = path.lastIndexOf('/')
  return at < 0 ? '' : path.slice(0, at)
}

/** A relative path from a folder, as a path from the idea's top (keeping `..` above it). */
function resolve(folder: string, path: string): string {
  const parts = folder ? folder.split('/') : []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') {
      continue
    }
    if (part === '..' && parts.length > 0 && parts.at(-1) !== '..') {
      parts.pop()
    } else {
      parts.push(part)
    }
  }
  return parts.join('/')
}

/** The relative path from a folder to a path from the idea's top. */
function relativeTo(folder: string, target: string): string {
  const from = folder ? folder.split('/') : []
  const to = target.split('/')
  let same = 0
  while (same < from.length && same < to.length - 1 && from[same] === to[same]) {
    same++
  }
  return [...from.slice(same).map(() => '..'), ...to.slice(same)].join('/')
}
