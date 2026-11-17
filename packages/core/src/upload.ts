// Re-anchoring an uploaded copy: no command says what happened, so IDs and
// comments are followed through a diff of each file's plain-text form, from
// its base (the latest version) to the upload. Only exact rules, in order:
//
// 1. Follow positions through the diff. Unchanged text maps exactly, so
//    duplicated text is no problem: each copy keeps its own comments.
// 2. Blocks that moved unchanged: a block deleted from one place whose text
//    matches exactly one block inserted somewhere (in any file of the idea)
//    carries its ID and comments along, marked *moved*.
// 3. Headings renamed in place: same place, same level, and the section's body
//    unchanged, so it's the same section.
// 4. Anything else is *outdated*. Nothing is guessed.
//
// Whether the upload may land at all (its base must be the latest version) is
// the idea actor's check, made before this runs.
import { fillIds, followText, matchUnits, type OldFile, plainMapper, worse } from './follow.ts'
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
import { parseMarkdown, type ParsedFile, type Unit } from './markdown.ts'
import { diffPieces, identity, type Piece, PieceMap } from './pieces.ts'

export interface Upload {
  /** Uploaded files. `file` names an existing file (which may have a new path, for a rename); without it the file is new. */
  files: Array<{ file?: string; path: string; content: string }>
  /** Existing files the upload removes. Files neither uploaded nor removed are unchanged. */
  deleted?: string[]
}

export type UploadResult = { ok: true; idea: Idea; comments: CommentOutcome[] } | { ok: false; problems: string[] }

export function applyUpload(idea: Idea, comments: Comment[], upload: Upload): UploadResult {
  const problems = check(idea, upload)
  if (problems.length > 0) {
    return { ok: false, problems }
  }

  const ids = new Ids(idea.nextId)
  const deleted = new Set(upload.deleted ?? [])
  const uploaded = new Map(upload.files.filter((f) => f.file).map((f) => [f.file!, f]))

  // the new version's files, existing ones first in their old order
  const next: Array<{ id: string; path: string; source: string }> = []
  for (const file of idea.files) {
    if (deleted.has(file.id)) {
      continue
    }
    const up = uploaded.get(file.id)
    next.push({ id: file.id, path: up?.path ?? file.path, source: up?.content ?? file.source })
  }
  for (const f of upload.files) {
    if (!f.file) {
      next.push({ id: ids.file(), path: f.path, source: f.content })
    }
  }

  const oldParsed = new Map(idea.files.map((f) => [f.id, parseMarkdown(f.source)]))
  const newParsed = new Map(next.map((f) => [f.id, parseMarkdown(f.source)]))

  // 1. follow positions through each file's plain-text diff
  const pieces = new Map<string, Piece[]>()
  for (const f of next) {
    const before = oldParsed.get(f.id)
    const after = newParsed.get(f.id)!
    if (!before) {
      pieces.set(
        f.id,
        after.plain.text ? [{ kind: 'text', text: after.plain.text, replaces: null, explicit: false }] : [],
      )
    } else if (before.plain.text === after.plain.text) {
      pieces.set(f.id, identity(f.id, before.plain.text.length))
    } else {
      pieces.set(f.id, diffPieces(f.id, before.plain.text, after.plain.text))
    }
  }
  const map = new PieceMap(pieces)
  const old: OldFile[] = idea.files.map((file) => ({ file, parsed: oldParsed.get(file.id)! }))
  const matched = matchUnits(old, newParsed, map, 'plain')
  sameStructureForUnchanged(idea, next, oldParsed, newParsed, matched)

  // 2. blocks that moved unchanged
  const moves = matchMovedUnits(old, newParsed, map, matched)

  // 3. headings renamed in place
  matchRenamedHeadings(old, newParsed, matched)

  const unitIds = fillIds(matched, newParsed, ids)
  const files: IdeaFile[] = next.map((f) => ({ ...f, unitIds: unitIds.get(f.id)! }))
  const result: Idea = { files, nextId: ids.next }

  // comments
  const mapper = plainMapper(map)
  const outcomes = comments.map((comment): CommentOutcome => {
    const anchor = comment.anchor
    let out: { state: AnchorState; anchor: Anchor | null }
    if (anchor.kind === 'idea') {
      out = { state: 'exact', anchor }
    } else if (anchor.kind === 'file') {
      out = fileById(result, anchor.file) ? { state: 'exact', anchor } : { state: 'outdated', anchor: null }
    } else if (anchor.kind === 'section') {
      const at = locate(result, anchor.section)
      const movedHeading = [...moves.values()].some((m) => m.id === anchor.section)
      out = at
        ? { state: movedHeading ? 'moved' : 'exact', anchor: { ...anchor, file: at.file.id } }
        : { state: 'outdated', anchor: null }
    } else {
      out = followText(anchor, mapper, newParsed)
      if (out.state === 'outdated') {
        out = followMovedUnit(anchor, oldParsed, newParsed, moves) ?? out
      }
    }
    return { id: comment.id, state: worse('exact', out.state), anchor: out.anchor }
  })

  return { ok: true, idea: result, comments: outcomes }
}

function check(idea: Idea, upload: Upload): string[] {
  const problems: string[] = []
  const paths = new Map<string, string>()
  const deleted = new Set(upload.deleted ?? [])
  for (const id of deleted) {
    if (!fileById(idea, id)) {
      problems.push(`${id} isn't in this version`)
    }
  }
  const uploadedIds = new Set<string>()
  for (const f of upload.files) {
    const problem = pathProblem(f.path)
    if (problem) {
      problems.push(`${f.path}: ${problem}`)
    }
    if (f.file) {
      if (!fileById(idea, f.file)) {
        problems.push(`${f.file} isn't in this version`)
      }
      if (deleted.has(f.file)) {
        problems.push(`${f.file} is both uploaded and deleted`)
      }
      if (uploadedIds.has(f.file)) {
        problems.push(`${f.file} is uploaded twice`)
      }
      uploadedIds.add(f.file)
    }
  }
  // every path in the new version must be unique
  for (const file of idea.files) {
    if (deleted.has(file.id)) {
      continue
    }
    const up = upload.files.find((f) => f.file === file.id)
    paths.set(file.id, (up?.path ?? file.path).toLowerCase())
  }
  upload.files.forEach((f, i) => {
    if (!f.file) {
      paths.set(`new:${i}`, f.path.toLowerCase())
    }
  })
  const seen = new Set<string>()
  for (const path of paths.values()) {
    if (seen.has(path)) {
      problems.push(`${path} is used by more than one file`)
    }
    seen.add(path)
  }
  if (paths.size === 0) {
    problems.push('an idea needs at least one file')
  }
  return problems
}

/** Units with no plain text (HTML, breaks, front matter) can't follow characters; in a file whose structure is unchanged they keep their IDs by position. */
function sameStructureForUnchanged(
  idea: Idea,
  next: Array<{ id: string; source: string }>,
  oldParsed: Map<string, ParsedFile>,
  newParsed: Map<string, ParsedFile>,
  matched: Map<string, Array<string | null>>,
): void {
  for (const f of next) {
    const before = idea.files.find((x) => x.id === f.id)
    if (!before) {
      continue
    }
    const a = oldParsed.get(f.id)!
    const b = newParsed.get(f.id)!
    if (a.source !== b.source) {
      continue
    }
    matched.set(f.id, [...before.unitIds])
  }
}

type Move = { id: string; fromFile: string; fromUnit: number; toFile: string; toUnit: number }

function keyOf(parsed: ParsedFile, unit: Unit): string {
  const text = parsed.plain.text.slice(unit.plainStart, unit.plainEnd)
  const body = text || `source:${parsed.source.slice(unit.start, unit.end)}`
  return unit.kind === 'heading' ? `h${unit.level}:${body}` : `b:${body}`
}

function matchMovedUnits(
  old: OldFile[],
  next: Map<string, ParsedFile>,
  map: PieceMap,
  matched: Map<string, Array<string | null>>,
): Map<string, Move> {
  const assigned = new Set<string>()
  for (const list of matched.values()) {
    for (const id of list) {
      if (id) {
        assigned.add(id)
      }
    }
  }

  // old units that are gone: no ID carried forward, and none of their characters survived
  const gone = new Map<string, Array<{ id: string; file: string; unit: number }>>()
  for (const { file, parsed } of old) {
    parsed.units.forEach((unit, i) => {
      const id = file.unitIds[i]!
      if (assigned.has(id)) {
        return
      }
      for (let c = unit.plainStart; c < unit.plainEnd; c++) {
        if (map.map(file.id, c)) {
          return
        }
      }
      const key = keyOf(parsed, unit)
      gone.set(key, [...(gone.get(key) ?? []), { id, file: file.id, unit: i }])
    })
  }
  // new units that nothing followed into, made only of new text
  const arrived = new Map<string, Array<{ file: string; unit: number }>>()
  for (const [fileId, parsed] of next) {
    const list = matched.get(fileId)!
    parsed.units.forEach((unit, i) => {
      if (list[i]) {
        return
      }
      const key = keyOf(parsed, unit)
      arrived.set(key, [...(arrived.get(key) ?? []), { file: fileId, unit: i }])
    })
  }
  const moves = new Map<string, Move>()
  const pairs: Array<{
    from: { id: string; file: string; unit: number }
    to: { file: string; unit: number }
    heading: boolean
  }> = []
  for (const [key, from] of gone) {
    const to = arrived.get(key)
    if (from.length !== 1 || to?.length !== 1) {
      continue
    }
    pairs.push({ from: from[0]!, to: to[0]!, heading: key.startsWith('h') })
  }
  const record = (pair: (typeof pairs)[number]) => {
    matched.get(pair.to.file)![pair.to.unit] = pair.from.id
    moves.set(`${pair.from.file}:${pair.from.unit}`, {
      id: pair.from.id,
      fromFile: pair.from.file,
      fromUnit: pair.from.unit,
      toFile: pair.to.file,
      toUnit: pair.to.unit,
    })
  }
  // blocks first; then a heading only if its whole body moved unchanged with it,
  // so a section moved and edited in the same upload isn't followed
  for (const pair of pairs) {
    if (!pair.heading) {
      record(pair)
    }
  }
  const oldById = new Map(old.map((o) => [o.file.id, o]))
  for (const pair of pairs) {
    if (!pair.heading) {
      continue
    }
    const { file, parsed } = oldById.get(pair.from.file)!
    const section = parsed.sections.find((s) => s.heading === pair.from.unit)!
    const newSection = next.get(pair.to.file)!.sections.find((s) => s.heading === pair.to.unit)!
    const body = section.bodyLast - section.heading
    if (body === 0 || newSection.bodyLast - newSection.heading !== body) {
      continue
    }
    const ids = matched.get(pair.to.file)!
    let together = true
    for (let i = 1; i <= body; i++) {
      const moved = moves.get(`${pair.from.file}:${pair.from.unit + i}`)
      if (
        !moved ||
        moved.toFile !== pair.to.file ||
        moved.toUnit !== pair.to.unit + i ||
        ids[pair.to.unit + i] !== file.unitIds[pair.from.unit + i]
      ) {
        together = false
      }
    }
    if (together) {
      record(pair)
    }
  }
  return moves
}

function matchRenamedHeadings(
  old: OldFile[],
  next: Map<string, ParsedFile>,
  matched: Map<string, Array<string | null>>,
): void {
  const assigned = new Set<string>()
  for (const list of matched.values()) {
    for (const id of list) {
      if (id) {
        assigned.add(id)
      }
    }
  }
  for (const { file, parsed } of old) {
    const newParsed = next.get(file.id)
    if (!newParsed) {
      continue
    }
    const newIds = matched.get(file.id)!
    for (const section of parsed.sections) {
      const headingId = file.unitIds[section.heading]!
      if (assigned.has(headingId)) {
        continue
      }
      const body = range(section.heading + 1, section.bodyLast)
      if (body.length === 0) {
        continue // nothing to recognise it by
      }
      // every body unit followed, unchanged, into one run of units in the same file
      const positions = body.map((u) => newIds.indexOf(file.unitIds[u]!))
      if (positions.some((p) => p < 0)) {
        continue
      }
      const first = positions[0]!
      if (positions.some((p, i) => p !== first + i)) {
        continue
      }
      const newHeading = first - 1
      const heading = newParsed.units[newHeading]
      if (!heading || heading.kind !== 'heading' || heading.level !== section.level || newIds[newHeading]) {
        continue
      }
      const newSection = newParsed.sections.find((s) => s.heading === newHeading)!
      if (newSection.bodyLast !== first + body.length - 1) {
        continue
      }
      const unchanged = body.every(
        (u, i) => keyOf(parsed, parsed.units[u]!) === keyOf(newParsed, newParsed.units[first + i]!),
      )
      if (!unchanged) {
        continue
      }
      newIds[newHeading] = headingId
      assigned.add(headingId)
    }
  }
}

function followMovedUnit(
  anchor: Extract<Anchor, { kind: 'text' }>,
  oldParsed: Map<string, ParsedFile>,
  newParsed: Map<string, ParsedFile>,
  moves: Map<string, Move>,
): { state: AnchorState; anchor: Anchor } | null {
  const parsed = oldParsed.get(anchor.file)!
  const unit = parsed.plain.unit[anchor.start]
  if (unit === undefined || unit < 0 || parsed.plain.unit[anchor.end - 1] !== unit) {
    return null
  }
  const move = moves.get(`${anchor.file}:${unit}`)
  if (!move) {
    return null
  }
  const from = parsed.units[unit]!
  const to = newParsed.get(move.toFile)!
  const target = to.units[move.toUnit]!
  const start = target.plainStart + (anchor.start - from.plainStart)
  const end = start + (anchor.end - anchor.start)
  return {
    state: 'moved',
    anchor: { kind: 'text', file: move.toFile, start, end, quote: to.plain.text.slice(start, end) },
  }
}

function range(from: number, to: number): number[] {
  const out: number[] = []
  for (let i = from; i <= to; i++) {
    out.push(i)
  }
  return out
}
