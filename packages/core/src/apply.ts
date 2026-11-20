// Applying a batch of edit commands: a pure function from an idea (files and
// comments) and a batch to the next version, or to a conflict.
//
// Steps run in order, each on the result of the one before, so a later step
// can edit what an earlier one moved and the comments still follow. A batch is
// all or nothing: if any step can't apply, nothing changes and every step that
// failed is reported. Replaying a batch built on an older version is just
// applying it to the latest one: each command finds its target by ID and
// checks its expected text, so it either still applies or conflicts.
import type { Batch, Command, Position } from './batch.ts'
import { fillIds, followText, matchUnits, type OldFile, sourceMapper, worse } from './follow.ts'
import {
  type Anchor,
  type AnchorState,
  type Comment,
  type CommentOutcome,
  fileById,
  type Idea,
  type IdeaFile,
  Ids,
  locate,
  pathProblem,
} from './idea.ts'
import { lineEnd, lineStartIfBlank, parseMarkdown, type ParsedFile } from './markdown.ts'
import { applyEdit, diffPieces, identity, type Piece, PieceMap, textOf } from './pieces.ts'

export type ConflictReason = 'not_found' | 'no_match' | 'ambiguous' | 'expect_mismatch' | 'invalid'

export interface Conflict {
  /** Index of the step in the batch. */
  step: number
  command: Command['command']
  reason: ConflictReason
  message: string
}

export interface StepResult {
  step: number
  command: Command['command']
  addresses: string[]
}

export type BatchResult =
  | { ok: true; idea: Idea; comments: CommentOutcome[]; steps: StepResult[] }
  | { ok: false; conflicts: Conflict[] }

class Fail extends Error {
  constructor(
    readonly reason: ConflictReason,
    message: string,
  ) {
    super(message)
  }
}

type Tracked = { anchor: Anchor | null; state: AnchorState }

export function applyBatch(idea: Idea, comments: Comment[], batch: Batch): BatchResult {
  const ids = new Ids(idea.nextId)
  const known = new Set(comments.map((c) => c.id))
  const tracked = new Map<string, Tracked>(comments.map((c) => [c.id, { anchor: c.anchor, state: 'exact' }]))
  const conflicts: Conflict[] = []
  const steps: StepResult[] = []
  let current = idea

  batch.steps.forEach((command, step) => {
    try {
      const unknown = (command.addresses ?? []).filter((id) => !known.has(id))
      if (unknown.length > 0) {
        throw new Fail('invalid', `addresses unknown comments: ${unknown.join(', ')}`)
      }
      const next = runStep(current, ids, plan(current, ids, command), tracked)
      current = next
      steps.push({ step, command: command.command, addresses: command.addresses ?? [] })
    } catch (error) {
      if (!(error instanceof Fail)) {
        throw error
      }
      conflicts.push({ step, command: command.command, reason: error.reason, message: error.message })
    }
  })

  if (conflicts.length > 0) {
    return { ok: false, conflicts }
  }
  return {
    ok: true,
    idea: { files: current.files, nextId: ids.next },
    comments: comments.map((c) => ({ id: c.id, ...tracked.get(c.id)! })),
    steps,
  }
}

// --- one step -----------------------------------------------------------------

type Plan = {
  /** New pieces for each file that changes or is created (by file ID). Other files are unchanged. */
  pieces: Map<string, Piece[]>
  /** New paths, for renamed and created files. */
  paths: Map<string, string>
  deleted: Set<string>
}

function runStep(idea: Idea, ids: Ids, plan: Plan, tracked: Map<string, Tracked>): Idea {
  const oldParsed = new Map(idea.files.map((f) => [f.id, parseMarkdown(f.source)]))
  const sourceOf = (id: string) => fileById(idea, id)!.source

  const allPieces = new Map<string, Piece[]>()
  const newFiles: Array<{ id: string; path: string; source: string }> = []
  for (const file of idea.files) {
    if (plan.deleted.has(file.id)) {
      continue
    }
    const pieces = plan.pieces.get(file.id) ?? identity(file.id, file.source.length)
    allPieces.set(file.id, pieces)
    newFiles.push({ id: file.id, path: plan.paths.get(file.id) ?? file.path, source: textOf(pieces, sourceOf) })
  }
  for (const [id, pieces] of plan.pieces) {
    if (fileById(idea, id)) {
      continue
    }
    allPieces.set(id, pieces)
    newFiles.push({ id, path: plan.paths.get(id)!, source: textOf(pieces, sourceOf) })
  }

  const newParsed = new Map(newFiles.map((f) => [f.id, parseMarkdown(f.source)]))
  const map = new PieceMap(allPieces)
  // only the files this step touches need following; the rest keep their IDs and comments as they are
  const touched = (id: string) => plan.pieces.has(id) || plan.deleted.has(id)
  const old: OldFile[] = idea.files
    .filter((f) => touched(f.id))
    .map((file) => ({ file, parsed: oldParsed.get(file.id)! }))
  const changedNew = new Map([...newParsed].filter(([id]) => plan.pieces.has(id)))
  const unitIds = fillIds(matchUnits(old, changedNew, map, 'source'), changedNew, ids)
  const files: IdeaFile[] = newFiles.map((f) => ({ ...f, unitIds: unitIds.get(f.id) ?? fileById(idea, f.id)!.unitIds }))
  const next: Idea = { files, nextId: ids.next }

  const mapper = sourceMapper(map, oldParsed, newParsed)
  for (const entry of tracked.values()) {
    const anchor = entry.anchor
    // on the idea as a whole, it stays as it is
    if (!anchor || anchor.kind === 'idea') {
      continue
    }
    if (!touched(anchor.file)) {
      continue
    }
    let result: { state: AnchorState; anchor: Anchor | null }
    if (anchor.kind === 'file') {
      result = fileById(next, anchor.file) ? { state: 'exact', anchor } : { state: 'outdated', anchor: null }
    } else if (anchor.kind === 'section') {
      const at = locate(next, anchor.section)
      const heading = locate(idea, anchor.section)
      const moved = heading
        ? map.map(heading.file.id, heading.parsed.units[heading.unit]!.start)?.moved === true
        : false
      result = at
        ? { state: moved ? 'moved' : 'exact', anchor: { ...anchor, file: at.file.id } }
        : { state: 'outdated', anchor: null }
    } else {
      result = followText(anchor, mapper, newParsed)
    }
    entry.anchor = result.anchor
    entry.state = worse(entry.state, result.state)
  }
  return next
}

// --- planning each command ------------------------------------------------------

function plan(idea: Idea, ids: Ids, command: Command): Plan {
  const out: Plan = { pieces: new Map(), paths: new Map(), deleted: new Set() }
  switch (command.command) {
    case 'replace': {
      const scope = scopeOf(idea, command.in)
      const text = scope.file.source.slice(scope.start, scope.end)
      const found = occurrences(text, command.old)
      if (found.length === 0) {
        throw new Fail('no_match', `"${short(command.old)}" isn't in ${command.in}`)
      }
      if (found.length > 1) {
        throw new Fail(
          'ambiguous',
          `"${short(command.old)}" occurs ${found.length} times in ${command.in}; include more text`,
        )
      }
      const start = scope.start + found[0]!
      const end = start + command.old.length
      out.pieces.set(scope.file.id, replaceRange(scope.file, start, end, command.new))
      return out
    }
    case 'insert': {
      const markdown = tidy(command.markdown)
      if (!markdown) {
        throw new Fail('invalid', 'nothing to insert')
      }
      const at = insertionPoint(idea, command.at)
      out.pieces.set(
        at.file.id,
        applyEdit(at.file.id, at.file.source.length, {
          deletes: [],
          inserts: [{ at: at.offset, pieces: [text(at.prefix + indentRest(markdown, at.indent) + at.suffix)] }],
        }),
      )
      return out
    }
    case 'delete': {
      const target = unitTarget(idea, command.target, command.expect)
      out.pieces.set(
        target.file.id,
        applyEdit(target.file.id, target.file.source.length, { deletes: [target.removal], inserts: [] }),
      )
      return out
    }
    case 'move': {
      const target = unitTarget(idea, command.target, command.expect)
      const destinationId = 'before' in command.to ? command.to.before : 'after' in command.to ? command.to.after : null
      if (destinationId) {
        const destination = locate(idea, destinationId)
        if (destination?.file.id === target.file.id) {
          const unit = destination.parsed.units[destination.unit]!
          if (unit.start >= target.extent[0] && unit.start < target.extent[1]) {
            throw new Fail('invalid', `can't move ${command.target} next to something inside itself`)
          }
        }
      }
      const at = insertionPoint(idea, command.to)
      if (at.file.id === target.file.id && at.offset > target.removal[0] && at.offset < target.removal[1]) {
        throw new Fail('invalid', `can't move ${command.target} into itself`)
      }
      const moved: Piece[] = [
        text(at.prefix),
        { kind: 'copy', file: target.file.id, start: target.extent[0], end: target.extent[1], moved: true },
        text(at.suffix),
      ]
      if (at.file.id === target.file.id) {
        out.pieces.set(
          target.file.id,
          applyEdit(target.file.id, target.file.source.length, {
            deletes: [target.removal],
            inserts: [{ at: at.offset, pieces: moved }],
          }),
        )
      } else {
        out.pieces.set(
          target.file.id,
          applyEdit(target.file.id, target.file.source.length, { deletes: [target.removal], inserts: [] }),
        )
        out.pieces.set(
          at.file.id,
          applyEdit(at.file.id, at.file.source.length, { deletes: [], inserts: [{ at: at.offset, pieces: moved }] }),
        )
      }
      return out
    }
    case 'move-text': {
      const from = blockText(idea, command.in)
      const found = occurrences(from.source, command.old)
      if (found.length !== 1) {
        throw new Fail(
          found.length === 0 ? 'no_match' : 'ambiguous',
          found.length === 0
            ? `"${short(command.old)}" isn't in ${command.in}`
            : `"${short(command.old)}" occurs ${found.length} times in ${command.in}; include more text`,
        )
      }
      if (/\n\s*\n/.test(command.old)) {
        throw new Fail('invalid', 'moved text stays within a block; move whole blocks with move')
      }
      if (command.old.trim() === from.source.trim()) {
        throw new Fail('invalid', `that's all of ${command.in}: move the block with move`)
      }
      const start = from.start + found[0]!
      const end = start + command.old.length
      const to = blockText(idea, command.to.in)
      const near = 'before' in command.to ? command.to.before : command.to.after
      const places = occurrences(to.source, near)
      if (places.length !== 1) {
        throw new Fail(
          places.length === 0 ? 'no_match' : 'ambiguous',
          places.length === 0
            ? `"${short(near)}" isn't in ${command.to.in}`
            : `"${short(near)}" occurs ${places.length} times in ${command.to.in}; include more text`,
        )
      }
      const at = to.start + places[0]! + ('after' in command.to ? near.length : 0)
      if (to.file.id === from.file.id && at > start && at < end) {
        throw new Fail('invalid', "can't move text into itself")
      }
      const moved: Piece = { kind: 'copy', file: from.file.id, start, end, moved: true }
      if (to.file.id === from.file.id) {
        out.pieces.set(
          from.file.id,
          applyEdit(from.file.id, from.file.source.length, {
            deletes: [[start, end]],
            inserts: [{ at, pieces: [moved] }],
          }),
        )
      } else {
        out.pieces.set(
          from.file.id,
          applyEdit(from.file.id, from.file.source.length, { deletes: [[start, end]], inserts: [] }),
        )
        out.pieces.set(
          to.file.id,
          applyEdit(to.file.id, to.file.source.length, { deletes: [], inserts: [{ at, pieces: [moved] }] }),
        )
      }
      return out
    }
    case 'rename-heading': {
      const target = unitTarget(idea, command.target, command.expect)
      const title = command.title.trim()
      if (!title || /[\r\n]/.test(title)) {
        throw new Fail('invalid', 'a heading title must be one non-empty line')
      }
      const unit = target.parsed.units[target.unit]!
      if (command.level === undefined || command.level === unit.level) {
        const [start, end] = headingText(target.file.source, unit.start, unit.end)
        out.pieces.set(target.file.id, replaceRange(target.file, start, end, title))
        return out
      }
      // a new level: the heading rewritten as # to ######, a setext one too, only what changed
      // replaced, so a comment on its words stays on them
      const { file } = target
      out.pieces.set(file.id, [
        ...identity(file.id, unit.start),
        ...diffPieces(
          file.id,
          file.source.slice(unit.start, unit.end),
          `${'#'.repeat(command.level)} ${title}`,
          unit.start,
        ),
        { kind: 'copy', file: file.id, start: unit.end, end: file.source.length, moved: false },
      ])
      return out
    }
    case 'set-section': {
      const target = unitTarget(idea, command.target, command.expect)
      const markdown = tidy(command.markdown)
      if (parseMarkdown(markdown).units.some((u) => u.kind === 'heading')) {
        throw new Fail('invalid', 'set-section rewrites a body without headings; insert a subsection instead')
      }
      const { parsed, file } = target
      const section = parsed.sections.find((s) => s.heading === target.unit)!
      const heading = parsed.units[target.unit]!
      const following = parsed.units[section.bodyLast + 1]
      const regionEnd = following ? lineStartIfBlank(file.source, following.start) : file.source.length
      const tail = following ? '\n\n' : '\n'
      const region = markdown ? `\n\n${markdown}${tail}` : tail
      out.pieces.set(file.id, [
        ...identity(file.id, heading.end),
        ...diffPieces(file.id, file.source.slice(heading.end, regionEnd), region, heading.end),
        { kind: 'copy', file: file.id, start: regionEnd, end: file.source.length, moved: false },
      ])
      return out
    }
    case 'rename-file': {
      const file = fileOrFail(idea, command.file)
      checkNewPath(idea, command.path, file.id)
      out.paths.set(file.id, command.path)
      return out
    }
    case 'create-file': {
      checkNewPath(idea, command.path, null)
      const id = ids.file()
      const markdown = tidy(command.markdown)
      out.pieces.set(id, markdown ? [text(`${markdown}\n`)] : [])
      out.paths.set(id, command.path)
      return out
    }
    case 'delete-file': {
      fileOrFail(idea, command.file)
      if (idea.files.length === 1) {
        throw new Fail('invalid', 'an idea needs at least one file')
      }
      out.deleted.add(command.file)
      return out
    }
  }
}

function text(value: string): Piece {
  return { kind: 'text', text: value, replaces: null, explicit: false }
}

function replaceRange(file: IdeaFile, start: number, end: number, value: string): Piece[] {
  return applyEdit(file.id, file.source.length, {
    deletes: [[start, end]],
    inserts: [
      { at: start, pieces: [{ kind: 'text', text: value, replaces: { file: file.id, start, end }, explicit: true }] },
    ],
  })
}

function scopeOf(idea: Idea, id: string): { file: IdeaFile; start: number; end: number } {
  if (id.startsWith('f')) {
    const file = fileOrFail(idea, id)
    return { file, start: 0, end: file.source.length }
  }
  const at = locate(idea, id)
  if (!at) {
    throw new Fail('not_found', `${id} isn't in this version`)
  }
  const unit = at.parsed.units[at.unit]!
  if (unit.kind !== 'heading') {
    return { file: at.file, start: unit.start, end: unit.end }
  }
  const [start, end] = sectionExtent(at.parsed, at.unit)
  return { file: at.file, start, end }
}

/** A block's own text (a heading's line, not its section): where it is, and its source. */
function blockText(idea: Idea, id: string): { file: IdeaFile; start: number; end: number; source: string } {
  const at = locate(idea, id)
  if (!at) {
    throw new Fail('not_found', `${id} isn't in this version`)
  }
  const unit = at.parsed.units[at.unit]!
  return { file: at.file, start: unit.start, end: unit.end, source: at.file.source.slice(unit.start, unit.end) }
}

type UnitTarget = {
  file: IdeaFile
  parsed: ParsedFile
  unit: number
  /** The text that moves: the block, or the whole section. */
  extent: [number, number]
  /** What deleting it removes: the extent plus the blank lines that went with it. */
  removal: [number, number]
}

function unitTarget(idea: Idea, id: string, expect: string | undefined): UnitTarget {
  const at = locate(idea, id)
  if (!at) {
    throw new Fail('not_found', `${id} isn't in this version`)
  }
  const unit = at.parsed.units[at.unit]!
  if (id.startsWith('s') !== (unit.kind === 'heading')) {
    throw new Fail('invalid', `${id} isn't a ${id.startsWith('s') ? 'section' : 'block'}`)
  }
  if (expect !== undefined && at.file.source.slice(unit.start, unit.end) !== expect) {
    throw new Fail('expect_mismatch', `${id} has changed since the batch was made`)
  }
  const extent: [number, number] =
    unit.kind === 'heading' ? sectionExtent(at.parsed, at.unit) : [unit.extentStart, unit.extentEnd]
  return { ...at, extent, removal: removalRange(at.parsed, extent[0], extent[1]) }
}

export function sectionExtent(parsed: ParsedFile, headingUnit: number): [number, number] {
  const section = parsed.sections.find((s) => s.heading === headingUnit)!
  let end = parsed.units[headingUnit]!.end
  for (let u = headingUnit; u <= section.last; u++) {
    end = Math.max(end, parsed.units[u]!.extentEnd)
  }
  return [parsed.units[headingUnit]!.start, end]
}

/** The range to remove for [from, to), with the blank lines and indentation that went with it. */
function removalRange(parsed: ParsedFile, from: number, to: number): [number, number] {
  const { source, units } = parsed
  const start = lineStartIfBlank(source, from)
  const next = units.find((u) => u.start >= to)
  if (next) {
    return [start, lineStartIfBlank(source, next.start)]
  }
  const previous = units.findLast((u) => u.end <= from)
  if (previous) {
    return [previous.end, to]
  }
  return [0, source.length]
}

type Insertion = { file: IdeaFile; offset: number; prefix: string; suffix: string; indent: number }

function insertionPoint(idea: Idea, position: Position): Insertion {
  if ('start' in position || 'end' in position) {
    const file = fileOrFail(idea, 'start' in position ? position.start : position.end)
    const { units } = parseMarkdown(file.source)
    if ('start' in position) {
      const front = units[0]?.kind === 'front-matter' ? units[0] : null
      if (front) {
        return { file, offset: front.end, prefix: '\n\n', suffix: '', indent: 0 }
      }
      return { file, offset: 0, prefix: '', suffix: file.source.trim() ? '\n\n' : '\n', indent: 0 }
    }
    if (units.length === 0) {
      return { file, offset: file.source.length, prefix: '', suffix: '\n', indent: 0 }
    }
    return { file, offset: Math.max(...units.map((u) => u.extentEnd)), prefix: '\n\n', suffix: '', indent: 0 }
  }
  const id = 'before' in position ? position.before : position.after
  const at = locate(idea, id)
  if (!at) {
    throw new Fail('not_found', `${id} isn't in this version`)
  }
  const unit = at.parsed.units[at.unit]!
  const source = at.file.source
  if (unit.kind === 'heading') {
    if ('before' in position) {
      return { file: at.file, offset: lineStartIfBlank(source, unit.start), prefix: '', suffix: '\n\n', indent: 0 }
    }
    return { file: at.file, offset: sectionExtent(at.parsed, at.unit)[1], prefix: '\n\n', suffix: '', indent: 0 }
  }
  const listItem = unit.kind === 'list-item'
  const indent = listItem ? unit.indent : 0
  if ('before' in position) {
    return {
      file: at.file,
      offset: lineStartIfBlank(source, unit.extentStart),
      prefix: ' '.repeat(indent),
      suffix: listItem ? '\n' : '\n\n',
      indent,
    }
  }
  return {
    file: at.file,
    offset: unit.extentEnd,
    prefix: listItem ? `\n${' '.repeat(indent)}` : '\n\n',
    suffix: '',
    indent,
  }
}

/** The text of a heading, without its `#` markers or setext underline. */
function headingText(source: string, start: number, end: number): [number, number] {
  const firstLineEnd = Math.min(lineEnd(source, start), end)
  const line = source.slice(start, firstLineEnd)
  const atx = /^ {0,3}(#{1,6})(?:[ \t]+|$)/.exec(line)
  if (atx) {
    let contentEnd = firstLineEnd
    const closing = /[ \t]+#+[ \t]*$/.exec(line)
    if (closing) {
      contentEnd = start + closing.index
    }
    while (contentEnd > start + atx[0].length && /[ \t]/.test(source[contentEnd - 1]!)) {
      contentEnd--
    }
    return [start + atx[0].length, Math.max(start + atx[0].length, contentEnd)]
  }
  // setext: the text is every line before the underline
  const underline = source.lastIndexOf('\n', end - 1)
  let contentStart = start
  while (/[ \t]/.test(source[contentStart] ?? '')) {
    contentStart++
  }
  let contentEnd = underline
  while (contentEnd > contentStart && /[ \t]/.test(source[contentEnd - 1]!)) {
    contentEnd--
  }
  return [contentStart, contentEnd]
}

function fileOrFail(idea: Idea, id: string): IdeaFile {
  const file = fileById(idea, id)
  if (!file) {
    throw new Fail('not_found', `${id} isn't in this version`)
  }
  return file
}

function checkNewPath(idea: Idea, path: string, self: string | null): void {
  const problem = pathProblem(path)
  if (problem) {
    throw new Fail('invalid', `${path}: ${problem}`)
  }
  const taken = idea.files.find((f) => f.id !== self && f.path.toLowerCase() === path.toLowerCase())
  if (taken) {
    throw new Fail('invalid', `${path} is already used by ${taken.id}`)
  }
}

export function occurrences(text: string, needle: string): number[] {
  const found: number[] = []
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) {
    found.push(i)
  }
  return found
}

/** Drops leading blank lines and trailing whitespace, keeping the first line's indentation. */
function tidy(markdown: string): string {
  return markdown.replace(/^(?:[ \t]*\r?\n)+/, '').trimEnd()
}

function indentRest(markdown: string, indent: number): string {
  if (indent === 0) {
    return markdown
  }
  const pad = ' '.repeat(indent)
  return markdown.replace(/\n(?=[^\n])/g, `\n${pad}`)
}

function short(value: string): string {
  return value.length > 60 ? `${value.slice(0, 57)}…` : value
}
