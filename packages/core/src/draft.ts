// An idea's draft: one per idea, shared by everyone who can edit it. It's a
// list of changes on the latest version; committing it makes them one new
// version.
//
// - **Changes, not commands:** an edit of a block (its new source), new text
//   at a place, a deletion, a move of a block or section or of some of a
//   block's text, or an accepted suggestion. Each is turned into
//   commands against the draft as it is at that point, in the order they were
//   made, so a later change builds on an earlier one.
// - **Checked, never guessed:** an edit or deletion remembers the block as it
//   was (`was`). If the block reads differently there now (someone changed it,
//   in the draft or in a newer version), the change is outdated and says so.
//   A suggestion whose text has gone is outdated the same way.
// - **Always on the latest version:** the draft is built on whatever the
//   latest version is, so a version made elsewhere (an agent's batch, an
//   upload) shows straight away as changes that still apply, or don't.
// - **IDs as committing makes them:** the draft is built from the latest
//   version's next ID, so new text has the IDs it will have once committed,
//   and a later change can name it like any block.
//
// Comments are followed through every change, so the draft knows where each
// one would be, and suggestions find their text after earlier changes.
import { applyBatch } from './apply.ts'
import { z } from 'zod'
import { type Command, Position, TextPlace } from './batch.ts'
import { blockEdit } from './edit.ts'
import { worse } from './follow.ts'
import type { Anchor, AnchorState, Comment, CommentOutcome, Idea } from './idea.ts'
import { parseMarkdown, type UnitKind } from './markdown.ts'
import { suggestionCommand } from './suggest.ts'

const BlockId = z.string().regex(/^[bs][0-9]+$/, 'a block (b…) or section (s…) ID')
const Source = z.string().max(1_000_000)

/** A change to the draft: what the web app's editor (and, later, a full editor) sends. */
export const DraftChange = z.discriminatedUnion('kind', [
  /** A block's (or a heading's) new source; `was`, the block as the change was made against. */
  z.strictObject({ kind: z.literal('edit'), id: BlockId, source: Source, was: Source }),
  /** A block, or a heading and its section. */
  z.strictObject({ kind: z.literal('delete'), id: BlockId, was: Source }),
  z.strictObject({ kind: z.literal('insert'), at: Position, markdown: Source.min(1) }),
  /** A block, or a heading and its section, to a new place, perhaps in another file; its comments go with it. */
  z.strictObject({ kind: z.literal('move'), id: BlockId, to: Position, was: Source }),
  /** Some of a block's text (`old`, once in it) into a block; `was`, both blocks as the change was made against. */
  z.strictObject({
    kind: z.literal('move-text'),
    from: BlockId,
    old: Source.min(1),
    to: TextPlace,
    was: z.strictObject({ from: Source, to: Source }),
  }),
  /** A suggestion accepted into the draft: its comment, and its change. */
  z.strictObject({ kind: z.literal('suggestion'), comment: z.string().max(64), old: Source, new: Source }),
])
export type DraftChange = z.infer<typeof DraftChange>

export interface DraftEntry {
  key: string
  change: DraftChange
}

/** A unit of the draft, as an editor shows it. */
export interface DraftUnit {
  id: string
  kind: UnitKind
  source: string
  level: number
  /** A block that was in the latest version (changed in the draft or not), or new text and the change that added it. */
  origin: { kind: 'base'; changed: boolean } | { kind: 'new'; change: string }
}

export interface DraftFile {
  id: string
  path: string
  source: string
  unitIds: string[]
  units: DraftUnit[]
}

export interface BuiltDraft {
  idea: Idea
  files: DraftFile[]
  /** The batch that commits it: its commands, and the change each came from. */
  commands: Command[]
  owners: string[]
  /** Changes that don't apply (outdated), and why, by key. */
  problems: Record<string, string>
  /** Where each comment would be, and how it fared. */
  comments: CommentOutcome[]
}

/** The draft on `base`, the latest version, with its open comments. */
export function buildDraft(base: Idea, comments: Comment[], entries: DraftEntry[]): BuiltDraft {
  const problems: Record<string, string> = {}
  const commands: Command[] = []
  const owners: string[] = []
  const madeBy = new Map<string, string>()
  // comments as they go: where each is now, and the worst that's happened to it
  let anchors = new Map<string, Anchor | null>(comments.map((c) => [c.id, c.anchor]))
  const states = new Map<string, AnchorState>(comments.map((c) => [c.id, 'exact']))
  let idea = base

  for (const { key, change } of entries) {
    const built = commandsFor(idea, anchors, change)
    if (!built.ok) {
      problems[key] = built.message
      continue
    }
    if (built.commands.length === 0) {
      continue
    }
    const tracked = [...anchors].flatMap(([id, anchor]) => (anchor ? [{ id, anchor }] : []))
    const applied = applyBatch(idea, tracked, { base: 1, steps: built.commands })
    if (!applied.ok) {
      problems[key] = applied.conflicts.map((c) => c.message).join('; ')
      continue
    }
    const before = new Set(idea.files.flatMap((f) => f.unitIds))
    for (const id of applied.idea.files.flatMap((f) => f.unitIds)) {
      if (!before.has(id)) {
        madeBy.set(id, madeBy.get(id) ?? key)
      }
    }
    for (const outcome of applied.comments) {
      anchors.set(outcome.id, outcome.anchor)
      states.set(outcome.id, worse(states.get(outcome.id) ?? 'exact', outcome.state))
    }
    anchors = new Map(anchors)
    idea = applied.idea
    commands.push(...built.commands)
    owners.push(...built.commands.map(() => key))
  }

  const baseIds = new Set(base.files.flatMap((f) => f.unitIds))
  const files = idea.files.map((file): DraftFile => {
    const parsed = parseMarkdown(file.source)
    const original = base.files.find((f) => f.id === file.id)
    const was = original ? parseMarkdown(original.source) : null
    return {
      id: file.id,
      path: file.path,
      source: file.source,
      unitIds: file.unitIds,
      units: parsed.units.map((unit, i): DraftUnit => {
        const id = file.unitIds[i]!
        const source = file.source.slice(unit.start, unit.end)
        const made = madeBy.get(id)
        // a base block is changed if it reads differently from the latest version
        const at = original ? original.unitIds.indexOf(id) : -1
        const then = at >= 0 && was ? original!.source.slice(was.units[at]!.start, was.units[at]!.end) : null
        return {
          id,
          kind: unit.kind,
          source,
          level: unit.level,
          origin: baseIds.has(id) || !made ? { kind: 'base', changed: then !== source } : { kind: 'new', change: made },
        }
      }),
    }
  })
  return {
    idea,
    files,
    commands,
    owners,
    problems,
    comments: comments.map((c) => ({
      id: c.id,
      state: states.get(c.id) ?? 'exact',
      anchor: anchors.get(c.id) ?? null,
    })),
  }
}

/** How a change goes into the draft: as a change of its own, into one already there, or taking one out. */
export type DraftAddition =
  | { op: 'add'; entry: DraftEntry }
  | { op: 'update'; entry: DraftEntry }
  | { op: 'remove'; key: string }

/**
 * A change added to the draft as the draft keeps it: the difference from the latest version, not
 * the history of typing. `by` is who made it (any string that tells people apart).
 *
 * - **An edit after your own edit** of the same block folds into it, wherever it is in the draft,
 *   as long as nothing after it changed the block: typing in a paragraph for a minute, saved at
 *   every pause, is one change.
 * - **An edit of text you added** folds into the addition, if that added only this block.
 * - **Back to how it was:** a block edited back to what it was before your edit takes the edit out
 *   (and text you added, edited away, takes the addition out).
 * - **Otherwise** it's a change of its own, `key`.
 *
 * A fold is kept only if the draft still builds as it did (no change in it newly outdated);
 * otherwise the change is added as its own. With it, the draft as built, and why the change
 * doesn't apply, if it doesn't.
 */
export function addChange(
  base: Idea,
  comments: Comment[],
  entries: Array<DraftEntry & { by: string }>,
  change: DraftChange,
  by: string,
  key: string,
): { addition: DraftAddition; built: BuiltDraft; problem: string | null } {
  const plain = (list: Array<DraftEntry & { by?: string }>) => list.map(({ key, change }) => ({ key, change }))
  const folded = foldInto(base, comments, entries, change, by)
  if (folded) {
    const next =
      folded.op === 'remove'
        ? entries.filter((e) => e.key !== folded.key)
        : entries.map((e) => (e.key === folded.entry.key ? { ...e, change: folded.entry.change } : e))
    const before = buildDraft(base, comments, plain(entries))
    const built = buildDraft(base, comments, plain(next))
    const worse = Object.keys(built.problems).some((k) => !(k in before.problems))
    if (!worse) {
      return { addition: folded, built, problem: null }
    }
  }
  const built = buildDraft(base, comments, [...plain(entries), { key, change }])
  return { addition: { op: 'add', entry: { key, change } }, built, problem: built.problems[key] ?? null }
}

/** The fold an edit makes into a change of yours already in the draft, if it makes one. */
function foldInto(
  base: Idea,
  comments: Comment[],
  entries: Array<DraftEntry & { by: string }>,
  change: DraftChange,
  by: string,
): DraftAddition | null {
  if (change.kind !== 'edit') {
    return null
  }
  // the last change in the draft that touched this block
  const built = buildDraft(
    base,
    comments,
    entries.map(({ key, change }) => ({ key, change })),
  )
  const madeBy = built.files.flatMap((f) => f.units).find((u) => u.id === change.id)?.origin
  const touches = (e: DraftChange) =>
    ((e.kind === 'edit' || e.kind === 'delete' || e.kind === 'move') && e.id === change.id) ||
    (e.kind === 'move-text' && (e.from === change.id || e.to.in === change.id))
  const last = [...entries]
    .reverse()
    .find((e) => touches(e.change) || (madeBy?.kind === 'new' && madeBy.change === e.key))
  if (!last || last.by !== by) {
    return null
  }
  if (last.change.kind === 'edit' && last.change.source === change.was) {
    return last.change.was.trim() === change.source.trim()
      ? { op: 'remove', key: last.key }
      : { op: 'update', entry: { key: last.key, change: { ...last.change, source: change.source } } }
  }
  if (last.change.kind === 'insert' && last.change.markdown.trim() === change.was.trim()) {
    // only an addition of this block alone
    const made = built.files
      .flatMap((f) => f.units)
      .filter((u) => u.origin.kind === 'new' && u.origin.change === last.key)
    if (made.length !== 1) {
      return null
    }
    return change.source.trim() === ''
      ? { op: 'remove', key: last.key }
      : { op: 'update', entry: { key: last.key, change: { ...last.change, markdown: change.source } } }
  }
  return null
}

/** The commands for one change, against the draft as it is at that point. */
function commandsFor(
  idea: Idea,
  anchors: Map<string, Anchor | null>,
  change: DraftChange,
): { ok: true; commands: Command[] } | { ok: false; message: string } {
  switch (change.kind) {
    case 'insert':
      return change.markdown.trim()
        ? { ok: true, commands: [{ command: 'insert', at: change.at, markdown: change.markdown }] }
        : { ok: true, commands: [] }
    case 'suggestion': {
      const anchor = anchors.get(change.comment) ?? null
      if (!anchor) {
        return { ok: false, message: 'its text is gone' }
      }
      const built = suggestionCommand(idea, anchor, change, [change.comment])
      return built.ok ? { ok: true, commands: [built.command] } : built
    }
    case 'move-text': {
      const from = unitSource(idea, change.from)
      const to = unitSource(idea, change.to.in)
      if (from === null || to === null) {
        return { ok: false, message: 'what it changes is gone' }
      }
      if (from !== change.was.from || to !== change.was.to) {
        return { ok: false, message: 'that block has changed since; undo this, and edit it again' }
      }
      return { ok: true, commands: [{ command: 'move-text', in: change.from, old: change.old, to: change.to }] }
    }
    case 'edit':
    case 'delete':
    case 'move': {
      const now = unitSource(idea, change.id)
      if (now === null) {
        return { ok: false, message: 'what it changes is gone' }
      }
      if (now !== change.was) {
        return { ok: false, message: 'that block has changed since; undo this, and edit it again' }
      }
      if (change.kind === 'move') {
        return { ok: true, commands: [{ command: 'move', target: change.id, to: change.to, expect: now }] }
      }
      return change.kind === 'edit'
        ? blockEdit(idea, change.id, change.source)
        : { ok: true, commands: [{ command: 'delete', target: change.id, expect: now }] }
    }
  }
}

/** A unit's source, by ID, or null if it isn't in the idea. */
export function unitSource(idea: Idea, id: string): string | null {
  for (const file of idea.files) {
    const i = file.unitIds.indexOf(id)
    if (i >= 0) {
      const unit = parseMarkdown(file.source).units[i]!
      return file.source.slice(unit.start, unit.end)
    }
  }
  return null
}
