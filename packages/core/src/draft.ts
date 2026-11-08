// An idea's draft: one per idea, shared by everyone who can edit it. It's a
// list of changes on the latest version; committing it makes them one new
// version.
//
// - **Changes, not commands:** an edit of a block (its new source), new text
//   at a place, a deletion, or an accepted suggestion. Each is turned into
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
import { type Command, Position } from './batch.ts'
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
    case 'edit':
    case 'delete': {
      const now = unitSource(idea, change.id)
      if (now === null) {
        return { ok: false, message: 'what it changes is gone' }
      }
      if (now !== change.was) {
        return { ok: false, message: 'that block has changed since; undo this, and edit it again' }
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
