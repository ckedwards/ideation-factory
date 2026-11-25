// The logic of one idea, with no Rivet in it: the idea actor is a thin shell
// that feeds this its queued writes (one at a time, in order) and its reads.
//
// Storage: the idea's SQLite holds versions (manifests), steps, comments and an
// anchor per comment per version, and the idea's one draft (changes on the
// latest version, committed as one version: core's draft.ts); file contents go
// to the file store by hash.
// Every write carries an idempotency key, and its result is kept, because a
// queued write that fails midway isn't redelivered: the client retries, and the
// retry must not apply twice.
//
// core's CPU work (parsing, applying batches, re-anchoring) goes through a
// CoreRunner, which on the server is a pool of worker threads.
//
// Who may do what is checked before a write gets here, by the app node against
// the directory's access grants; the idea trusts the caller it's given.
import {
  type Anchor,
  type AnchorInput,
  type AnchorState,
  Batch,
  type Comment,
  type CommentOutcome,
  type Conflict,
  contentHash,
  type BuiltDraft,
  type DraftEntry,
  DraftChange,
  type EditorBlock,
  type MovedWords,
  type Skipped,
  type Suggestion,
  unitSource,
  type FileOutline,
  type OutlineEntry,
  type Idea,
  type StepResult,
} from '@ideaf/core'
import { z } from 'zod'
import type { CoreRunner } from '../core-pool/runner.ts'
import type { FileStore } from '../files/store.ts'
import { byteLength, checkSizes, type Limits, type SizeProblem } from '../limits.ts'
import { type Kysely, sql as raw } from 'kysely'
import { sqliteKysely } from '../sql/kysely.ts'
import { prepared } from '../sql/prepared.ts'
import type { Sql } from '../sql/sql.ts'
import type { InboxEvent } from '../directory/types.ts'
import { inboxEvents, publishedInboxEvents } from './notify.ts'
import { holders, type Node, type Step, Transform } from '@ideaf/ui/editor/model'
import {
  applyEach,
  blocksNamed,
  blocksOf,
  type DraftText,
  keyOf,
  type Live,
  LiveDrafts,
  type Retargeted,
  touched,
} from './draft.ts'
import { reviewerOf } from './reviewer.ts'
import { type IdeaDB, type IdeaStatus, VERDICTS, type Verdict } from './schema.ts'

import { type Caller, schemas } from '@ideaf/api'

export type { Caller }

const FileInput = z.strictObject({ path: z.string().min(1).max(512), content: z.string() })
const OpenStatus = z.enum(['draft', 'requesting-review', 'changes-in-progress'])
const Note = z.string().trim().max(5000)

export const IdeaWrite = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('create'),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000).optional(),
    files: z.array(FileInput).min(1).max(500),
    gitHint: schemas.GitHint.optional(),
    /** Out for review from the start, or a draft (the default). */
    status: z.enum(['draft', 'requesting-review']).optional(),
  }),
  /** Moves an open idea to another open status. */
  z.strictObject({ type: z.literal('status'), status: OpenStatus, note: Note.optional() }),
  /** Closes it: accepted only if no reviewer's objection stands. */
  z.strictObject({ type: z.literal('close'), reason: z.enum(['accepted', 'rejected']), note: Note.optional() }),
  /** Opens a closed idea again, in the open status it had. */
  z.strictObject({ type: z.literal('reopen'), note: Note.optional() }),
  /**
   * Submits your review of the latest version (`version` says which you
   * read): your pending comments, published at once, and a verdict with an
   * optional summary. Without a verdict, it only publishes them.
   */
  z.strictObject({
    type: z.literal('review'),
    version: z.number().int().positive(),
    verdict: z.enum(VERDICTS).optional(),
    body: z.string().trim().max(20_000).optional(),
  }),
  /** Dismisses a reviewer's standing Request changes or Reject. */
  z.strictObject({ type: z.literal('dismiss'), reviewer: z.string().min(1).max(300), reason: Note.min(1) }),
  z.strictObject({
    type: z.literal('comment'),
    /** The version the anchor refers to; it must be the latest. */
    version: z.number().int().positive(),
    anchor: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('idea') }),
      z.strictObject({ kind: z.literal('file'), file: z.string() }),
      z.strictObject({ kind: z.literal('section'), section: z.string() }),
      z.strictObject({ kind: z.literal('block'), block: z.string() }),
      z.strictObject({ kind: z.literal('text'), file: z.string(), start: z.number().int(), end: z.number().int() }),
    ]),
    body: z.string().trim().min(1).max(20_000),
    /** Part of your review: only you see it until you submit the review. */
    pending: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal('suggest'),
    /** The version the anchor refers to; it must be the latest. */
    version: z.number().int().positive(),
    anchor: z.strictObject({
      kind: z.literal('text'),
      file: z.string(),
      start: z.number().int(),
      end: z.number().int(),
    }),
    /** The replacement for the selection's source (suggestionSource): Markdown. */
    new: z.string().max(1_000_000),
    /** Why, if anything: a suggestion can speak for itself. */
    body: z.string().trim().max(20_000),
    pending: z.boolean().optional(),
  }),
  /** Adds suggestions to the draft (committing it makes the version); those that no longer apply are skipped. */
  z.strictObject({
    type: z.literal('accept'),
    suggestions: z.array(z.string()).min(1).max(100),
  }),
  /** Adds a change to the draft, if it applies to the draft as it is. Suggestions go in by `accept`. */
  /** Several at once: all of them apply, in order, or none does. */
  z.strictObject({ type: z.literal('draft'), changes: z.array(DraftChange).min(1).max(200) }),
  /** Takes a change out of the draft. */
  z.strictObject({ type: z.literal('undraft'), key: z.string().min(1).max(64) }),
  z.strictObject({ type: z.literal('discard') }),
  /** Commits the draft as one version. */
  z.strictObject({ type: z.literal('commit') }),
  z.strictObject({ type: z.literal('reject'), suggestion: z.string() }),
  z.strictObject({
    type: z.literal('reply'),
    parent: z.string(),
    body: z.string().trim().min(1).max(20_000),
    /** Part of your review (a reply in your own pending thread always is). */
    pending: z.boolean().optional(),
  }),
  /** Changes one of your pending comments. */
  z.strictObject({ type: z.literal('amend'), comment: z.string(), body: z.string().trim().min(1).max(20_000) }),
  /** Deletes one of your pending comments, with its pending replies. */
  z.strictObject({ type: z.literal('drop'), comment: z.string() }),
  /** Deletes every pending comment of yours: the review isn't sent. */
  z.strictObject({ type: z.literal('unreview') }),
  z.strictObject({ type: z.literal('resolve'), comment: z.string(), resolved: z.boolean() }),
  /** The caller opened this version's document: kept if it's the latest they have. */
  z.strictObject({ type: z.literal('seen'), version: z.number().int().positive() }),
  /** `outdateDraft`: make the version even though it makes changes in the draft outdated. */
  z.strictObject({ type: z.literal('edit'), batch: Batch, outdateDraft: z.boolean().optional() }),
  z.strictObject({
    type: z.literal('upload'),
    files: z
      .array(
        z.strictObject({
          file: z.string().optional(),
          path: z.string().min(1).max(512),
          content: z.string(),
          base: z.string().optional(),
        }),
      )
      .max(500),
    deleted: z.array(z.string()).max(500).optional(),
    /** Upload even if a file's base isn't the latest version: the newer changes show as undone. */
    force: z.boolean().optional(),
    /** Where in git it was synced from: replaces the idea's git hint. */
    gitHint: schemas.GitHint.optional(),
    outdateDraft: z.boolean().optional(),
  }),
])
export type IdeaWrite = z.infer<typeof IdeaWrite>

export type WriteRequest = { key: string; caller: Caller; write: unknown }

export type WriteErrorCode =
  | 'not_found'
  | 'exists'
  | 'invalid'
  | 'forbidden'
  | 'stale_version'
  | 'pull_first'
  | 'too_large'
  | 'conflict'
  | 'draft_outdated'
  | 'blocked'
export type WriteError = { code: WriteErrorCode; message: string; details?: unknown }

export type WriteValue =
  | { kind: 'created'; version: number }
  | { kind: 'comment'; comment: string }
  | { kind: 'suggestion'; comment: string; old: string }
  | { kind: 'rejected'; comment: string }
  /** The draft changed: the change added (or merged into), if any. */
  /** The draft changed: each change's key (a change folded into another has that one's), null where one was taken out. */
  | { kind: 'draft'; keys: Array<string | null> }
  /** Suggestions accepted into the draft, and those left out. */
  | { kind: 'drafted'; accepted: string[]; skipped: Skipped[] }
  | { kind: 'resolved'; comment: string; resolved: boolean }
  /** The latest version the caller has seen, now; null for a bot, whose reading isn't kept. */
  | { kind: 'seen'; version: number | null }
  | { kind: 'status'; status: IdeaStatus; from: IdeaStatus }
  /** A review submitted (its verdict, if it had one, and the pending comments it published), or a verdict dismissed. */
  | { kind: 'review'; review: ReviewShape | null; published: string[] }
  /** Pending comments changed or deleted. */
  | { kind: 'pending'; comments: string[] }
  | {
      kind: 'version'
      version: number
      comments: CommentOutcome[]
      steps: StepResult[]
    }

export type WriteResult = { ok: true; value: WriteValue } | { ok: false; error: WriteError }

/** A comment as list_comments shows it: its thread, or one reply. */
export type CommentShape = {
  id: string
  author: Caller
  createdAt: number
  body: string
  version: number
  /** Part of its author's review, not submitted yet: only they see it. */
  pending: boolean
}
/** Whether a suggestion was accepted (in which version) or rejected, by whom and when. */
export type Decision = { kind: 'accepted' | 'rejected'; by: Caller; at: number; version: number | null }
/** A change of the idea's status, with who made it and why. */
export type StatusChange = { status: IdeaStatus; by: Caller; at: number; note: string }
export type Dismissal = { by: Caller; at: number; reason: string }
/**
 * A reviewer's latest verdict. `reviewer` names the account (u:<user>, or
 * b:<user>:<bot> for a bot). `counts`: an approval from a person on the latest
 * version, which is what approval rules count. `standing`: a Request changes
 * or Reject that hasn't been withdrawn or dismissed, which blocks closing as
 * accepted.
 */
export type ReviewShape = {
  reviewer: string
  by: Caller
  verdict: Verdict
  version: number
  body: string
  at: number
  dismissed: Dismissal | null
  counts: boolean
  standing: boolean
}
export type SuggestionShape = { old: string; new: string; decision: Decision | null; inDraft: boolean }
export type ThreadShape = CommentShape & {
  resolved: boolean
  state: AnchorState
  anchor: Anchor | null
  lastVersion: number | null
  lastAnchor: Anchor | null
  lastUnit: OutlineEntry | null
  addressedIn: number[]
  /** A suggested edit's change; null for a plain comment. */
  suggestion: SuggestionShape | null
  replies: CommentShape[]
}

/**
 * What happened, for everyone viewing the idea. A comment or reply carries
 * itself, as list_comments would show it, so a viewer adds it without
 * reading the comments again.
 */
export type IdeaEvent =
  | { name: 'version'; payload: { version: number; how: VersionHow; by: Caller } }
  | { name: 'comment'; payload: { thread: ThreadShape; by: Caller } }
  | { name: 'reply'; payload: { parent: string; reply: CommentShape; by: Caller } }
  | { name: 'resolved'; payload: { comment: string; resolved: boolean; by: Caller } }
  /** A suggestion accepted or rejected: its thread is resolved too. */
  | { name: 'decided'; payload: { comment: string; decision: Decision; by: Caller } }
  /** The draft changed (or was committed or discarded): editors read it again. */
  | { name: 'draft'; payload: { by: Caller } }
  /** The idea's status changed: opened, moved, closed or reopened. */
  | { name: 'status'; payload: { status: IdeaStatus; change: StatusChange; by: Caller } }
  /** A verdict given, or dismissed: the reviewer's verdict as it stands now. */
  | { name: 'review'; payload: { review: ReviewShape; by: Caller } }
  /**
   * Steps taken in a file of the draft, from its count `from`, each with the editor that sent it
   * (`server` for the server's own): stored, for every editor of the file to take in, in order.
   */
  | { name: 'draftSteps'; payload: { file: string; from: number; steps: unknown[]; clients: string[] } }

export type VersionHow = 'created' | 'commands' | 'upload'

export interface IdeaDeps {
  sql: Sql
  files: FileStore
  core: CoreRunner
  limits: Limits
  now?: () => number
}

/** The idea's own row. */
type Meta = IdeaDB['idea']

type Latest = {
  version: number
  idea: Idea
  hashes: Map<string, string>
  bytes: Map<string, number>
  comments: Comment[]
}

/** A write or read the idea refuses, with a code the caller can act on. */
export class Refused extends Error {
  constructor(readonly error: WriteError) {
    super(error.message)
  }
}

const refuse = (code: WriteErrorCode, message: string, details?: unknown): never => {
  throw new Refused({ code, message, ...(details === undefined ? {} : { details }) })
}

/**
 * The draft as stored: each file's row and its document now, with its blocks; the suggestions
 * accepted into it; the changes held; who changed each block (the latest first); and the idea it was
 * read against.
 */
interface DraftState {
  rows: Map<string, IdeaDB['draft_files']>
  lives: Map<string, Live>
  blocks: Map<string, EditorBlock[]>
  suggestions: DraftSuggestion[]
  held: DraftHeld[]
  authors: Map<string, Array<{ by: Caller; at: number }>>
  /** Words editors saw moved between blocks, in order. */
  moved: MovedWords[]
  base: Idea
}
interface DraftSuggestion {
  comment: string
  change: DraftChange
  by: Caller
  at: number
}
interface DraftHeld {
  key: string
  change: DraftChange
  by: Caller
  at: number
}
/** One of the draft's changes, and where it comes from: held, a suggestion accepted, or the documents. */
interface DraftItem {
  key: string
  change: DraftChange
  by: Caller
  at: number
  kind: 'held' | 'suggestion' | 'derived'
}
interface Derived {
  entries: DraftItem[]
  built: BuiltDraft
}
/** The draft as a write leaves it: worked out, to keep in the write's transaction, and the steps to send. */
interface NextDraft {
  after: Derived
  save: (tx: Kysely<IdeaDB>) => Promise<void>
  done: () => void
  events: IdeaEvent[]
}

/** Typing in a file of the draft: steps from an editor, on the count of steps it had. */
export interface Typing {
  file: string
  version: number
  steps: unknown[]
  client: string
  caller: Caller
}

/** What became of typing: stored (the file's count now), behind the file's count, or refused. */
export type TypingResult =
  | { kind: 'taken'; version: number }
  | { kind: 'behind'; version: number }
  | { kind: 'refused'; message: string }

/** What an editor missed: the steps after its count, with whose each is; or too long ago to have kept. */
export type Missed = { kind: 'steps'; from: number; steps: unknown[]; clients: string[] } | { kind: 'gone' }

/** A file's blocks given the IDs they should have: its document after, the steps (attributes only), the IDs renamed. */
interface Renamed {
  live: Live
  doc: Node
  steps: Step[]
  renames: Map<string, string>
}

/**
 * The words seen moved that the documents still show moved (gone from the block they left, and in the
 * one they went to), each placed where `base` (the latest version) can find it: core moves the words
 * next to text the block has there once, and the block's edit does the rest. The editor saw them land
 * next to the block's text as the draft had it, which the version may not (a space typed before the
 * paste, say), so they go after the nearest text before them the version has once, or else before the
 * nearest after them. Words moved back, or typed over since, are edits like any other.
 */
function stillMoved(moved: MovedWords[], blocks: Map<string, EditorBlock[]>, base: Idea): MovedWords[] {
  const sources = new Map([...blocks.values()].flat().flatMap((b) => (b.id ? [[b.id, b.source] as const] : [])))
  const seen = new Set<string>()
  const out: MovedWords[] = []
  for (const w of moved) {
    const from = sources.get(w.from)
    const to = sources.get(w.to.in)
    const was = unitSource(base, w.to.in)
    const old = w.old.trim()
    const key = JSON.stringify(w)
    if (seen.has(key) || !old || from === undefined || to === undefined || was === null) {
      continue
    }
    seen.add(key)
    if (from.includes(old) || !to.includes(old)) {
      continue
    }
    const once = (text: string) => text.length > 0 && was.split(text).length === 2
    const near = 'before' in w.to ? w.to.before : w.to.after
    if (once(near)) {
      out.push(w)
      continue
    }
    const at = to.indexOf(old)
    const before = to.slice(0, at)
    const after = to.slice(at + old.length)
    let place: MovedWords['to'] | null = null
    for (let n = before.length; n > 0 && !place; n--) {
      const text = before.slice(before.length - n).trimEnd()
      if (once(text)) {
        place = { in: w.to.in, after: text }
      }
    }
    for (let n = after.length; n > 0 && !place; n--) {
      const text = after.slice(0, n).trimStart()
      if (once(text)) {
        place = { in: w.to.in, before: text }
      }
    }
    if (place) {
      out.push({ ...w, to: place })
    }
  }
  return out
}

/** The blocks a change is to: those it names, and the new text it adds. */
function blocksOfChange(key: string, change: DraftChange, built: BuiltDraft): string[] {
  const made = built.files.flatMap((f) =>
    f.units.flatMap((u) => (u.origin.kind === 'new' && u.origin.change === key ? [u.id] : [])),
  )
  return [...blocksNamed(change), ...made]
}

const plainEntry = ({ key, change }: { key: string; change: DraftChange }): DraftEntry => ({ key, change })

/** The draft's key for the change a caller sent, as it's now in the draft; null if it left none. */
function changeKey(change: DraftChange, after: Derived): string | null {
  const names = blocksNamed(change)
  const derived = after.entries.filter((e) => e.kind === 'derived')
  const direct = derived.find((e) => blocksNamed(e.change).some((id) => names.includes(id)))
  if (direct) {
    return direct.key
  }
  // new text, or a change to it: the change that added it
  const made = new Map(
    after.built.files.flatMap((f) =>
      f.units.flatMap((u) => (u.origin.kind === 'new' ? [[u.id, u.origin.change] as const] : [])),
    ),
  )
  for (const id of names) {
    if (made.has(id)) {
      return made.get(id)!
    }
  }
  if (change.kind === 'insert') {
    const text = change.markdown.trim()
    const insert = derived.find((e) => e.change.kind === 'insert' && e.change.markdown.includes(text))
    return insert?.key ?? null
  }
  return null
}

/** How long a write's result is kept for retries. */
const KEEP_RESULTS_MS = 7 * 24 * 60 * 60 * 1000

export class IdeaService {
  readonly #sql: Sql
  readonly #db: Kysely<IdeaDB>
  readonly #files: FileStore
  readonly #core: CoreRunner
  readonly #limits: Limits
  readonly #now: () => number
  /** The latest version, kept in memory: its sources and the open comments' anchors. */
  #latest: Latest | null = null
  /** The draft's documents, between writes. */
  readonly #live = new LiveDrafts()

  constructor(
    readonly id: string,
    deps: IdeaDeps,
  ) {
    this.#sql = deps.sql
    this.#db = sqliteKysely<IdeaDB>(deps.sql)
    this.#files = deps.files
    this.#core = deps.core
    this.#limits = deps.limits
    this.#now = deps.now ?? Date.now
  }

  /** A transaction through RivetKit's own (c.db.transaction), with a Kysely bound to it. */
  #transaction<T>(fn: (db: Kysely<IdeaDB>) => Promise<T>): Promise<T> {
    return this.#sql.transaction((tx) => fn(sqliteKysely<IdeaDB>(tx)))
  }

  // --- writes -------------------------------------------------------------------

  async write(request: WriteRequest): Promise<{ result: WriteResult; events: IdeaEvent[] }> {
    if (!request.key || request.key.length > 128) {
      return {
        result: {
          ok: false,
          error: { code: 'invalid', message: 'a write needs an idempotency key of 1 to 128 characters' },
        },
        events: [],
      }
    }
    const done = await this.#db.selectFrom('writes').select('result').where('key', '=', request.key).executeTakeFirst()
    if (done) {
      return { result: JSON.parse(done.result) as WriteResult, events: [] }
    }

    const parsed = IdeaWrite.safeParse(request.write)
    try {
      if (!parsed.success) {
        refuse('invalid', 'the write is malformed', z.treeifyError(parsed.error!))
      }
      const write = parsed.data!
      switch (write.type) {
        case 'create':
          return await this.#create(request, write)
        case 'status':
          return await this.#status(request, write)
        case 'close':
          return await this.#close(request, write)
        case 'reopen':
          return await this.#reopen(request, write)
        case 'review':
          return await this.#review(request, write)
        case 'dismiss':
          return await this.#dismiss(request, write)
        case 'amend':
          return await this.#amend(request, write)
        case 'drop':
          return await this.#drop(request, [write.comment])
        case 'unreview':
          return await this.#drop(request, null)
        case 'comment':
        case 'suggest':
          return await this.#comment(request, write)
        case 'accept':
          return await this.#accept(request, write)
        case 'reject':
          return await this.#reject(request, write)
        case 'draft':
          return await this.#draftAdd(request, write.changes)
        case 'undraft':
          return await this.#undraft(request, write.key)
        case 'discard':
          return await this.#discard(request)
        case 'commit':
          return await this.#commit(request)
        case 'reply':
          return await this.#reply(request, write)
        case 'resolve':
          return await this.#resolve(request, write)
        case 'seen':
          return await this.#seen(request, write)
        case 'edit':
          return await this.#edit(request, write)
        case 'upload':
          return await this.#upload(request, write)
      }
    } catch (error) {
      if (!(error instanceof Refused)) {
        throw error
      }
      const result: WriteResult = { ok: false, error: error.error }
      await this.#remember(this.#db, request.key, result)
      return { result, events: [] }
    }
  }

  async #create(request: WriteRequest, write: Extract<IdeaWrite, { type: 'create' }>) {
    if (await this.#meta()) {
      refuse('exists', 'this idea already exists')
    }
    const sizes = write.files.map((f, i) => ({ file: `new${i}`, path: f.path, bytes: byteLength(f.content) }))
    this.#checkSizes(new Map(), sizes)
    const created = await this.#core.createIdea(
      this.id,
      write.files.map((f) => ({ path: f.path, source: f.content })),
    )
    if (!created.ok) {
      refuse('invalid', created.message)
    }
    const idea = (created as { idea: Idea }).idea
    const now = this.#now()
    const result: WriteResult = { ok: true, value: { kind: 'created', version: 1 } }
    const stored = await this.#storeContents(idea)
    const events: IdeaEvent[] = [{ name: 'version', payload: { version: 1, how: 'created', by: request.caller } }]
    await this.#transaction(async (tx) => {
      await tx
        .insertInto('idea')
        .values({
          id: this.id,
          title: write.title,
          description: write.description ?? '',
          owner: request.caller.user,
          status: write.status ?? 'draft',
          created_at: now,
          latest: 1,
          next_comment: 1,
          git_uri: write.gitHint?.uri ?? null,
          git_branch: write.gitHint?.branch ?? null,
        })
        .execute()
      await this.#insertVersion(tx, {
        number: 1,
        parent: null,
        how: 'created',
        caller: request.caller,
        idea,
        stored,
        steps: [],
        outcomes: [],
      })
      await tx
        .insertInto('status_changes')
        .values({ status: write.status ?? 'draft', by: JSON.stringify(request.caller), at: now, note: '' })
        .execute()
      await this.#remember(tx, request.key, result, events)
    })
    this.#latest = { version: 1, idea, ...stored, comments: [] }
    return {
      result,
      events,
    }
  }

  // --- status and reviews ---------------------------------------------------------

  async #status(request: WriteRequest, write: Extract<IdeaWrite, { type: 'status' }>) {
    const meta = await this.#requireMeta()
    if (closed(meta.status)) {
      refuse('invalid', `it's ${words(meta.status)}; reopen it first`)
    }
    return this.#changeStatus(request, meta.status, write.status, write.note ?? '')
  }

  async #close(request: WriteRequest, write: Extract<IdeaWrite, { type: 'close' }>) {
    const meta = await this.#requireMeta()
    if (closed(meta.status)) {
      refuse('invalid', `it's already ${words(meta.status)}`)
    }
    if (write.reason === 'accepted') {
      const standing = (await this.#latestReviews(meta)).filter((r) => r.standing)
      if (standing.length > 0) {
        const n = standing.length
        refuse(
          'blocked',
          `${n === 1 ? 'a reviewer objects' : `${n} reviewers object`}: it can be closed as accepted once ${n === 1 ? 'their verdict changes or is' : 'their verdicts change or are'} dismissed`,
          { objections: standing },
        )
      }
    }
    return this.#changeStatus(request, meta.status, `closed-${write.reason}`, write.note ?? '')
  }

  async #reopen(request: WriteRequest, write: Extract<IdeaWrite, { type: 'reopen' }>) {
    const meta = await this.#requireMeta()
    if (!closed(meta.status)) {
      refuse('invalid', `it's open (${words(meta.status)})`)
    }
    // back to the open status it last had
    const last = await this.#db
      .selectFrom('status_changes')
      .select('status')
      .where('status', 'not in', ['closed-accepted', 'closed-rejected'])
      .orderBy('seq', 'desc')
      .limit(1)
      .executeTakeFirst()
    return this.#changeStatus(request, meta.status, last?.status ?? 'requesting-review', write.note ?? '')
  }

  async #changeStatus(request: WriteRequest, from: IdeaStatus, to: IdeaStatus, note: string) {
    const result: WriteResult = { ok: true, value: { kind: 'status', status: to, from } }
    if (from === to) {
      await this.#remember(this.#db, request.key, result)
      return { result, events: [] }
    }
    const change: StatusChange = { status: to, by: request.caller, at: this.#now(), note }
    const events: IdeaEvent[] = [{ name: 'status', payload: { status: to, change, by: request.caller } }]
    await this.#transaction(async (tx) => {
      await tx.updateTable('idea').set({ status: to }).execute()
      await tx
        .insertInto('status_changes')
        .values({ status: to, by: JSON.stringify(change.by), at: change.at, note })
        .execute()
      await this.#remember(tx, request.key, result, events)
    })
    return {
      result,
      events,
    }
  }

  async #review(request: WriteRequest, write: Extract<IdeaWrite, { type: 'review' }>) {
    const meta = await this.#requireMeta()
    const { caller } = request
    const reviewer = reviewerOf(caller)
    const pending = await this.#db
      .selectFrom('comments')
      .select(['id', 'parent'])
      .where('pending', '=', reviewer)
      .orderBy('created_at')
      .orderBy('id')
      .execute()
    if (!write.verdict) {
      return this.#publish(request, meta, pending, write)
    }
    if (caller.purpose !== 'bot' && caller.user === meta.owner) {
      refuse(
        'invalid',
        caller.purpose === 'me' ? "you can't review your own idea" : "a bot can't review its owner's idea for them",
      )
    }
    if (closed(meta.status)) {
      refuse('invalid', `it's ${words(meta.status)}; reopen it to review it`)
    }
    if (write.version !== meta.latest) {
      refuse('stale_version', `v${meta.latest} is the latest version; read it, then review it`, { latest: meta.latest })
    }
    const at = this.#now()
    const published = pending.map((p) => p.id)
    const told = await this.#publishedTold(published, caller, at)
    let review: ReviewShape
    let result: WriteResult
    // the comments published, the verdict and the record of the write, together
    await this.#transaction(async (tx) => {
      await tx.updateTable('comments').set({ pending: null }).where('pending', '=', reviewer).execute()
      await tx
        .insertInto('reviews')
        .values({
          reviewer,
          by: JSON.stringify(caller),
          verdict: write.verdict!,
          version: write.version,
          body: write.body ?? '',
          at,
          dismissed: null,
        })
        .execute()
      review = (await this.#latestReviews(meta, tx)).find((r) => r.reviewer === reviewer)!
      result = { ok: true, value: { kind: 'review', review, published } }
      await this.#remember(tx, request.key, result, {
        inbox: [...told, ...inboxEvents([{ name: 'review', payload: { review, by: caller } }], at)],
      })
    })
    return {
      result: result!,
      events: [
        ...(await this.#publishedEvents(pending, caller)),
        { name: 'review', payload: { review: review!, by: caller } },
      ] satisfies IdeaEvent[],
    }
  }

  /** Submits a review without a verdict: its pending comments, published. */
  async #publish(
    request: WriteRequest,
    meta: Meta,
    pending: Array<{ id: string; parent: string | null }>,
    write: Extract<IdeaWrite, { type: 'review' }>,
  ) {
    if (write.body) {
      refuse('invalid', 'a summary goes with a verdict: approve, request changes or reject')
    }
    if (pending.length === 0) {
      refuse('invalid', 'you have no pending comments to submit, and gave no verdict')
    }
    if (write.version !== meta.latest) {
      refuse('stale_version', `v${meta.latest} is the latest version; read it, then submit your review`, {
        latest: meta.latest,
      })
    }
    const reviewer = reviewerOf(request.caller)
    const published = pending.map((p) => p.id)
    const result: WriteResult = { ok: true, value: { kind: 'review', review: null, published } }
    const told = await this.#publishedTold(published, request.caller, this.#now())
    await this.#transaction(async (tx) => {
      await tx.updateTable('comments').set({ pending: null }).where('pending', '=', reviewer).execute()
      await this.#remember(tx, request.key, result, { inbox: told })
    })
    return { result, events: await this.#publishedEvents(pending, request.caller) }
  }

  /** What everyone viewing sees of comments just published: new threads whole, and replies to threads already out. */
  /** What publishing these pending comments tells inboxes, read from their rows (and where they're anchored now). */
  async #publishedTold(ids: string[], by: Caller, at: number): Promise<InboxEvent[]> {
    if (ids.length === 0) {
      return []
    }
    const rows = await this.#db
      .selectFrom('comments')
      .select(['id', 'parent', 'body', 'suggestion'])
      .where('id', 'in', ids)
      .orderBy('created_at')
      .orderBy('id')
      .execute()
    const anchors = await this.#db
      .selectFrom('anchors')
      .select(['comment', 'anchor'])
      .where('comment', 'in', ids)
      .orderBy('version', 'desc')
      .execute()
    const quote = (id: string) => {
      const anchor = anchors.find((a) => a.comment === id)?.anchor
      const parsed = anchor ? (JSON.parse(anchor) as { kind?: string; quote?: string }) : null
      return parsed?.kind === 'text' && parsed.quote ? parsed.quote : null
    }
    return publishedInboxEvents(
      rows.map((r) => ({ ...r, quote: quote(r.id) })),
      by,
      at,
    )
  }

  async #publishedEvents(pending: Array<{ id: string; parent: string | null }>, by: Caller): Promise<IdeaEvent[]> {
    if (pending.length === 0) {
      return []
    }
    const ids = new Set(pending.map((p) => p.id))
    const threads = await this.comments(undefined, null)
    const events: IdeaEvent[] = []
    for (const thread of threads) {
      if (ids.has(thread.id)) {
        events.push({ name: 'comment', payload: { thread, by } })
        continue
      }
      for (const reply of thread.replies) {
        if (ids.has(reply.id)) {
          events.push({ name: 'reply', payload: { parent: thread.id, reply, by } })
        }
      }
    }
    return events
  }

  /** One of the caller's pending comments, or a refusal: someone else's is as good as not there. */
  async #ownPending(id: string, caller: Caller) {
    const row = await this.#db
      .selectFrom('comments')
      .select(['id', 'parent', 'pending'])
      .where('id', '=', id)
      .executeTakeFirst()
    if (!row || (row.pending !== null && row.pending !== reviewerOf(caller))) {
      refuse('not_found', `no comment ${id}`)
    }
    if (row!.pending === null) {
      refuse('invalid', `${id} is published: only pending comments can be changed or deleted`)
    }
    return row!
  }

  async #amend(request: WriteRequest, write: Extract<IdeaWrite, { type: 'amend' }>) {
    await this.#requireMeta()
    await this.#ownPending(write.comment, request.caller)
    const result: WriteResult = { ok: true, value: { kind: 'pending', comments: [write.comment] } }
    await this.#transaction(async (tx) => {
      await tx.updateTable('comments').set({ body: write.body }).where('id', '=', write.comment).execute()
      await this.#remember(tx, request.key, result)
    })
    return { result, events: [] }
  }

  /** Deletes pending comments of the caller's (with their replies): these, or all of them. */
  async #drop(request: WriteRequest, ids: string[] | null) {
    await this.#requireMeta()
    const reviewer = reviewerOf(request.caller)
    if (ids) {
      for (const id of ids) {
        await this.#ownPending(id, request.caller)
      }
    }
    const rows = await this.#db
      .selectFrom('comments')
      .select(['id', 'parent'])
      .where('pending', '=', reviewer)
      .execute()
    const chosen = ids ? new Set(ids) : new Set(rows.map((r) => r.id))
    // a pending thread goes with its replies
    const gone = rows.filter((r) => chosen.has(r.id) || (r.parent !== null && chosen.has(r.parent))).map((r) => r.id)
    const result: WriteResult = { ok: true, value: { kind: 'pending', comments: gone } }
    await this.#transaction(async (tx) => {
      if (gone.length > 0) {
        await tx.deleteFrom('anchors').where('comment', 'in', gone).execute()
        await tx.deleteFrom('comments').where('id', 'in', gone).execute()
      }
      await this.#remember(tx, request.key, result)
    })
    if (this.#latest) {
      const dropped = new Set(gone)
      this.#latest.comments = this.#latest.comments.filter((c) => !dropped.has(c.id))
    }
    return { result, events: [] }
  }

  async #dismiss(request: WriteRequest, write: Extract<IdeaWrite, { type: 'dismiss' }>) {
    const meta = await this.#requireMeta()
    const row = await this.#db
      .selectFrom('reviews')
      .select(['seq', 'verdict', 'dismissed'])
      .where('reviewer', '=', write.reviewer)
      .orderBy('seq', 'desc')
      .limit(1)
      .executeTakeFirst()
    if (!row) {
      refuse('not_found', `${write.reviewer} hasn't reviewed this idea`)
    }
    if (row!.verdict === 'approve' || row!.dismissed) {
      refuse(
        'invalid',
        row!.dismissed ? 'that verdict is already dismissed' : 'only a Request changes or a Reject can be dismissed',
      )
    }
    const dismissed: Dismissal = { by: request.caller, at: this.#now(), reason: write.reason }
    let result: WriteResult
    let events: IdeaEvent[] = []
    await this.#transaction(async (tx) => {
      await tx
        .updateTable('reviews')
        .set({ dismissed: JSON.stringify(dismissed) })
        .where('seq', '=', row!.seq)
        .execute()
      const review = (await this.#latestReviews(meta, tx)).find((r) => r.reviewer === write.reviewer)!
      result = { ok: true, value: { kind: 'review', review, published: [] } }
      events = [{ name: 'review', payload: { review, by: request.caller } }]
      await this.#remember(tx, request.key, result, events)
    })
    return { result: result!, events }
  }

  /** Each reviewer's latest verdict, oldest first. */
  async #latestReviews(meta: Meta, db: Kysely<IdeaDB> = this.#db): Promise<ReviewShape[]> {
    const rows = await db
      .selectFrom('reviews as r')
      .selectAll()
      .where('r.seq', 'in', (eb) =>
        eb
          .selectFrom('reviews')
          .select((e) => e.fn.max<number>('seq').as('seq'))
          .groupBy('reviewer'),
      )
      .orderBy('r.seq')
      .execute()
    return rows.map((r): ReviewShape => {
      const by = JSON.parse(r.by) as Caller
      const dismissed = r.dismissed ? (JSON.parse(r.dismissed) as Dismissal) : null
      return {
        reviewer: r.reviewer,
        by,
        verdict: r.verdict,
        version: r.version,
        body: r.body,
        at: r.at,
        dismissed,
        counts: r.verdict === 'approve' && r.version === meta.latest && by.purpose === 'me',
        standing: r.verdict !== 'approve' && !dismissed,
      }
    })
  }

  async #comment(request: WriteRequest, write: Extract<IdeaWrite, { type: 'comment' | 'suggest' }>) {
    const meta = await this.#requireMeta()
    if (write.version !== meta.latest) {
      refuse('stale_version', `comments are made on the latest version, v${meta.latest}`, { latest: meta.latest })
    }
    const latest = await this.#loadLatest()
    const checked = await this.#core.checkAnchor(this.id, latest.idea, write.anchor as AnchorInput)
    if (!checked.ok) {
      refuse('invalid', checked.message)
    }
    const anchor = (checked as { anchor: Anchor }).anchor
    let suggestion: SuggestionShape | null = null
    if (write.type === 'suggest') {
      const found = await this.#core.suggestionSource(this.id, latest.idea, anchor)
      if (!found.ok) {
        refuse('invalid', found.message)
      }
      const old = (found as { old: string }).old
      if (old === write.new) {
        refuse('invalid', "the suggestion doesn't change anything")
      }
      suggestion = { old, new: write.new, decision: null, inDraft: false }
    }
    const id = `c${meta.next_comment}`
    const at = this.#now()
    const pending = write.pending ? reviewerOf(request.caller) : null
    const result: WriteResult = {
      ok: true,
      value: suggestion ? { kind: 'suggestion', comment: id, old: suggestion.old } : { kind: 'comment', comment: id },
    }
    const events: IdeaEvent[] = [
      {
        name: 'comment',
        payload: {
          thread: {
            id,
            author: request.caller,
            createdAt: at,
            body: write.body,
            version: meta.latest,
            resolved: false,
            state: 'exact',
            anchor,
            lastVersion: meta.latest,
            lastAnchor: null,
            lastUnit: null,
            addressedIn: [],
            suggestion,
            pending: false,
            replies: [],
          },
          by: request.caller,
        },
      },
    ]
    await this.#transaction(async (tx) => {
      await tx
        .insertInto('comments')
        .values({
          id,
          parent: null,
          version: meta.latest,
          author: JSON.stringify(request.caller),
          created_at: at,
          body: write.body,
          resolved: 0,
          suggestion: suggestion ? JSON.stringify({ old: suggestion.old, new: suggestion.new }) : null,
          decision: null,
          pending,
        })
        .execute()
      await tx
        .insertInto('anchors')
        .values({ comment: id, version: meta.latest, state: 'exact', anchor: JSON.stringify(anchor) })
        .execute()
      await tx
        .updateTable('idea')
        .set((eb) => ({ next_comment: eb('next_comment', '+', 1) }))
        .execute()
      // a pending comment tells no one until its review is submitted
      await this.#remember(tx, request.key, result, pending ? [] : events)
    })
    latest.comments.push({ id, anchor })
    if (pending) {
      // only its author sees it, until the review is submitted
      return { result, events: [] }
    }
    return {
      result,
      events,
    }
  }

  async #reply(request: WriteRequest, write: Extract<IdeaWrite, { type: 'reply' }>) {
    const meta = await this.#requireMeta()
    const parent = await this.#rootComment(write.parent, request.caller)
    const thread = await this.#db.selectFrom('comments').select('pending').where('id', '=', parent).executeTakeFirst()
    // a reply in your own pending thread is pending too: the thread isn't out yet
    const pending = write.pending || thread?.pending ? reviewerOf(request.caller) : null
    const id = `c${meta.next_comment}`
    const at = this.#now()
    const result: WriteResult = { ok: true, value: { kind: 'comment', comment: id } }
    const events: IdeaEvent[] = [
      {
        name: 'reply',
        payload: {
          parent,
          reply: {
            id,
            author: request.caller,
            createdAt: at,
            body: write.body,
            version: meta.latest,
            pending: false,
          },
          by: request.caller,
        },
      },
    ]
    await this.#transaction(async (tx) => {
      await tx
        .insertInto('comments')
        .values({
          id,
          parent,
          version: meta.latest,
          author: JSON.stringify(request.caller),
          created_at: at,
          body: write.body,
          resolved: 0,
          suggestion: null,
          decision: null,
          pending,
        })
        .execute()
      await tx
        .updateTable('idea')
        .set((eb) => ({ next_comment: eb('next_comment', '+', 1) }))
        .execute()
      await this.#remember(tx, request.key, result, pending ? [] : events)
    })
    if (pending) {
      return { result, events: [] }
    }
    return {
      result,
      events,
    }
  }

  async #resolve(request: WriteRequest, write: Extract<IdeaWrite, { type: 'resolve' }>) {
    await this.#requireMeta()
    const id = await this.#rootComment(write.comment, request.caller)
    const row = await this.#db.selectFrom('comments').select('pending').where('id', '=', id).executeTakeFirst()
    if (row?.pending) {
      refuse('invalid', `${id} is pending: submit your review first`)
    }
    const result: WriteResult = { ok: true, value: { kind: 'resolved', comment: id, resolved: write.resolved } }
    await this.#transaction(async (tx) => {
      await tx
        .updateTable('comments')
        .set({ resolved: write.resolved ? 1 : 0 })
        .where('id', '=', id)
        .execute()
      await this.#remember(tx, request.key, result)
    })
    return {
      result,
      events: [
        { name: 'resolved', payload: { comment: id, resolved: write.resolved, by: request.caller } },
      ] satisfies IdeaEvent[],
    }
  }

  /**
   * Keeps the latest version a person has opened. It tells no one and changes
   * nothing anyone else sees but reviewers' state, so it isn't remembered as a
   * write: sending it again is harmless. A bot's reading isn't kept.
   */
  async #seen(request: WriteRequest, write: Extract<IdeaWrite, { type: 'seen' }>) {
    const meta = await this.#requireMeta()
    if (write.version > meta.latest) {
      refuse('not_found', `there's no v${write.version}: the latest is v${meta.latest}`)
    }
    if (request.caller.purpose !== 'me') {
      return { result: { ok: true, value: { kind: 'seen', version: null } } satisfies WriteResult, events: [] }
    }
    const user = request.caller.user
    const before = await this.#db.selectFrom('seen').select('version').where('user', '=', user).executeTakeFirst()
    const version = Math.max(before?.version ?? 0, write.version)
    if (version !== before?.version) {
      await this.#db
        .insertInto('seen')
        .values({ user, version, at: this.#now() })
        .onConflict((oc) => oc.column('user').doUpdateSet({ version, at: this.#now() }))
        .execute()
    }
    return { result: { ok: true, value: { kind: 'seen', version } } satisfies WriteResult, events: [] }
  }

  async #accept(request: WriteRequest, write: Extract<IdeaWrite, { type: 'accept' }>) {
    const latest = await this.#loadLatest()
    const ids = [...new Set(write.suggestions)]
    const rows = new Map((await this.#suggestions(ids)).map((r) => [r.id, r]))
    const anchors = new Map(latest.comments.map((c) => [c.id, c.anchor]))
    const skipped: Skipped[] = []
    const candidates: Suggestion[] = []
    for (const id of ids) {
      const row = rows.get(id)!
      if (row.decision?.kind === 'accepted') {
        skipped.push({ id, message: `it was accepted in v${row.decision.version}` })
        continue
      }
      candidates.push({ id, anchor: anchors.get(id) ?? null, old: row.old, new: row.new })
    }
    return this.#acceptIntoDraft(request, candidates, skipped)
  }

  async #reject(request: WriteRequest, write: Extract<IdeaWrite, { type: 'reject' }>) {
    await this.#requireMeta()
    const [row] = await this.#suggestions([write.suggestion])
    if (row!.decision?.kind === 'accepted') {
      refuse('invalid', `${row!.id} was accepted in v${row!.decision.version}; edit the idea to undo it`)
    }
    const decision: Decision = { kind: 'rejected', by: request.caller, at: this.#now(), version: null }
    const result: WriteResult = { ok: true, value: { kind: 'rejected', comment: row!.id } }
    const { latest, state, derived } = await this.#draftNow(request.caller)
    const drafted = state.suggestions.some((s) => s.comment === row!.id)
    const events: IdeaEvent[] = [
      { name: 'decided', payload: { comment: row!.id, decision, by: request.caller } },
      ...(drafted ? [{ name: 'draft' as const, payload: { by: request.caller } }] : []),
    ]
    if (!drafted) {
      await this.#transaction(async (tx) => {
        await this.#decide(tx, [row!.id], decision)
        await this.#remember(tx, request.key, result, events)
      })
      return { result, events }
    }
    // out of the draft: the draft as it would be without it
    const rest = derived.entries.filter((e) => !(e.change.kind === 'suggestion' && e.change.comment === row!.id))
    const built = await this.#core.buildDraft(this.id, latest.idea, latest.comments, rest.map(plainEntry))
    const next = await this.#nextDraft(request, latest, state, derived, {
      files: built.files,
      suggestions: state.suggestions.filter((s) => s.comment !== row!.id),
      held: state.held,
    })
    return this.#keepDraft(request, result, next, (tx) => this.#decide(tx, [row!.id], decision), events)
  }

  /** Suggestions by ID, refusing any that isn't one. */
  async #suggestions(ids: string[]) {
    const rows = await this.#db
      .selectFrom('comments')
      .select(['id', 'parent', 'suggestion', 'decision'])
      .where('id', 'in', ids)
      // pending ones aren't out yet
      .where('pending', 'is', null)
      .execute()
    const byId = new Map(rows.map((r) => [r.id, r]))
    return ids.map((id) => {
      const row = byId.get(id)
      if (!row || row.parent || !row.suggestion) {
        refuse('not_found', `${id} isn't a suggestion on this idea`)
      }
      const { old, new: replacement } = JSON.parse(row!.suggestion!) as { old: string; new: string }
      return { id, old, new: replacement, decision: row!.decision ? (JSON.parse(row!.decision) as Decision) : null }
    })
  }

  /** Records a decision on suggestions, resolving their threads. */
  async #decide(tx: Kysely<IdeaDB>, ids: string[], decision: Decision): Promise<void> {
    if (ids.length === 0) {
      return
    }
    await tx
      .updateTable('comments')
      .set({ decision: JSON.stringify(decision), resolved: 1 })
      .where('id', 'in', ids)
      .execute()
  }

  // --- the draft ------------------------------------------------------------------
  //
  // Live documents, one for each file the draft has changed (draft.ts). Every write that changes the
  // draft works out the files it should read as, with core's buildDraft as always, and moves each
  // document there by steps; the changes are worked out again from the documents.

  /** The latest version's file, as a live document is written against it; null if it has none. */
  #baseOf(idea: Idea, file: string): { source: string; ids: string[] } | null {
    const found = idea.files.find((f) => f.id === file)
    return found ? { source: found.source, ids: found.unitIds } : null
  }

  /** A file's steps after `seq`, as stored. */
  async #stepsAfter(file: string, seq: number): Promise<unknown[]> {
    const rows = await this.#db
      .selectFrom('draft_steps')
      .select('step')
      .where('file', '=', file)
      .where('seq', '>', seq)
      .orderBy('seq')
      .execute()
    return rows.map((r) => JSON.parse(r.step) as unknown)
  }

  /**
   * The draft as stored, read against `base` (the latest version): each file's document as it now
   * is. `keep`: a write's, which holds the documents from here on; a read's doesn't.
   */
  async #draftState(base: Idea, keep: boolean): Promise<DraftState> {
    const files = await this.#db.selectFrom('draft_files').selectAll().execute()
    const lives = new Map<string, Live>()
    const blocks = new Map<string, EditorBlock[]>()
    for (const row of files) {
      const version = this.#baseOf(base, row.file)
      if (!version) {
        // a file the latest version no longer has
        continue
      }
      const live = await this.#live.load(row.file, row, version, () => this.#stepsAfter(row.file, row.steps), keep)
      lives.set(row.file, live)
      blocks.set(row.file, this.#live.blocks(live))
    }
    const suggestions = await this.#db
      .selectFrom('draft_suggestions')
      .selectAll()
      .orderBy('at')
      .orderBy('comment')
      .execute()
    const held = await this.#db.selectFrom('draft_held').selectAll().orderBy('at').orderBy('key').execute()
    const moved = (await this.#db.selectFrom('draft_moved').select('words').orderBy('seq').execute()).map(
      (r) => JSON.parse(r.words) as MovedWords,
    )
    const authors = new Map<string, Array<{ by: Caller; at: number }>>()
    for (const r of await this.#db.selectFrom('draft_authors').selectAll().orderBy('at', 'desc').execute()) {
      authors.set(r.block, [...(authors.get(r.block) ?? []), { by: JSON.parse(r.by) as Caller, at: r.at }])
    }
    return {
      rows: new Map(files.map((r) => [r.file, r])),
      lives,
      blocks,
      suggestions: suggestions.map((r) => ({
        comment: r.comment,
        change: JSON.parse(r.change) as DraftChange,
        by: JSON.parse(r.by) as Caller,
        at: r.at,
      })),
      held: held.map((r) => ({
        key: r.key,
        change: JSON.parse(r.change) as DraftChange,
        by: JSON.parse(r.by) as Caller,
        at: r.at,
      })),
      authors,
      moved,
      base,
    }
  }

  /**
   * The draft's changes on `idea`: those held, the suggestions accepted, then the difference between
   * its files and the idea with those suggestions in, by block ID; and the draft built from them.
   * Each change from the documents is whoever last changed one of its blocks.
   */
  async #derive(
    idea: Idea,
    comments: Comment[],
    state: Pick<DraftState, 'blocks' | 'suggestions' | 'held' | 'authors' | 'moved'>,
    fallback: Caller,
  ): Promise<Derived> {
    const taken = new Set(state.held.map((h) => h.key))
    const accepted: DraftItem[] = state.suggestions.map((s) => ({
      key: keyOf(s.change, taken),
      change: s.change,
      by: s.by,
      at: s.at,
      kind: 'suggestion',
    }))
    let base = idea
    if (accepted.length > 0) {
      base = (await this.#core.buildDraft(this.id, idea, comments, accepted.map(plainEntry))).idea
    }
    const derived: DraftItem[] = []
    const files = Object.fromEntries([...state.blocks].filter(([file]) => base.files.some((f) => f.id === file)))
    if (Object.keys(files).length > 0) {
      const made = await this.#core.draftChanges(this.id, base, files, stillMoved(state.moved, state.blocks, base))
      if (!made.ok) {
        throw new Error(`the draft's documents make no changes: ${made.message}`)
      }
      for (const change of made.changes) {
        derived.push({ key: keyOf(change, taken), change, by: fallback, at: 0, kind: 'derived' })
      }
    }
    const entries: DraftItem[] = [...state.held.map((h) => ({ ...h, kind: 'held' as const })), ...accepted, ...derived]
    const built = await this.#core.buildDraft(this.id, idea, comments, entries.map(plainEntry))
    for (const e of derived) {
      const latest = blocksOfChange(e.key, e.change, built)
        .flatMap((block) => state.authors.get(block)?.slice(0, 1) ?? [])
        .sort((a, b) => b.at - a.at)[0]
      if (latest) {
        e.by = latest.by
        e.at = latest.at
      }
    }
    return { entries, built }
  }

  /**
   * The draft as it's to be: its files as `files` has them, with these suggestions and held changes.
   * Works out each document's steps and who changed what (whoever's change it is now, if it's new or
   * different); `save` keeps them, in the write's transaction, `done` once it's committed, and
   * `events` sends the steps to everyone editing.
   */
  async #nextDraft(
    request: WriteRequest,
    on: { idea: Idea; comments: Comment[] },
    state: DraftState,
    before: Derived,
    next: {
      files: Array<{ id: string; source: string; unitIds: string[] }>
      suggestions: DraftSuggestion[]
      held: DraftHeld[]
      /** Committed or discarded: the words seen moved are forgotten. */
      clearMoved?: boolean
    },
  ): Promise<NextDraft> {
    const at = this.#now()
    const version = new Map(on.idea.files.map((f) => [f.id, { source: f.source, ids: f.unitIds }]))
    const same = (a: DraftText | undefined, b: DraftText) =>
      a !== undefined && a.source === b.source && JSON.stringify(a.ids) === JSON.stringify(b.ids)
    // the files the draft has: its documents, and those that differ from the version
    const targets = new Map<string, DraftText>()
    for (const f of next.files) {
      const text = { source: f.source, ids: f.unitIds }
      if (state.blocks.has(f.id) || !same(version.get(f.id), text)) {
        targets.set(f.id, text)
      }
    }
    const after = await this.#derive(
      on.idea,
      on.comments,
      {
        blocks: new Map([...targets].map(([file, text]) => [file, blocksOf(text)])),
        suggestions: next.suggestions,
        held: next.held,
        authors: state.authors,
        moved: next.clearMoved ? [] : state.moved,
      },
      request.caller,
    )
    // the IDs new text will have once it's committed, as the draft built from its changes gives them
    const finalTexts = new Map<string, DraftText>()
    for (const f of after.built.files) {
      if (targets.has(f.id)) {
        finalTexts.set(f.id, { source: f.source, ids: f.unitIds })
      }
    }
    const retargeted: Array<{ live: Live; r: Retargeted; text: DraftText; row: boolean }> = []
    for (const [file, text] of finalTexts) {
      // a document's starting point: its own, or the file as the draft was read against
      const start = this.#baseOf(state.base, file) ?? { source: text.source, ids: text.ids as string[] }
      // a file new to the draft: held once its row is stored (done())
      const live = state.lives.get(file) ?? (await this.#live.load(file, null, start, async () => [], false))
      const r = this.#live.retarget(file, live, text)
      if (r.steps.length > 0 || !state.rows.has(file)) {
        retargeted.push({ live, r, text, row: state.rows.has(file) })
      }
    }
    // who changed what: unchanged changes keep theirs
    const was = new Map(before.entries.map((e) => [e.key, JSON.stringify(e.change)]))
    const authored = after.entries.filter((e) => e.kind === 'derived' && was.get(e.key) !== JSON.stringify(e.change))
    for (const e of authored) {
      e.by = request.caller
      e.at = at
    }
    const authoredBlocks = new Set(authored.flatMap((e) => blocksOfChange(e.key, e.change, after.built)))
    const kept = new Set(after.entries.flatMap((e) => blocksOfChange(e.key, e.change, after.built)))
    const by = JSON.stringify(request.caller)
    const save = async (tx: Kysely<IdeaDB>) => {
      for (const { r, text, row } of retargeted) {
        const from = r.count - r.steps.length
        for (const [i, step] of r.steps.entries()) {
          await tx
            .insertInto('draft_steps')
            .values({ file: r.file, seq: from + i + 1, step: JSON.stringify(step), by, client: 'server', at })
            .execute()
        }
        const snapshot = {
          steps: r.count,
          doc: JSON.stringify(r.doc.toJSON()),
          source: text.source,
          ids: JSON.stringify(text.ids),
          at,
        }
        if (row) {
          await tx.updateTable('draft_files').set(snapshot).where('file', '=', r.file).execute()
        } else {
          await tx
            .insertInto('draft_files')
            .values({ file: r.file, ...snapshot })
            .execute()
        }
        await this.#prune(tx, r.file, r.count, r.count)
      }
      await tx.deleteFrom('draft_suggestions').execute()
      for (const s of next.suggestions) {
        await tx
          .insertInto('draft_suggestions')
          .values({ comment: s.comment, change: JSON.stringify(s.change), by: JSON.stringify(s.by), at: s.at })
          .execute()
      }
      await tx.deleteFrom('draft_held').execute()
      for (const h of next.held) {
        await tx
          .insertInto('draft_held')
          .values({ key: h.key, change: JSON.stringify(h.change), by: JSON.stringify(h.by), at: h.at })
          .execute()
      }
      // who changed blocks no change is to any more is forgotten
      const gone = [...state.authors.keys()].filter((block) => !kept.has(block))
      if (gone.length > 0) {
        await tx.deleteFrom('draft_authors').where('block', 'in', gone).execute()
      }
      await this.#authored(tx, authoredBlocks, by, at)
      if (next.clearMoved) {
        await tx.deleteFrom('draft_moved').execute()
      }
    }
    const events: IdeaEvent[] = retargeted
      .filter(({ r }) => r.steps.length > 0)
      .map(({ r }) => ({
        name: 'draftSteps',
        payload: {
          file: r.file,
          from: r.count - r.steps.length,
          steps: r.steps,
          clients: r.steps.map(() => 'server'),
        },
      }))
    return {
      after,
      save,
      done: () => {
        for (const { live, r } of retargeted) {
          this.#live.commit(r.file, live, r.doc, r.count, r.count)
        }
      },
      events,
    }
  }

  /** Who changed these blocks: the caller, now. */
  async #authored(tx: Kysely<IdeaDB>, blocks: Iterable<string>, by: string, at: number): Promise<void> {
    for (const block of blocks) {
      await tx
        .insertInto('draft_authors')
        .values({ block, by, at })
        .onConflict((oc) => oc.columns(['block', 'by']).doUpdateSet({ at }))
        .execute()
    }
  }

  /**
   * A file's steps that aren't needed any more: in its snapshot (at `snapshot`), and older than both
   * the last limits.draft.keepSteps and keepMinutes, which editors catching up may still ask for.
   */
  async #prune(tx: Kysely<IdeaDB>, file: string, count: number, snapshot: number): Promise<void> {
    await tx
      .deleteFrom('draft_steps')
      .where('file', '=', file)
      .where('seq', '<=', Math.min(snapshot, count - this.#limits.draft.keepSteps))
      .where('at', '<', this.#now() - this.#limits.draft.keepMinutes * 60_000)
      .execute()
  }

  /** Writes the draft as it's to be, with the write's result, in one transaction. */
  async #keepDraft(
    request: WriteRequest,
    result: WriteResult,
    next: NextDraft,
    also?: (tx: Kysely<IdeaDB>) => Promise<void>,
    events: IdeaEvent[] = [{ name: 'draft', payload: { by: request.caller } }],
  ) {
    // the steps first, so editors have the documents as they are when they read the draft again
    const all = [...next.events, ...events]
    try {
      await this.#transaction(async (tx) => {
        await next.save(tx)
        await also?.(tx)
        await this.#remember(tx, request.key, result, all)
      })
    } catch (error) {
      this.#live.forget()
      throw error
    }
    next.done()
    return { result, events: all }
  }

  /** The draft on the latest version, as stored: a write's (`keep`), or a read's. */
  async #draftNow(caller: Caller, keep = true) {
    const latest = await this.#loadLatest()
    const state = await this.#draftState(latest.idea, keep)
    const derived = await this.#derive(latest.idea, latest.comments, state, caller)
    return { latest, state, derived }
  }

  // --- typing -----------------------------------------------------------------------
  //
  // An editor's steps, on the count of the file's steps it had: taken only on the latest count, and
  // stored before they're sent back, to everyone, as saved. A behind editor takes what it missed
  // and replays its own on top (ui's collab.ts). New blocks take their IDs here.

  /** A file of the draft opened to edit: its document and count. It's a draft file from here on. */
  async openDraftFile(file: string): Promise<{ version: number; doc: unknown } | null> {
    await this.#requireMeta()
    const latest = await this.#loadLatest()
    const base = this.#baseOf(latest.idea, file)
    if (!base) {
      return null
    }
    const row = await this.#db.selectFrom('draft_files').selectAll().where('file', '=', file).executeTakeFirst()
    // held once its row is stored, so a held document is always of a file open in the draft
    const live = await this.#live.load(file, row ?? null, base, () => this.#stepsAfter(file, row!.steps), !!row)
    if (!row) {
      const at = this.#now()
      await this.#db
        .insertInto('draft_files')
        .values({
          file,
          steps: 0,
          doc: JSON.stringify(live.doc.toJSON()),
          source: base.source,
          ids: JSON.stringify(base.ids),
          at,
        })
        .execute()
      this.#live.commit(file, live, live.doc, 0, 0)
    }
    return { version: live.steps, doc: live.doc.toJSON() }
  }

  /** Words an editor saw cut from one block and pasted into another: kept, so the draft counts them as moved. */
  async movedWords(words: MovedWords, caller: Caller): Promise<void> {
    await this.#requireMeta()
    await this.#db
      .insertInto('draft_moved')
      .values({ words: JSON.stringify(words), by: JSON.stringify(caller), at: this.#now() })
      .execute()
  }

  /** What an editor missed in a file since its count `version`: the steps after it, if they're still kept. */
  async draftSince(file: string, version: number): Promise<Missed> {
    const row = await this.#db.selectFrom('draft_files').select('steps').where('file', '=', file).executeTakeFirst()
    const rows = await this.#db
      .selectFrom('draft_steps')
      .select(['seq', 'step', 'client'])
      .where('file', '=', file)
      .where('seq', '>', version)
      .orderBy('seq')
      .execute()
    const last = await this.#db
      .selectFrom('draft_steps')
      .select((eb) => eb.fn.max('seq').as('seq'))
      .where('file', '=', file)
      .executeTakeFirst()
    const count = Math.max(row?.steps ?? 0, Number(last?.seq ?? 0))
    if (version > count || (version < count && rows[0]?.seq !== version + 1)) {
      return { kind: 'gone' }
    }
    return {
      kind: 'steps',
      from: version,
      steps: rows.map((r) => JSON.parse(r.step) as unknown),
      clients: rows.map((r) => r.client),
    }
  }

  /**
   * The file's count, if typing sent on `version` is behind it: from the document held, so with no
   * reads; null if it isn't held, or the count is `version`. A held document is of a file the latest
   * version has, open in the draft, so a send this refuses would be refused as behind in its turn too.
   * The count only goes up (no file's row in the draft is deleted), so a send behind now stays behind.
   */
  behind(file: string, version: number): number | null {
    const count = this.#live.count(file)
    return count !== null && count !== version ? count : null
  }

  /** Typing: stored, with the IDs new blocks take, and sent to everyone editing the file. */
  async typing(t: Typing): Promise<{ result: TypingResult; events: IdeaEvent[] }> {
    // behind: answered from the document held, before any reads
    const count = this.behind(t.file, t.version)
    if (count !== null) {
      return { result: { kind: 'behind', version: count }, events: [] }
    }
    const refused = (message: string) => ({ result: { kind: 'refused' as const, message }, events: [] })
    await this.#requireMeta()
    const latest = await this.#loadLatest()
    const base = this.#baseOf(latest.idea, t.file)
    const row = await this.#db.selectFrom('draft_files').selectAll().where('file', '=', t.file).executeTakeFirst()
    if (!base || !row) {
      return refused(base ? 'the file isn’t open in the draft' : 'the latest version has no such file')
    }
    const live = await this.#live.load(t.file, row, base, () => this.#stepsAfter(t.file, row.steps), true)
    if (t.version !== live.steps) {
      return { result: { kind: 'behind', version: live.steps }, events: [] }
    }
    let applied: ReturnType<typeof applyEach>
    try {
      applied = applyEach(live.env.schema, live.doc, t.steps)
    } catch (error) {
      return refused(error instanceof Error ? error.message : String(error))
    }
    const typed = applied.docs.at(-1)!
    // new blocks, and the second of two with one ID: the IDs committing would give them, in every file
    const before = holders(live.doc).map((h) => h.id)
    const now = holders(typed).map((h) => h.id)
    const unsettled =
      now.some((id, i) => id === null || now.indexOf(id) !== i) || JSON.stringify(before) !== JSON.stringify(now)
    const named: Map<string, Renamed> = unsettled
      ? await this.#normalize(latest, t.file, live, typed, t.caller)
      : new Map()
    const mine = named.get(t.file)
    const final = mine?.doc ?? typed
    const renames = new Map([...named.values()].flatMap((n) => [...n.renames]))
    const blocks = [...touched(applied.docs, applied.steps, final, mine?.steps ?? [])].map(
      (id) => renames.get(id) ?? id,
    )

    const at = this.#now()
    const by = JSON.stringify(t.caller)
    // each file's steps as stored and sent: the editor's, then the server's
    const files = new Map<string, { live: Live; doc: Node; steps: unknown[]; clients: string[] }>()
    files.set(t.file, {
      live,
      doc: final,
      steps: [...t.steps, ...(mine?.steps ?? []).map((s) => s.toJSON())],
      clients: [...t.steps.map(() => t.client), ...(mine?.steps ?? []).map(() => 'server')],
    })
    for (const [file, n] of named) {
      if (file !== t.file) {
        files.set(file, {
          live: n.live,
          doc: n.doc,
          steps: n.steps.map((s) => s.toJSON()),
          clients: n.steps.map(() => 'server'),
        })
      }
    }
    const snapshots = new Map<string, number>()
    try {
      await this.#transaction(async (tx) => {
        for (const [file, f] of files) {
          for (const [i, step] of f.steps.entries()) {
            await tx
              .insertInto('draft_steps')
              .values({ file, seq: f.live.steps + i + 1, step: JSON.stringify(step), by, client: f.clients[i]!, at })
              .execute()
          }
          const count = f.live.steps + f.steps.length
          let snapshot = f.live.snapshot
          if (count - snapshot >= this.#limits.draft.snapshotEvery) {
            const text = this.#live.text(f.live, f.doc)
            await tx
              .updateTable('draft_files')
              .set({
                steps: count,
                doc: JSON.stringify(f.doc.toJSON()),
                source: text.source,
                ids: JSON.stringify(text.ids),
                at,
              })
              .where('file', '=', file)
              .execute()
            snapshot = count
          }
          snapshots.set(file, snapshot)
          await this.#prune(tx, file, count, snapshot)
        }
        // who changed blocks that took new IDs is kept under them
        if (renames.size > 0) {
          const moved = await tx
            .selectFrom('draft_authors')
            .selectAll()
            .where('block', 'in', [...renames.keys()])
            .execute()
          await tx
            .deleteFrom('draft_authors')
            .where('block', 'in', [...renames.keys()])
            .execute()
          for (const r of moved) {
            await tx
              .insertInto('draft_authors')
              .values({ ...r, block: renames.get(r.block)! })
              .onConflict((oc) => oc.columns(['block', 'by']).doNothing())
              .execute()
          }
        }
        await this.#authored(tx, blocks, by, at)
      })
    } catch (error) {
      this.#live.forget()
      throw error
    }
    const events: IdeaEvent[] = []
    for (const [file, f] of files) {
      const count = f.live.steps + f.steps.length
      this.#live.commit(file, f.live, f.doc, count, snapshots.get(file))
      events.push({
        name: 'draftSteps',
        payload: { file, from: f.live.steps, steps: f.steps, clients: f.clients },
      })
    }
    return { result: { kind: 'taken', version: live.steps + files.get(t.file)!.steps.length }, events }
  }

  /**
   * The IDs blocks should have, in every file, with `file` as typed (`typed`): new blocks (and the
   * second of two with one ID) take the IDs committing would give them, and others' new blocks may be
   * renumbered with them. Each file's steps to them (only attributes change), and the IDs renamed.
   * Where the draft can't be worked out, a new block takes an ID of its own.
   */
  async #normalize(
    latest: Latest,
    file: string,
    live: Live,
    typed: Node,
    caller: Caller,
  ): Promise<Map<string, Renamed>> {
    const state = await this.#draftState(latest.idea, true)
    const own = this.#live.blocks(live, typed)
    const seen = new Set<string>()
    state.blocks.set(
      file,
      own.map((b) => {
        if (b.id && !seen.has(b.id)) {
          seen.add(b.id)
          return b
        }
        return { ...b, id: null }
      }),
    )
    state.lives.set(file, live)
    let built: BuiltDraft | null = null
    try {
      built = (await this.#derive(latest.idea, latest.comments, state, caller)).built
    } catch {
      built = null
    }
    const out = new Map<string, Renamed>()
    for (const [f, l] of state.lives) {
      const doc = f === file ? typed : l.doc
      const units = l.base.codec.identities(doc)
      const final = built?.files.find((x) => x.id === f)?.unitIds
      const tr = new Transform(doc)
      const renames = new Map<string, string>()
      const counts = new Map<string, number>()
      units.forEach((u) => u.id && counts.set(u.id, (counts.get(u.id) ?? 0) + 1))
      if (final && final.length === units.length) {
        units.forEach((u, i) => {
          if (u.at !== null && u.id !== final[i]) {
            tr.setNodeAttribute(u.at, 'blockId', final[i]!)
            if (u.id && counts.get(u.id) === 1) {
              renames.set(u.id, final[i]!)
            }
          }
        })
      } else if (f === file) {
        const taken = new Set<string>()
        for (const h of holders(doc)) {
          if (!h.id || taken.has(h.id)) {
            tr.setNodeAttribute(h.pos, 'blockId', `n${(this.#now() + Math.random()).toString(36).replace('.', '')}`)
          } else {
            taken.add(h.id)
          }
        }
      }
      if (tr.steps.length > 0) {
        out.set(f, { live: l, doc: tr.doc, steps: tr.steps, renames })
      }
    }
    return out
  }

  /**
   * Adds changes, in order, if they all apply to the draft as it is now; otherwise none goes in,
   * refused as outdated. The draft keeps the difference from the latest version, not the history:
   * editing a block again is the same change, and editing it back leaves none.
   */
  async #draftAdd(request: WriteRequest, changes: DraftChange[]) {
    if (changes.some((c) => c.kind === 'suggestion')) {
      refuse('invalid', 'suggestions go into the draft by accepting them')
    }
    await this.#requireMeta()
    const { latest, state, derived } = await this.#draftNow(request.caller)
    const incoming = changes.map((change, i) => ({ key: `+${i}`, change }))
    const built = await this.#core.buildDraft(this.id, latest.idea, latest.comments, [
      ...derived.entries.map(plainEntry),
      ...incoming,
    ])
    for (const [i] of changes.entries()) {
      const problem = built.problems[`+${i}`]
      if (problem !== undefined) {
        const which = changes.length > 1 ? `change ${i + 1} of ${changes.length}: ` : ''
        refuse('conflict', `outdated: ${which}${problem}`, { problem, change: i })
      }
    }
    const next = await this.#nextDraft(request, latest, state, derived, {
      files: built.files,
      suggestions: state.suggestions,
      held: state.held,
    })
    const keys = changes.map((change) => changeKey(change, next.after))
    return this.#keepDraft(request, { ok: true, value: { kind: 'draft', keys } }, next)
  }

  async #undraft(request: WriteRequest, key: string) {
    await this.#requireMeta()
    const { latest, state, derived } = await this.#draftNow(request.caller)
    const entry = derived.entries.find((e) => e.key === key)
    if (!entry) {
      refuse('not_found', `no change ${key} in the draft`)
    }
    const rest = derived.entries.filter((e) => e.key !== key)
    const built = await this.#core.buildDraft(this.id, latest.idea, latest.comments, rest.map(plainEntry))
    const next = await this.#nextDraft(request, latest, state, derived, {
      files: built.files,
      suggestions: state.suggestions.filter(
        (s) => !(entry!.change.kind === 'suggestion' && s.comment === entry!.change.comment),
      ),
      held: state.held.filter((h) => h.key !== key),
    })
    return this.#keepDraft(request, { ok: true, value: { kind: 'draft', keys: [] } }, next)
  }

  async #discard(request: WriteRequest) {
    await this.#requireMeta()
    const { latest, state, derived } = await this.#draftNow(request.caller)
    const next = await this.#nextDraft(request, latest, state, derived, {
      files: latest.idea.files,
      suggestions: [],
      held: [],
      clearMoved: true,
    })
    return this.#keepDraft(request, { ok: true, value: { kind: 'draft', keys: [] } }, next)
  }

  /** Suggestions into the draft, one by one; one that doesn't apply to the draft as it is stays open, saying why. */
  async #acceptIntoDraft(request: WriteRequest, candidates: Suggestion[], skipped: Skipped[]) {
    const { latest, state, derived } = await this.#draftNow(request.caller)
    const inDraft = new Set(state.suggestions.map((s) => s.comment))
    let entries: DraftEntry[] = derived.entries.map(plainEntry)
    let files = derived.built.files
    const added: DraftSuggestion[] = []
    const at = this.#now()
    for (const s of candidates) {
      if (inDraft.has(s.id)) {
        skipped.push({ id: s.id, message: 'it’s in the draft already' })
        continue
      }
      const change: DraftChange = { kind: 'suggestion', comment: s.id, old: s.old, new: s.new }
      const entry: DraftEntry = { key: `s+${s.id}`, change }
      const built = await this.#core.buildDraft(this.id, latest.idea, latest.comments, [...entries, entry])
      const problem = built.problems[entry.key]
      if (problem !== undefined) {
        skipped.push({ id: s.id, message: problem })
        continue
      }
      entries = [...entries, entry]
      files = built.files
      added.push({ comment: s.id, change, by: request.caller, at })
    }
    if (added.length === 0) {
      refuse(
        'conflict',
        `none of these suggestions apply to the draft: ${skipped.map((s) => `${s.id}, ${s.message}`).join('; ')}`,
        { skipped },
      )
    }
    const next = await this.#nextDraft(request, latest, state, derived, {
      files,
      suggestions: [...state.suggestions, ...added],
      held: state.held,
    })
    const result: WriteResult = {
      ok: true,
      value: { kind: 'drafted', accepted: added.map((a) => a.comment), skipped },
    }
    return this.#keepDraft(request, result, next)
  }

  /** Commits the draft as one version. Every change must still apply: outdated ones are undone or redone first. */
  async #commit(request: WriteRequest) {
    const meta = await this.#requireMeta()
    const { latest, derived } = await this.#draftNow(request.caller)
    if (derived.entries.length === 0) {
      refuse('invalid', 'the draft is empty')
    }
    const built = derived.built
    const outdated = Object.entries(built.problems)
    if (outdated.length > 0) {
      const n = outdated.length
      refuse(
        'conflict',
        `${n === 1 ? '1 change is' : `${n} changes are`} outdated: undo or redo ${n === 1 ? 'it' : 'them'} first`,
        {
          changes: outdated.map(([key, problem]) => ({ key, problem })),
        },
      )
    }
    if (built.commands.length === 0) {
      refuse('invalid', 'the draft changes nothing')
    }
    this.#checkSizes(
      latest.bytes,
      built.idea.files.map((f) => ({ file: f.id, path: f.path, bytes: byteLength(f.source) })),
    )
    const steps = built.commands.map((command, step) => ({ step, command, addresses: command.addresses ?? [] }))
    const stepResults = built.commands.map((command, step) => ({
      step,
      command: command.command,
      addresses: command.addresses ?? [],
    }))
    const accepted = derived.entries.flatMap((e) => (e.change.kind === 'suggestion' ? [e.change.comment] : []))
    const decision: Decision = { kind: 'accepted', by: request.caller, at: this.#now(), version: meta.latest + 1 }
    return this.#newVersion(request, meta, latest, 'commands', built.idea, built.comments, steps, stepResults, {
      decide: { ids: accepted, decision },
      clearDraft: true,
    })
  }

  async #edit(request: WriteRequest, write: Extract<IdeaWrite, { type: 'edit' }>) {
    const meta = await this.#requireMeta()
    if (write.batch.base > meta.latest) {
      refuse('invalid', `the batch is built on v${write.batch.base}, but the latest is v${meta.latest}`)
    }
    const latest = await this.#loadLatest()
    const applied = await this.#core.applyBatch(this.id, latest.idea, latest.comments, write.batch)
    if (!applied.ok) {
      refuse('conflict', 'some steps no longer apply; re-read the idea and try again', {
        conflicts: applied.conflicts satisfies Conflict[],
      })
    }
    const ok = applied as Extract<typeof applied, { ok: true }>
    this.#checkSizes(
      latest.bytes,
      ok.idea.files.map((f) => ({ file: f.id, path: f.path, bytes: byteLength(f.source) })),
    )
    const steps = write.batch.steps.map((command, step) => ({ step, command, addresses: command.addresses ?? [] }))
    return this.#newVersion(request, meta, latest, 'commands', ok.idea, ok.comments, steps, ok.steps, {
      outdateDraft: write.outdateDraft === true,
    })
  }

  async #upload(request: WriteRequest, write: Extract<IdeaWrite, { type: 'upload' }>) {
    const meta = await this.#requireMeta()
    const latest = await this.#loadLatest()
    if (write.files.length === 0 && !write.deleted?.length) {
      refuse('invalid', 'nothing to upload')
    }
    // every existing file must say it was edited from the latest version of it
    if (!write.force) {
      const behind = write.files
        .filter((f) => f.file && latest.hashes.has(f.file) && f.base !== latest.hashes.get(f.file))
        .map((f) => ({ file: f.file!, path: f.path, base: f.base ?? null, latest: latest.hashes.get(f.file!)! }))
      if (behind.length > 0) {
        refuse(
          'pull_first',
          'the idea has changed since these files were last pulled; pull first, or force the upload',
          { files: behind, latest: meta.latest },
        )
      }
    }
    const deleted = new Set(write.deleted ?? [])
    const after = new Map([...latest.bytes].filter(([file]) => !deleted.has(file)))
    const paths = new Map(latest.idea.files.map((f) => [f.id, f.path]))
    write.files.forEach((f, i) => after.set(f.file ?? `new${i}`, byteLength(f.content)))
    for (const f of write.files) {
      if (f.file) {
        paths.set(f.file, f.path)
      }
    }
    write.files.forEach((f, i) => {
      if (!f.file) {
        paths.set(`new${i}`, f.path)
      }
    })
    this.#checkSizes(
      latest.bytes,
      [...after].map(([file, bytes]) => ({ file, path: paths.get(file) ?? file, bytes })),
    )

    const files = write.files.map((f) => ({ ...(f.file ? { file: f.file } : {}), path: f.path, content: f.content }))
    const applied = await this.#core.applyUpload(this.id, latest.idea, latest.comments, {
      files,
      ...(write.deleted ? { deleted: write.deleted } : {}),
    })
    if (!applied.ok) {
      refuse('invalid', applied.problems.join('; '), { problems: applied.problems })
    }
    const ok = applied as Extract<typeof applied, { ok: true }>
    return this.#newVersion(request, meta, latest, 'upload', ok.idea, ok.comments, [], [], {
      ...(write.gitHint ? { gitHint: write.gitHint } : {}),
      outdateDraft: write.outdateDraft === true,
    })
  }

  async #newVersion(
    request: WriteRequest,
    meta: Meta,
    latest: Latest,
    how: VersionHow,
    idea: Idea,
    outcomes: CommentOutcome[],
    steps: Array<{ step: number; command: unknown; addresses: string[] }>,
    stepResults: StepResult[],
    more: {
      gitHint?: { uri: string | null; branch: string }
      /** Suggestions this version accepts (the draft's, committed). */
      decide?: { ids: string[]; decision: Decision }
      /** Committing the draft: it's emptied with the new version. */
      clearDraft?: boolean
      /** Make the version even if changes in the draft would become outdated (confirmed by the caller). */
      outdateDraft?: boolean
    } = {},
  ) {
    const number = meta.latest + 1
    const { gitHint, decide } = more
    const on = {
      idea,
      comments: outcomes.flatMap((o) => (o.state !== 'outdated' && o.anchor ? [{ id: o.id, anchor: o.anchor }] : [])),
    }
    // the draft, moved onto the new version: committed, it's the version itself; made around it, its
    // changes that still apply are in it, and those this version outdates are held, saying why
    const state = await this.#draftState(latest.idea, true)
    let draft: NextDraft | null = null
    if (more.clearDraft) {
      const before = await this.#derive(latest.idea, latest.comments, state, request.caller)
      draft = await this.#nextDraft(request, on, state, before, {
        files: idea.files,
        suggestions: [],
        held: [],
        clearMoved: true,
      })
    } else if (state.blocks.size > 0 || state.suggestions.length > 0 || state.held.length > 0) {
      const before = await this.#derive(latest.idea, latest.comments, state, request.caller)
      const plain = before.entries.map(plainEntry)
      const after = await this.#core.buildDraft(this.id, idea, on.comments, plain)
      const overtaken = before.entries.filter(
        (e) => after.problems[e.key] !== undefined && before.built.problems[e.key] === undefined,
      )
      if (overtaken.length > 0 && !more.outdateDraft) {
        const n = overtaken.length
        refuse(
          'draft_outdated',
          `this version would make ${n === 1 ? 'a change' : `${n} changes`} in the draft outdated; confirm to make it anyway`,
          {
            changes: overtaken.map((e) => ({
              key: e.key,
              change: e.change,
              by: e.by,
              problem: after.problems[e.key]!,
            })),
          },
        )
      }
      const held = [
        ...state.held,
        ...overtaken
          .filter((e) => e.kind === 'derived')
          .map((e) => ({ key: e.key, change: e.change, by: e.by, at: e.at })),
      ]
      const heldKeys = new Set(held.map((h) => h.key))
      const kept = before.entries.filter((e) => !heldKeys.has(e.key))
      const rebased = await this.#core.buildDraft(this.id, idea, on.comments, kept.map(plainEntry))
      draft = await this.#nextDraft(request, on, state, before, {
        files: rebased.files,
        suggestions: state.suggestions,
        held,
      })
    }
    const result: WriteResult = {
      ok: true,
      value: { kind: 'version', version: number, comments: outcomes, steps: stepResults },
    }
    const stored = await this.#storeContents(idea)
    const events: IdeaEvent[] = [
      // the documents' steps onto the new version first, so editors have them when it's announced
      ...(draft?.events ?? []),
      { name: 'version', payload: { version: number, how, by: request.caller } },
      ...(decide?.ids ?? []).map((comment): IdeaEvent => ({
        name: 'decided',
        payload: { comment, decision: decide!.decision, by: request.caller },
      })),
      // a new version is what the draft is built on: editors read it again
      { name: 'draft', payload: { by: request.caller } },
    ]
    await this.#transaction(async (tx) => {
      await this.#insertVersion(tx, {
        number,
        parent: latest.version,
        how,
        caller: request.caller,
        idea,
        stored,
        steps,
        outcomes,
      })
      await tx
        .updateTable('idea')
        .set({ latest: number, ...(gitHint ? { git_uri: gitHint.uri, git_branch: gitHint.branch } : {}) })
        .execute()
      if (decide) {
        await this.#decide(tx, decide.ids, decide.decision)
      }
      await draft?.save(tx)
      await this.#remember(tx, request.key, result, events)
    }).catch((error: unknown) => {
      this.#live.forget()
      throw error
    })
    draft?.done()
    // a file the new version doesn't have isn't held: typing in it is refused, not told it's behind
    this.#live.keepOnly(idea.files.map((f) => f.id))
    this.#latest = {
      version: number,
      idea,
      ...stored,
      comments: outcomes
        .filter((o) => o.state !== 'outdated' && o.anchor)
        .map((o) => ({ id: o.id, anchor: o.anchor! })),
    }
    return {
      result,
      events,
    }
  }

  // --- reads --------------------------------------------------------------------

  /** Comment threads not resolved yet, for lists. */
  async openComments(): Promise<number> {
    const row = await this.#db
      .selectFrom('comments')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('parent', 'is', null)
      .where('resolved', '=', 0)
      .where('pending', 'is', null)
      .executeTakeFirst()
    return Number(row?.n ?? 0)
  }

  async summary() {
    const meta = await this.#meta()
    if (!meta) {
      return null
    }
    const versions = await Q.versions(this.#db, {})
    return {
      id: meta.id,
      title: meta.title,
      description: meta.description,
      owner: meta.owner,
      status: meta.status,
      createdAt: meta.created_at,
      latest: meta.latest,
      uncommitted: await this.uncommitted(),
      gitHint: meta.git_branch ? { uri: meta.git_uri, branch: meta.git_branch } : null,
      versions: versions.map((v) => ({
        number: v.number,
        parent: v.parent,
        createdAt: v.created_at,
        by: JSON.parse(v.created_by) as Caller,
        how: v.how,
        steps: Number(v.steps ?? 0),
      })),
    }
  }

  /**
   * Whether the draft has changes nobody's committed: a block someone changed, a held change or an
   * accepted suggestion. Cheap, for every page: typing a word and deleting it again leaves its block
   * counted until the next write to the draft works the changes out again.
   */
  async uncommitted(): Promise<boolean> {
    const [authored, held, suggested] = await Promise.all([
      this.#db.selectFrom('draft_authors').select('block').limit(1).executeTakeFirst(),
      this.#db.selectFrom('draft_held').select('key').limit(1).executeTakeFirst(),
      this.#db.selectFrom('draft_suggestions').select('comment').limit(1).executeTakeFirst(),
    ])
    return Boolean(authored || held || suggested)
  }

  /** The idea's status and its history, each reviewer's latest verdict, and how many comments `viewer` has pending. */
  async reviews(viewer?: string | null) {
    const meta = await this.#requireMeta()
    const history = await this.#db.selectFrom('status_changes').selectAll().orderBy('seq').execute()
    return {
      status: meta.status,
      latest: meta.latest,
      history: history.map((h): StatusChange => ({
        status: h.status,
        by: JSON.parse(h.by) as Caller,
        at: h.at,
        note: h.note,
      })),
      reviews: await this.#latestReviews(meta),
      /** The latest version each person has opened, for reviewers' state: who's shown is the caller's choice. */
      seen: await this.#db.selectFrom('seen').selectAll().orderBy('user').execute(),
      /** Comment threads not resolved, for the "all discussions resolved" requirement. */
      openThreads: await this.openComments(),
      pending: viewer
        ? Number(
            (
              await this.#db
                .selectFrom('comments')
                .select((eb) => eb.fn.countAll<number>().as('n'))
                .where('pending', '=', viewer)
                .executeTakeFirst()
            )?.n ?? 0,
          )
        : 0,
    }
  }

  /** A version's files: IDs, paths and content hashes. */
  async files(version?: number) {
    const v = await this.#versionNumber(version)
    return (await this.#manifest(v)).map((f) => ({ file: f.file, path: f.path, hash: f.hash, bytes: f.bytes }))
  }

  /** Every file of a version, with its content: what `ideaf pull` writes. */
  async pull(version?: number) {
    const v = await this.#versionNumber(version)
    const manifest = await this.#manifest(v)
    return {
      version: v,
      files: await Promise.all(
        manifest.map(async (f) => ({ file: f.file, path: f.path, hash: f.hash, content: await this.#content(f.hash) })),
      ),
    }
  }

  async file(version: number | undefined, fileId: string) {
    const v = await this.#versionNumber(version)
    const entry = (await this.#manifest(v)).find((f) => f.file === fileId)
    if (!entry) {
      return null
    }
    return { file: fileId, path: entry.path, hash: entry.hash, content: await this.#content(entry.hash) }
  }

  async outline(version?: number): Promise<FileOutline[]> {
    const v = await this.#versionNumber(version)
    const idea = v === this.#latest?.version ? this.#latest.idea : await this.#loadIdea(v)
    return this.#core.outline(this.id, idea)
  }

  /** The steps that made a version (empty for an upload). */
  async steps(version: number) {
    const rows = await this.#db
      .selectFrom('steps')
      .select(['step', 'command', 'addresses'])
      .where('version', '=', version)
      .orderBy('step')
      .execute()
    return rows.map((r) => ({
      step: r.step,
      command: JSON.parse(r.command) as unknown,
      addresses: JSON.parse(r.addresses) as string[],
    }))
  }

  /**
   * Comments as of a version: each thread's anchor and state there, the last
   * version where it was still attached (for "View in v3"), and the versions
   * whose steps addressed it.
   */
  async comments(version?: number, viewer?: string | null) {
    const v = await this.#versionNumber(version)
    const rows = await Q.comments(this.#db, { version: v, ...(viewer ? { viewer } : {}) })
    const anchors = new Map((await Q.anchors(this.#db, { version: v })).map((a) => [a.comment, a]))
    const last = new Map(
      (
        await this.#db
          .selectFrom('anchors')
          .select((eb) => ['comment', eb.fn.max('version').as('version')])
          .where('state', '!=', 'outdated')
          .where('version', '<=', v)
          .groupBy('comment')
          .execute()
      ).map((r) => [r.comment, Number(r.version)]),
    )
    // where each outdated one was in the last version it was attached in
    const outdated = rows.filter((r) => !r.parent && !anchors.get(r.id)?.anchor && last.has(r.id)).map((r) => r.id)
    const lastAnchors = new Map(
      outdated.length === 0
        ? []
        : (
            await this.#db
              .selectFrom('anchors')
              .select(['comment', 'version', 'anchor'])
              .where('comment', 'in', outdated)
              .where('state', '!=', 'outdated')
              .where('version', '<=', v)
              .execute()
          )
            .filter((a) => a.anchor !== null && Number(a.version) === last.get(a.comment))
            .map((a) => [a.comment, JSON.parse(a.anchor!) as Anchor]),
    )
    // and, for one on a section or a block, that heading or block as it was there: its outline, read once
    // for each version
    const outlines = new Map<number, Promise<FileOutline[]>>()
    const lastUnits = new Map<string, OutlineEntry>()
    for (const [comment, anchor] of lastAnchors) {
      const version = last.get(comment)
      if ((anchor.kind !== 'section' && anchor.kind !== 'block') || version === undefined) {
        continue
      }
      if (!outlines.has(version)) {
        outlines.set(version, this.outline(version))
      }
      const id = anchor.kind === 'section' ? anchor.section : anchor.block
      const unit = (await outlines.get(version)!).find((f) => f.id === anchor.file)?.entries.find((e) => e.id === id)
      if (unit) {
        lastUnits.set(comment, unit)
      }
    }
    const addressed = new Map<string, number[]>()
    for (const step of await this.#db
      .selectFrom('steps')
      .select(['version', 'addresses'])
      .where('version', '<=', v)
      .where('addresses', '!=', '[]')
      .execute()) {
      for (const id of JSON.parse(step.addresses) as string[]) {
        addressed.set(id, [...new Set([...(addressed.get(id) ?? []), step.version])])
      }
    }
    const drafted = new Set(
      (await this.#db.selectFrom('draft_suggestions').select('comment').execute()).map((r) => r.comment),
    )
    const replies = new Map<string, typeof rows>()
    for (const r of rows) {
      if (r.parent) {
        replies.set(r.parent, [...(replies.get(r.parent) ?? []), r])
      }
    }
    const shape = (r: (typeof rows)[number]) => ({
      id: r.id,
      author: JSON.parse(r.author) as Caller,
      createdAt: r.created_at,
      body: r.body,
      version: r.version,
      pending: r.pending !== null,
    })
    return rows
      .filter((r) => !r.parent)
      .map((r) => {
        const at = anchors.get(r.id)
        return {
          ...shape(r),
          resolved: r.resolved === 1,
          state: (at?.state ?? 'outdated') as AnchorState,
          anchor: at?.anchor ? (JSON.parse(at.anchor) as Anchor) : null,
          lastVersion: last.get(r.id) ?? null,
          lastAnchor: at?.anchor ? null : (lastAnchors.get(r.id) ?? null),
          lastUnit: at?.anchor ? null : (lastUnits.get(r.id) ?? null),
          addressedIn: addressed.get(r.id) ?? [],
          suggestion: suggestionOf(r, v, drafted.has(r.id)),
          replies: (replies.get(r.id) ?? []).map(shape),
        }
      })
  }

  /**
   * The draft: its changes (each with why it doesn't apply, if it doesn't),
   * the files as they'd be, each unit with where it came from, and where each
   * comment would be.
   */
  async draft() {
    const meta = await this.#requireMeta()
    const { latest, derived } = await this.#draftNow({ user: meta.owner, bot: null, purpose: 'me' }, false)
    const { entries, built } = derived
    const pending = new Set(
      (await this.#db.selectFrom('comments').select('id').where('pending', 'is not', null).execute()).map((r) => r.id),
    )
    return {
      version: latest.version,
      changes: entries.map((e) => ({
        key: e.key,
        change: e.change,
        by: e.by,
        at: e.at,
        problem: built.problems[e.key] ?? null,
      })),
      files: built.files.map((f) => ({ file: f.id, path: f.path, content: f.source, units: f.units })),
      // pending comments are their authors' alone
      comments: built.comments.filter((c) => !pending.has(c.id)),
      steps: built.commands.length,
    }
  }

  /** What a suggestion on this range of the latest version's plain text would replace. */
  async suggestionSource(file: string, start: number, end: number) {
    const latest = await this.#loadLatest()
    const checked = await this.#core.checkAnchor(this.id, latest.idea, { kind: 'text', file, start, end })
    if (!checked.ok) {
      refuse('invalid', checked.message)
    }
    const found = await this.#core.suggestionSource(this.id, latest.idea, (checked as { anchor: Anchor }).anchor)
    if (!found.ok) {
      refuse('invalid', found.message)
    }
    return { version: latest.version, old: (found as { old: string }).old }
  }

  /** A dry run of a batch: what would happen, with nothing changed. */
  async preview(batch: unknown) {
    const parsed = Batch.safeParse(batch)
    if (!parsed.success) {
      return {
        ok: false as const,
        error: { code: 'invalid' as const, message: 'the batch is malformed', details: z.treeifyError(parsed.error) },
      }
    }
    await this.#requireMeta()
    const latest = await this.#loadLatest()
    const applied = await this.#core.applyBatch(this.id, latest.idea, latest.comments, parsed.data)
    if (!applied.ok) {
      return {
        ok: false as const,
        error: {
          code: 'conflict' as const,
          message: 'some steps no longer apply',
          details: { conflicts: applied.conflicts },
        },
      }
    }
    const before = new Map(latest.idea.files.map((f) => [f.id, f]))
    const changed = applied.idea.files.filter(
      (f) => before.get(f.id)?.source !== f.source || before.get(f.id)?.path !== f.path,
    )
    return {
      ok: true as const,
      base: latest.version,
      comments: applied.comments,
      steps: applied.steps,
      files: changed.map((f) => ({
        file: f.id,
        path: f.path,
        content: f.source,
        before: before.get(f.id)?.source ?? null,
      })),
      deleted: latest.idea.files.filter((f) => !applied.idea.files.some((g) => g.id === f.id)).map((f) => f.id),
    }
  }

  // --- storage ------------------------------------------------------------------

  async #meta(): Promise<Meta | null> {
    return (await Q.meta(this.#db, {}))[0] ?? null
  }

  async #requireMeta(): Promise<Meta> {
    const meta = await this.#meta()
    if (!meta) {
      refuse('not_found', "this idea doesn't exist")
    }
    return meta!
  }

  /** A comment's thread: its own ID, or its parent's. Someone else's pending comment isn't there. */
  async #rootComment(id: string, caller: Caller): Promise<string> {
    const row = await this.#db
      .selectFrom('comments')
      .select(['id', 'parent', 'pending'])
      .where('id', '=', id)
      .executeTakeFirst()
    if (!row || (row.pending !== null && row.pending !== reviewerOf(caller))) {
      refuse('not_found', `no comment ${id}`)
    }
    return row!.parent ?? row!.id
  }

  #checkSizes(before: Map<string, number>, after: Array<{ file: string; path: string; bytes: number }>): void {
    const problems: SizeProblem[] = checkSizes(this.#limits, before, after)
    if (problems.length === 0) {
      return
    }
    const describe = (p: SizeProblem) =>
      p.path
        ? `${p.path} is ${kb(p.bytes)}; the limit for a file is ${kb(p.limit)}`
        : `the idea would be ${kb(p.bytes)}; the limit for an idea is ${kb(p.limit)}`
    refuse('too_large', problems.map(describe).join('; '), { problems })
  }

  async #versionNumber(version: number | undefined): Promise<number> {
    const meta = await this.#requireMeta()
    if (version === undefined) {
      return meta.latest
    }
    if (!Number.isInteger(version) || version < 1 || version > meta.latest) {
      refuse('not_found', `no version ${version}`)
    }
    return version
  }

  async #manifest(version: number) {
    // in the order the files were written (idea actors are SQLite only, so rowid is fine)
    return Q.manifest(this.#db, { version })
  }

  async #content(hash: string): Promise<string> {
    const bytes = await this.#files.get(hash)
    if (!bytes) {
      throw new Error(`file contents ${hash} are missing from the file store`)
    }
    return new TextDecoder().decode(bytes)
  }

  async #loadIdea(version: number): Promise<Idea> {
    const manifest = await this.#manifest(version)
    const { next_id: nextId } = await this.#db
      .selectFrom('versions')
      .select('next_id')
      .where('number', '=', version)
      .executeTakeFirstOrThrow()
    const files = await Promise.all(
      manifest.map(async (f) => ({
        id: f.file,
        path: f.path,
        source: await this.#content(f.hash),
        unitIds: JSON.parse(f.unit_ids) as string[],
      })),
    )
    return { files, nextId }
  }

  async #loadLatest(): Promise<Latest> {
    const meta = await this.#requireMeta()
    if (this.#latest?.version === meta.latest) {
      return this.#latest
    }
    const idea = await this.#loadIdea(meta.latest)
    const manifest = await this.#manifest(meta.latest)
    const rows = await this.#db
      .selectFrom('anchors as a')
      .innerJoin('comments as c', 'c.id', 'a.comment')
      .select(['a.comment', 'a.anchor'])
      .where('a.version', '=', meta.latest)
      .where('a.state', '!=', 'outdated')
      .where('a.anchor', 'is not', null)
      .where('c.parent', 'is', null)
      .orderBy('c.created_at')
      .orderBy('c.id')
      .execute()
    this.#latest = {
      version: meta.latest,
      idea,
      hashes: new Map(manifest.map((f) => [f.file, f.hash])),
      bytes: new Map(manifest.map((f) => [f.file, f.bytes])),
      comments: rows.map((r) => ({ id: r.comment, anchor: JSON.parse(r.anchor!) as Anchor })),
    }
    return this.#latest
  }

  /** Puts a version's contents in the file store (before the version is committed, so it never points at missing contents). */
  async #storeContents(idea: Idea): Promise<{ hashes: Map<string, string>; bytes: Map<string, number> }> {
    const hashes = new Map<string, string>()
    const bytes = new Map<string, number>()
    for (const file of idea.files) {
      const encoded = new TextEncoder().encode(file.source)
      const hash = await contentHash(encoded)
      if (!(await this.#files.has(hash))) {
        await this.#files.put(encoded)
      }
      hashes.set(file.id, hash)
      bytes.set(file.id, encoded.length)
    }
    return { hashes, bytes }
  }

  async #insertVersion(
    tx: Kysely<IdeaDB>,
    v: {
      number: number
      parent: number | null
      how: VersionHow
      caller: Caller
      idea: Idea
      stored: { hashes: Map<string, string>; bytes: Map<string, number> }
      steps: Array<{ step: number; command: unknown; addresses: string[] }>
      outcomes: CommentOutcome[]
    },
  ): Promise<void> {
    await tx
      .insertInto('versions')
      .values({
        number: v.number,
        parent: v.parent,
        created_at: this.#now(),
        created_by: JSON.stringify(v.caller),
        how: v.how,
        next_id: v.idea.nextId,
      })
      .execute()
    for (const file of v.idea.files) {
      await tx
        .insertInto('version_files')
        .values({
          version: v.number,
          file: file.id,
          path: file.path,
          hash: v.stored.hashes.get(file.id)!,
          bytes: v.stored.bytes.get(file.id)!,
          unit_ids: JSON.stringify(file.unitIds),
        })
        .execute()
    }
    for (const step of v.steps) {
      await tx
        .insertInto('steps')
        .values({
          version: v.number,
          step: step.step,
          command: JSON.stringify(step.command),
          addresses: JSON.stringify(step.addresses),
        })
        .execute()
    }
    for (const outcome of v.outcomes) {
      await tx
        .insertInto('anchors')
        .values({
          comment: outcome.id,
          version: v.number,
          state: outcome.state,
          anchor: outcome.anchor ? JSON.stringify(outcome.anchor) : null,
        })
        .execute()
    }
  }

  // --- the outbox: what writes tell the directory, until it has them ------------------

  /** Notifications due to be sent (oldest first): each a NotifyBatch's ID and events. */
  async outboxDue(limit = 20): Promise<Array<{ id: string; events: InboxEvent[]; attempts: number }>> {
    const rows = await Q.outboxDue(this.#db, { now: this.#now(), limit })
    return rows.map((r) => ({ id: r.id, events: JSON.parse(r.events) as InboxEvent[], attempts: r.attempts }))
  }

  /** The directory has it. */
  async outboxSent(id: string): Promise<void> {
    await this.#db.deleteFrom('outbox').where('id', '=', id).execute()
  }

  /** The directory couldn't take it: try again later, waiting longer each time (up to 5 minutes). */
  async outboxFailed(id: string, attempts: number): Promise<void> {
    const wait = Math.min(500 * 2 ** attempts, 5 * 60_000)
    await this.#db
      .updateTable('outbox')
      .set({ attempts: attempts + 1, next_at: this.#now() + wait })
      .where('id', '=', id)
      .execute()
  }

  /** How many notifications haven't reached the directory yet. */
  async outboxSize(): Promise<number> {
    const row = await this.#db
      .selectFrom('outbox')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirst()
    return Number(row?.n ?? 0)
  }

  /** When the next notification is due (null when the outbox is empty). */
  async outboxNextAt(): Promise<number | null> {
    const row = (await Q.outboxNextAt(this.#db, {}))[0]
    return row?.next == null ? null : Number(row.next)
  }

  /**
   * Keeps a write's result by its idempotency key and, in the same
   * transaction, what it tells the directory: the outbox holds it until the
   * directory has it, so a committed write's notifications can't be lost.
   * `told` is the write's events (made inbox events here) or, where a write
   * puts them together itself, inbox events already.
   */
  async #remember(
    db: Kysely<IdeaDB>,
    key: string,
    result: WriteResult,
    told: IdeaEvent[] | { inbox: InboxEvent[] } = [],
  ): Promise<void> {
    const now = this.#now()
    await db
      .insertInto('writes')
      .values({ key, result: JSON.stringify(result), at: now })
      .onConflict((oc) => oc.column('key').doUpdateSet({ result: JSON.stringify(result), at: now }))
      .execute()
    const events = Array.isArray(told) ? inboxEvents(told, now) : told.inbox
    if (events.length > 0) {
      await db
        .insertInto('outbox')
        .values({ id: crypto.randomUUID(), events: JSON.stringify(events), at: now, attempts: 0, next_at: now })
        .execute()
    }
    await db
      .deleteFrom('writes')
      .where('at', '<', now - KEEP_RESULTS_MS)
      .execute()
  }
}

const closed = (status: IdeaStatus) => status === 'closed-accepted' || status === 'closed-rejected'
const words = (status: IdeaStatus) => status.replace(/-/g, ' ')

export { reviewerOf }

/**
 * A suggestion as of a version: one accepted after it shows as still open
 * there, as it was then.
 */
function suggestionOf(
  row: { suggestion: string | null; decision: string | null },
  version: number,
  inDraft: boolean,
): SuggestionShape | null {
  if (!row.suggestion) {
    return null
  }
  const { old, new: replacement } = JSON.parse(row.suggestion) as { old: string; new: string }
  const decision = row.decision ? (JSON.parse(row.decision) as Decision) : null
  const then = decision && (decision.version === null || decision.version <= version) ? decision : null
  return { old, new: replacement, decision: then, inDraft: inDraft && !then }
}

function kb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`
}

// The idea actor's hottest queries, built once per shape and run with each
// call's values (sql/prepared.ts): building them each time took a fifth of the
// server's main thread at the design load. Each is the query it replaced.
const Q = {
  meta: prepared<Record<string, never>>()((db: Kysely<IdeaDB>) => db.selectFrom('idea').selectAll().limit(1)),
  versions: prepared<Record<string, never>>()((db: Kysely<IdeaDB>) =>
    db
      .selectFrom('versions as v')
      .select(['v.number', 'v.parent', 'v.created_at', 'v.created_by', 'v.how'])
      .select((eb) =>
        eb
          .selectFrom('steps as s')
          .select((e) => e.fn.countAll<number>().as('n'))
          .whereRef('s.version', '=', 'v.number')
          .as('steps'),
      )
      .orderBy('v.number'),
  ),
  comments: prepared<{ version: number; viewer?: string }>()((db: Kysely<IdeaDB>, s) =>
    db
      .selectFrom('comments')
      .select([
        'id',
        'parent',
        'version',
        'author',
        'created_at',
        'body',
        'resolved',
        'suggestion',
        'decision',
        'pending',
      ])
      .where('version', '<=', s.version)
      // a pending comment is its author's alone
      .where((eb) =>
        s.viewer !== undefined
          ? eb.or([eb('pending', 'is', null), eb('pending', '=', s.viewer)])
          : eb('pending', 'is', null),
      )
      .orderBy('created_at')
      .orderBy('id'),
  ),
  anchors: prepared<{ version: number }>()((db: Kysely<IdeaDB>, s) =>
    db.selectFrom('anchors').select(['comment', 'state', 'anchor']).where('version', '=', s.version),
  ),
  manifest: prepared<{ version: number }>()((db: Kysely<IdeaDB>, s) =>
    // in the order the files were written (idea actors are SQLite only, so rowid is fine)
    db
      .selectFrom('version_files')
      .select(['file', 'path', 'hash', 'bytes', 'unit_ids'])
      .where('version', '=', s.version)
      .orderBy(raw`rowid`),
  ),
  outboxDue: prepared<{ now: number; limit: number }>()((db: Kysely<IdeaDB>, s) =>
    db
      .selectFrom('outbox')
      .select(['id', 'events', 'attempts'])
      .where('next_at', '<=', s.now)
      .orderBy('at')
      .orderBy('id')
      .limit(s.limit),
  ),
  outboxNextAt: prepared<Record<string, never>>()((db: Kysely<IdeaDB>) =>
    db.selectFrom('outbox').select((eb) => eb.fn.min<number>('next_at').as('next')),
  ),
}
