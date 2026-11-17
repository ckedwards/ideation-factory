// An idea's content at one version: its files, each with a stable ID per unit,
// and the comments anchored on it. This is what the idea actor stores (the
// sources go in the bucket by hash), and what commands and uploads turn into
// the next version.
import { parseMarkdown, type ParsedFile } from './markdown.ts'

export interface IdeaFile {
  /** Stable across renames. */
  id: string
  path: string
  source: string
  /**
   * One ID per unit of the parsed source, in order. Headings carry their
   * section's ID (`s…`), other units a block ID (`b…`).
   */
  unitIds: string[]
}

export interface Idea {
  files: IdeaFile[]
  /** The next number to use for an ID. IDs are short and readable (`b12`, `s3`, `f2`) and never reused within an idea. */
  nextId: number
}

export type Anchor =
  /** The idea as a whole, not any one file: it stays as it is through every version. */
  | { kind: 'idea' }
  | { kind: 'file'; file: string }
  | { kind: 'section'; file: string; section: string }
  /** A range of the file's plain-text form [start, end), and the text it covered. */
  | { kind: 'text'; file: string; start: number; end: number; quote: string }

export interface Comment {
  id: string
  anchor: Anchor
}

export type AnchorState = 'exact' | 'moved' | 'changed' | 'outdated'

export interface CommentOutcome {
  id: string
  state: AnchorState
  /** Where the comment is in the new version; null if it's outdated. */
  anchor: Anchor | null
}

export class Ids {
  constructor(public next: number) {}
  section(): string {
    return `s${this.next++}`
  }
  block(): string {
    return `b${this.next++}`
  }
  file(): string {
    return `f${this.next++}`
  }
}

export function isSectionId(id: string): boolean {
  return id.startsWith('s')
}

/** A new idea from its first upload. */
export function createIdea(files: Array<{ path: string; source: string }>): Idea {
  const ids = new Ids(1)
  const seen = new Set<string>()
  const out = files.map(({ path, source }) => {
    const problem = pathProblem(path) ?? (seen.has(path.toLowerCase()) ? 'duplicate path' : null)
    if (problem) {
      throw new Error(`${path}: ${problem}`)
    }
    seen.add(path.toLowerCase())
    return newFile(ids, path, source)
  })
  return { files: out, nextId: ids.next }
}

export function newFile(ids: Ids, path: string, source: string): IdeaFile {
  const id = ids.file()
  return { id, path, source, unitIds: freshIds(ids, parseMarkdown(source)) }
}

export function freshIds(ids: Ids, parsed: ParsedFile): string[] {
  return parsed.units.map((unit) => (unit.kind === 'heading' ? ids.section() : ids.block()))
}

/** Why a path can't be used for an idea's file, or null if it can. */
export function pathProblem(path: string): string | null {
  if (!path || path.length > 512) {
    return 'path must be 1 to 512 characters'
  }
  if (path.startsWith('/') || path.includes('\\') || /^[a-zA-Z]:/.test(path)) {
    return 'path must be relative, with "/" between folders'
  }
  if (path.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    return 'path has an empty, "." or ".." part'
  }
  if (!/\.md$/i.test(path)) {
    return 'only Markdown files (.md) can be part of an idea'
  }
  return null
}

/** A text anchor on the `occurrence`th match of `quote` in a file's plain-text form. Mostly for tests and tools. */
export function textAnchor(idea: Idea, fileId: string, quote: string, occurrence = 1): Anchor {
  const file = idea.files.find((f) => f.id === fileId)
  if (!file) {
    throw new Error(`no file ${fileId}`)
  }
  const text = parseMarkdown(file.source).plain.text
  let at = -1
  for (let n = 0; n < occurrence; n++) {
    at = text.indexOf(quote, at + 1)
    if (at < 0) {
      throw new Error(`"${quote}" occurs fewer than ${occurrence} times in ${file.path}`)
    }
  }
  return { kind: 'text', file: fileId, start: at, end: at + quote.length, quote }
}

export function fileById(idea: Idea, id: string): IdeaFile | undefined {
  return idea.files.find((file) => file.id === id)
}

/** Where a unit or section ID is: its file and index in that file's units. */
export function locate(idea: Idea, id: string): { file: IdeaFile; parsed: ParsedFile; unit: number } | null {
  for (const file of idea.files) {
    const unit = file.unitIds.indexOf(id)
    if (unit >= 0) {
      return { file, parsed: parseMarkdown(file.source), unit }
    }
  }
  return null
}

/** What a client sends to anchor a new comment; the server fills in the quote. */
export type AnchorInput =
  | { kind: 'idea' }
  | { kind: 'file'; file: string }
  | { kind: 'section'; section: string }
  | { kind: 'text'; file: string; start: number; end: number }

/** Checks a new comment's anchor against this version, returning the full anchor or why it can't be used. */
export function checkAnchor(
  idea: Idea,
  input: AnchorInput,
): { ok: true; anchor: Anchor } | { ok: false; message: string } {
  if (input.kind === 'idea') {
    return { ok: true, anchor: { kind: 'idea' } }
  }
  if (input.kind === 'section') {
    const at = locate(idea, input.section)
    if (!at || !input.section.startsWith('s')) {
      return { ok: false, message: `${input.section} isn't a section in this version` }
    }
    return { ok: true, anchor: { kind: 'section', file: at.file.id, section: input.section } }
  }
  const file = fileById(idea, input.file)
  if (!file) {
    return { ok: false, message: `${input.file} isn't in this version` }
  }
  if (input.kind === 'file') {
    return { ok: true, anchor: { kind: 'file', file: file.id } }
  }
  const text = parseMarkdown(file.source).plain.text
  const { start, end } = input
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > text.length || end <= start) {
    return {
      ok: false,
      message: `text range ${start}–${end} is outside ${file.path} (plain text is ${text.length} characters)`,
    }
  }
  const quote = text.slice(start, end)
  if (!/[\p{L}\p{N}]/u.test(quote)) {
    return { ok: false, message: 'a text comment must cover some words' }
  }
  if (quote.includes('\n')) {
    return { ok: false, message: 'a text comment must stay within one block' }
  }
  return { ok: true, anchor: { kind: 'text', file: file.id, start, end, quote } }
}
