// The idea's draft as live documents (docs/handoff-live-editing.md, step 2): one page-editor document
// for each file the draft has changed, held here and kept in the idea's SQLite as the file's Markdown,
// its blocks' IDs, the document, and the steps that made it. The list of changes isn't stored: it's
// the difference between the documents and the latest version, worked out by block ID with the same
// code the page editor saves with (core's draftChanges), and built as core has always built the draft.
//
// - **Keys** are made from what a change is to: `e-b3` is an edit of b3, `i-after-b3` new text after
//   b3. Editing a block again is the same change; editing it back leaves none.
// - **Who** made a change is kept by its key (draft_authors), as whoever last changed it.
// - **Held**: a change a version made around the draft has outdated stays listed, with why, until
//   it's undone (draft_held), as it always has. It's no longer in the documents.
import { type DraftChange, type EditorBlock, parseMarkdown } from '@ideaf/core'
import { applySteps, createCodec, headless, type Node, stepsTo } from '@ideaf/ui/editor/model'

/** A file of the draft as stored: its Markdown and its blocks' IDs, in order. */
export interface DraftText {
  source: string
  ids: string[]
}

/** The key of a change worked out from the documents, unique among `taken` (held changes keep theirs). */
export function keyOf(change: DraftChange, taken: Set<string>): string {
  const base = (() => {
    switch (change.kind) {
      case 'edit':
        return `e-${change.id}`
      case 'delete':
        return `d-${change.id}`
      case 'move':
        return `m-${change.id}`
      case 'move-text':
        return `t-${change.from}-${change.to.in}`
      case 'suggestion':
        return `s-${change.comment}`
      case 'insert': {
        const at = change.at as Record<string, unknown>
        const where = Object.entries(at)
          .map(([k, v]) => `${k}-${String(v)}`)
          .join('-')
        return `i-${where}`.slice(0, 60)
      }
    }
  })()
  let key = base
  for (let n = 2; taken.has(key); n++) {
    key = `${base}-${n}`
  }
  taken.add(key)
  return key
}

/** The blocks a change names: what to look for when telling the caller which change took it. */
export function blocksNamed(change: DraftChange): string[] {
  switch (change.kind) {
    case 'edit':
    case 'delete':
    case 'move':
      return [change.id]
    case 'move-text':
      return [change.from, change.to.in]
    case 'insert':
    case 'suggestion':
      return []
  }
}

/** A stored file's blocks, as the page editor gives them: each with its ID (unknown IDs are new text). */
export function blocksOf(text: DraftText): EditorBlock[] {
  return parseMarkdown(text.source).units.map((u, i) => ({
    id: text.ids[i] ?? null,
    source: text.source.slice(u.start, u.end),
  }))
}

/** One file's live document: the editor's schema for it (made once), the document, and its step count. */
interface Live {
  env: Awaited<ReturnType<typeof headless>>
  doc: Node
  steps: number
}

/** What retargeting a file does: its document after, the steps (as stored), and its count after. */
export interface Retargeted {
  file: string
  doc: Node
  steps: unknown[]
  count: number
}

/**
 * The draft's documents, kept in memory between writes (the actor's writes run one at a time). A
 * document is read from its row, or opened from the latest version for a file the draft hasn't
 * changed, and changed only by `commit`, once its steps are stored.
 */
export class LiveDrafts {
  #files = new Map<string, Live>()

  /** The file's document, as stored (`row`), or as the latest version has it (`fallback`). */
  async #live(
    file: string,
    row: { steps: number; doc: string; source: string; ids: string } | null,
    fallback: DraftText,
    stepsAfter: () => Promise<unknown[]>,
  ): Promise<Live> {
    const had = this.#files.get(file)
    if (had && had.steps === (row?.steps ?? 0)) {
      return had
    }
    const text = row ? { source: row.source, ids: JSON.parse(row.ids) as string[] } : fallback
    const env = await headless(text.source)
    let doc = row
      ? env.schema.nodeFromJSON(JSON.parse(row.doc))
      : createCodec({ ...env, flavor: 'page' }).open(text.source, text.ids)
    // steps taken after the snapshot (none yet: every write stores its document)
    const after = row ? await stepsAfter() : []
    doc = applySteps(env.schema, doc, after)
    const live = { env, doc, steps: (row?.steps ?? 0) + after.length }
    this.#files.set(file, live)
    return live
  }

  /** The steps that make the file's document read as `target`: worked out, not yet kept. */
  async retarget(
    file: string,
    row: { steps: number; doc: string; source: string; ids: string } | null,
    fallback: DraftText,
    target: DraftText,
    stepsAfter: () => Promise<unknown[]>,
  ): Promise<Retargeted> {
    const live = await this.#live(file, row, fallback, stepsAfter)
    const wanted = createCodec({ ...live.env, flavor: 'page' }).open(target.source, target.ids)
    const steps = stepsTo(live.doc, wanted)
    return { file, doc: wanted, steps: steps.map((s) => s.toJSON()), count: live.steps + steps.length }
  }

  /** Retargeted documents, once their steps are stored. */
  commit(done: Retargeted[]): void {
    for (const r of done) {
      const live = this.#files.get(r.file)
      if (live) {
        this.#files.set(r.file, { ...live, doc: r.doc, steps: r.count })
      }
    }
  }

  /** Forgets every document (a write failed after working them out). */
  forget(): void {
    this.#files.clear()
  }
}
