// The idea's draft as live documents (docs/handoff-live-editing.md, steps 2 and 3): one page-editor
// document for each file the draft has changed or someone has opened, held here and kept in the
// idea's SQLite as a snapshot and the steps after it. People's typing arrives as the editor's own
// steps, on the count of steps their editor had; the list of changes isn't stored: it's the
// difference between the documents and the latest version, worked out by block ID with the same code
// the page editor saves with (core's draftChanges), and built as core has always built the draft.
//
// - **Keys** are made from what a change is to: `e-b3` is an edit of b3, `i-after-b3` new text after
//   b3. Editing a block again is the same change; editing it back leaves none.
// - **Who** changed each block is kept by its ID (draft_authors); a change's are its blocks'.
// - **Held**: a change a version made around the draft has outdated stays listed, with why, until
//   it's undone (draft_held), as it always has. It's no longer in the documents.
// - **Identities** are handed out here and nowhere else: a new block (or the second of two with one
//   ID) takes the ID committing would give it, as an attribute of its own, so nobody's typing in it
//   is disturbed (normalize, in service.ts).
// - **Other writes** (an agent's change, Undo, accepting a suggestion, Discard, a version) move a
//   document to what core builds by steps that leave every block whose Markdown is the same as it
//   is: someone typing in another block carries on.
import { type DraftChange, type EditorBlock, parseMarkdown } from '@ideaf/core'
import {
  type Codec,
  createCodec,
  Fragment,
  headless,
  holders,
  type Node,
  sameText,
  type Schema,
  Step,
  stepsTo,
} from '@ideaf/ui/editor/model'

/** A file of the draft as stored: its Markdown and its blocks' IDs, in order (null for one without). */
export interface DraftText {
  source: string
  ids: Array<string | null>
}

/** A stored snapshot of a file's document. */
export interface DraftRow {
  steps: number
  doc: string
  source: string
  ids: string
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

/** One file's live document: the editor's schema for it, the version's file to write against, the document, its count. */
export interface Live {
  env: Awaited<ReturnType<typeof headless>>
  /** Opened on the latest version's file: unchanged blocks are written as they are there. */
  base: { source: string; codec: Codec }
  doc: Node
  steps: number
  /** The count at the stored snapshot. */
  snapshot: number
}

/** What retargeting a file does: its document after, the steps (as stored), and its count after. */
export interface Retargeted {
  file: string
  doc: Node
  steps: unknown[]
  count: number
}

/** The blocks that hold the identities in one top-level node, as a key: list items', a run's, its own. */
function idsIn(node: Node): string {
  if ('blockIds' in node.attrs) {
    return String(node.attrs['blockIds'])
  }
  const ids: string[] = []
  if ('blockId' in node.attrs) {
    ids.push(String(node.attrs['blockId']))
  }
  node.descendants((n) => {
    if (n.type.name === 'list_item') {
      ids.push(String(n.attrs['blockId']))
    }
    return true
  })
  return ids.join(' ')
}

/** Each top-level node of `doc` that writes something, with its Markdown as `codec` writes it. */
function written(codec: Codec, doc: Node): Array<{ node: Node; text: string }> {
  const spans: Array<{ node: Node; start: number; end: number }> = []
  const out = codec.write(doc, (node, _pos, start, end) => void spans.push({ node, start, end }))
  return spans.map((s) => ({ node: s.node, text: out.slice(s.start, s.end) }))
}

/**
 * `wanted`, keeping `doc`'s own node wherever one reads the same, with the same IDs: written as the
 * same Markdown, or read back from its Markdown as the wanted one. What Markdown can't keep (a space
 * typed at the end of a paragraph, say) stays as it's typed, and steps to it touch only what differs.
 */
function keeping(
  doc: Node,
  docCodec: Codec,
  wanted: Node,
  wantedCodec: Codec,
  reread: (text: string) => Node | null,
): Node {
  const mine = written(docCodec, doc).map((m) => ({ ...m, ids: idsIn(m.node), used: false }))
  const byText = new Map<string, Array<(typeof mine)[number]>>()
  for (const m of mine) {
    const key = `${m.text}\u0000${m.ids}`
    byText.set(key, [...(byText.get(key) ?? []), m])
  }
  const theirs = new Map(written(wantedCodec, wanted).map(({ node, text }) => [node, text]))
  const content: Node[] = []
  wanted.forEach((node) => {
    const text = theirs.get(node)
    const ids = idsIn(node)
    // the same Markdown and IDs; or else one of ours that reads back as this one
    let same = text === undefined ? undefined : byText.get(`${text}\u0000${ids}`)?.find((m) => !m.used)
    if (!same) {
      same = mine.find((m) => {
        if (m.used || m.ids !== ids || m.node.type !== node.type) {
          return false
        }
        const back = reread(m.text)
        return back !== null && sameText(back, node)
      })
    }
    if (same) {
      same.used = true
      content.push(same.node)
    } else {
      content.push(node)
    }
  })
  return wanted.type.create(wanted.attrs, Fragment.from(content))
}

/** Applies steps (as stored) one by one: the document after each, for working out what they touched. */
export function applyEach(schema: Schema, doc: Node, steps: unknown[]): { docs: Node[]; steps: Step[] } {
  const docs = [doc]
  const made: Step[] = []
  let now = doc
  for (const json of steps) {
    const step = Step.fromJSON(schema, json)
    const result = step.apply(now)
    if (!result.doc) {
      throw new Error(`a step doesn't apply: ${result.failed}`)
    }
    now = result.doc
    docs.push(now)
    made.push(step)
  }
  return { docs, steps: made }
}

/**
 * The blocks steps touched (by ID): those in each step's range before it, and after the last step
 * (`after`, with identities as they now are). A block deleted is among the first.
 */
export function touched(docs: Node[], steps: Step[], after: Node, later: Step[]): Set<string> {
  const ids = new Set<string>()
  const within = (doc: Node, from: number, to: number) => {
    for (const h of holders(doc)) {
      if (h.id && h.pos <= to && h.pos + h.node.nodeSize >= from) {
        ids.add(h.id)
      }
    }
  }
  const all = [...steps, ...later]
  steps.forEach((step, i) => {
    let from = Infinity
    let to = -Infinity
    step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
      from = Math.min(from, oldStart)
      to = Math.max(to, oldEnd)
      void newStart
      void newEnd
    })
    if (from === Infinity) {
      // a change of attributes or marks: at its position
      const at = (step.toJSON() as { pos?: number; from?: number; to?: number }) ?? {}
      from = at.pos ?? at.from ?? 0
      to = at.pos ?? at.to ?? from
    }
    within(docs[i]!, from, to)
    // where it is once everything after it has been applied
    let start = from
    let end = to
    for (let j = i; j < all.length; j++) {
      const map = all[j]!.getMap()
      start = map.map(start, -1)
      end = map.map(end, 1)
    }
    within(after, start, end)
  })
  return ids
}

/**
 * The draft's documents, kept in memory between writes (the actor's writes run one at a time). A
 * document is read from its row and the steps after it, or opened from the latest version for a file
 * without one; only writes keep what they read here, and only once their steps are stored.
 */
export class LiveDrafts {
  #files = new Map<string, Live>()

  /** Whether a file's document is held. */
  has(file: string): boolean {
    return this.#files.has(file)
  }

  /**
   * The heading of the section a place in a held file's document is in: the last heading at or above
   * its block. Null if the file isn't held, or the place is above every heading.
   */
  heading(file: string, pos: number): string | null {
    const doc = this.#files.get(file)?.doc
    if (!doc) {
      return null
    }
    let heading: string | null = null
    doc.forEach((node, offset) => {
      if (offset <= pos && node.type.name === 'heading') {
        heading = node.textContent
      }
    })
    return heading
  }

  /** The count of a held file's steps, as stored; null if it isn't held. */
  count(file: string): number | null {
    return this.#files.get(file)?.steps ?? null
  }

  /**
   * The file's document: as held, or as stored (`row`, and the steps after it), or as the latest
   * version has it (`base`, without a row). Written against `base` either way. `keep`: a write's,
   * held from here on; a read's isn't, so a read can't stand in for a write that's under way.
   */
  async load(
    file: string,
    row: DraftRow | null,
    base: { source: string; ids: string[] },
    stepsAfter: () => Promise<unknown[]>,
    keep: boolean,
  ): Promise<Live> {
    const had = this.#files.get(file)
    if (had) {
      if (had.base.source !== base.source) {
        // the latest version changed: blocks are written as they are in it
        const codec = createCodec({ ...had.env, flavor: 'page' })
        codec.open(base.source, base.ids)
        had.base = { source: base.source, codec }
      }
      return had
    }
    const env = await headless(base.source)
    const codec = createCodec({ ...env, flavor: 'page' })
    const opened = codec.open(base.source, base.ids)
    let doc = row ? env.schema.nodeFromJSON(JSON.parse(row.doc)) : opened
    const after = row ? await stepsAfter() : []
    if (after.length > 0) {
      doc = applyEach(env.schema, doc, after).docs.at(-1)!
    }
    const live: Live = {
      env,
      base: { source: base.source, codec },
      doc,
      steps: (row?.steps ?? 0) + after.length,
      snapshot: row?.steps ?? -1,
    }
    if (keep) {
      this.#files.set(file, live)
    }
    return live
  }

  /** A document's file as stored: its Markdown and its blocks' IDs. */
  text(live: Live, doc = live.doc): DraftText {
    return { source: live.base.codec.write(doc), ids: live.base.codec.identities(doc).map((b) => b.id) }
  }

  /** A document's blocks, as the page editor gives them. */
  blocks(live: Live, doc = live.doc): EditorBlock[] {
    return live.base.codec.identities(doc).map(({ id, source }) => ({ id, source }))
  }

  /**
   * The steps that make the file's document read as `target`: worked out, not yet kept. Blocks that
   * read the same keep their nodes, so typing in them carries on.
   */
  retarget(file: string, live: Live, target: DraftText): Retargeted {
    const codec = createCodec({ ...live.env, flavor: 'page' })
    // a block without an ID has none here either
    const opened = codec.open(target.source, target.ids as string[])
    // a block's Markdown read back on its own, as one node
    const reader = createCodec({ ...live.env, flavor: 'page' })
    const reread = (text: string) => {
      const back = reader.open(text)
      return back.childCount === 1 ? back.firstChild : null
    }
    const wanted = keeping(live.doc, live.base.codec, opened, codec, reread)
    const steps = stepsTo(live.doc, wanted)
    return { file, doc: wanted, steps: steps.map((s) => s.toJSON()), count: live.steps + steps.length }
  }

  /** A document's new state, once its steps are stored. */
  commit(file: string, live: Live, doc: Node, count: number, snapshot?: number): void {
    this.#files.set(file, { ...live, doc, steps: count, snapshot: snapshot ?? live.snapshot })
  }

  /** Forgets every document (a write failed after working them out). */
  forget(): void {
    this.#files.clear()
  }

  /** Forgets the documents of files not in `files` (a new version without them). */
  keepOnly(files: Iterable<string>): void {
    const kept = new Set(files)
    for (const file of this.#files.keys()) {
      if (!kept.has(file)) {
        this.#files.delete(file)
      }
    }
  }
}
