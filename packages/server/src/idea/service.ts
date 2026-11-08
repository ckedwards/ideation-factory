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
  type DraftEntry,
  DraftChange,
  type Skipped,
  type Suggestion,
  type FileOutline,
  type Idea,
  type StepResult,
} from '@ideaf/core'
import { z } from 'zod'
import type { CoreRunner } from '../core-pool/runner.ts'
import type { FileStore } from '../files/store.ts'
import { byteLength, checkSizes, type Limits, type SizeProblem } from '../limits.ts'
import { type Kysely, sql as raw } from 'kysely'
import { sqliteKysely } from '../sql/kysely.ts'
import type { Sql } from '../sql/sql.ts'
import type { IdeaDB } from './schema.ts'

import { type Caller, schemas } from '@ideaf/api'

export type { Caller }

const FileInput = z.strictObject({ path: z.string().min(1).max(512), content: z.string() })

export const IdeaWrite = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('create'),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000).optional(),
    files: z.array(FileInput).min(1).max(500),
    gitHint: schemas.GitHint.optional(),
  }),
  z.strictObject({
    type: z.literal('comment'),
    /** The version the anchor refers to; it must be the latest. */
    version: z.number().int().positive(),
    anchor: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('file'), file: z.string() }),
      z.strictObject({ kind: z.literal('section'), section: z.string() }),
      z.strictObject({ kind: z.literal('text'), file: z.string(), start: z.number().int(), end: z.number().int() }),
    ]),
    body: z.string().trim().min(1).max(20_000),
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
  }),
  /** Accepts suggestions as one version, or into the draft; those that no longer apply are skipped. */
  z.strictObject({
    type: z.literal('accept'),
    suggestions: z.array(z.string()).min(1).max(100),
    into: z.enum(['version', 'draft']).optional(),
    outdateDraft: z.boolean().optional(),
  }),
  /** Adds a change to the draft, if it applies to the draft as it is. Suggestions go in by `accept`. */
  z.strictObject({ type: z.literal('draft'), change: DraftChange }),
  /** Takes a change out of the draft. */
  z.strictObject({ type: z.literal('undraft'), key: z.string().min(1).max(64) }),
  z.strictObject({ type: z.literal('discard') }),
  /** Commits the draft as one version. */
  z.strictObject({ type: z.literal('commit') }),
  z.strictObject({ type: z.literal('reject'), suggestion: z.string() }),
  z.strictObject({ type: z.literal('reply'), parent: z.string(), body: z.string().trim().min(1).max(20_000) }),
  z.strictObject({ type: z.literal('resolve'), comment: z.string(), resolved: z.boolean() }),
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
export type WriteError = { code: WriteErrorCode; message: string; details?: unknown }

export type WriteValue =
  | { kind: 'created'; version: number }
  | { kind: 'comment'; comment: string }
  | { kind: 'suggestion'; comment: string; old: string }
  | { kind: 'rejected'; comment: string }
  /** The draft changed: the change added (or merged into), if any. */
  | { kind: 'draft'; key: string | null }
  /** Suggestions accepted into the draft, and those left out. */
  | { kind: 'drafted'; accepted: string[]; skipped: Skipped[] }
  | { kind: 'resolved'; comment: string; resolved: boolean }
  | {
      kind: 'version'
      version: number
      comments: CommentOutcome[]
      steps: StepResult[]
      /** Accepting suggestions: those in the version, and those left open, saying why. */
      accepted?: string[]
      skipped?: Skipped[]
    }

export type WriteResult = { ok: true; value: WriteValue } | { ok: false; error: WriteError }

/** A comment as list_comments shows it: its thread, or one reply. */
export type CommentShape = { id: string; author: Caller; createdAt: number; body: string; version: number }
/** Whether a suggestion was accepted (in which version) or rejected, by whom and when. */
export type Decision = { kind: 'accepted' | 'rejected'; by: Caller; at: number; version: number | null }
export type SuggestionShape = { old: string; new: string; decision: Decision | null; inDraft: boolean }
export type ThreadShape = CommentShape & {
  resolved: boolean
  state: AnchorState
  anchor: Anchor | null
  lastVersion: number | null
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
        case 'comment':
        case 'suggest':
          return await this.#comment(request, write)
        case 'accept':
          return await this.#accept(request, write)
        case 'reject':
          return await this.#reject(request, write)
        case 'draft':
          return await this.#draftAdd(request, write.change)
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
    await this.#transaction(async (tx) => {
      await tx
        .insertInto('idea')
        .values({
          id: this.id,
          title: write.title,
          description: write.description ?? '',
          owner: request.caller.user,
          status: 'draft',
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
      await this.#remember(tx, request.key, result)
    })
    this.#latest = { version: 1, idea, ...stored, comments: [] }
    return {
      result,
      events: [{ name: 'version', payload: { version: 1, how: 'created', by: request.caller } }] satisfies IdeaEvent[],
    }
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
    const result: WriteResult = {
      ok: true,
      value: suggestion ? { kind: 'suggestion', comment: id, old: suggestion.old } : { kind: 'comment', comment: id },
    }
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
      await this.#remember(tx, request.key, result)
    })
    latest.comments.push({ id, anchor })
    return {
      result,
      events: [
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
              addressedIn: [],
              suggestion,
              replies: [],
            },
            by: request.caller,
          },
        },
      ] satisfies IdeaEvent[],
    }
  }

  async #reply(request: WriteRequest, write: Extract<IdeaWrite, { type: 'reply' }>) {
    const meta = await this.#requireMeta()
    const parent = await this.#rootComment(write.parent)
    const id = `c${meta.next_comment}`
    const at = this.#now()
    const result: WriteResult = { ok: true, value: { kind: 'comment', comment: id } }
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
        })
        .execute()
      await tx
        .updateTable('idea')
        .set((eb) => ({ next_comment: eb('next_comment', '+', 1) }))
        .execute()
      await this.#remember(tx, request.key, result)
    })
    return {
      result,
      events: [
        {
          name: 'reply',
          payload: {
            parent,
            reply: { id, author: request.caller, createdAt: at, body: write.body, version: meta.latest },
            by: request.caller,
          },
        },
      ] satisfies IdeaEvent[],
    }
  }

  async #resolve(request: WriteRequest, write: Extract<IdeaWrite, { type: 'resolve' }>) {
    await this.#requireMeta()
    const id = await this.#rootComment(write.comment)
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

  async #accept(request: WriteRequest, write: Extract<IdeaWrite, { type: 'accept' }>) {
    const meta = await this.#requireMeta()
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
    if (write.into === 'draft') {
      return this.#acceptIntoDraft(request, candidates, skipped)
    }
    const accepted =
      candidates.length > 0
        ? await this.#core.acceptSuggestions(this.id, latest.idea, latest.comments, meta.latest, candidates)
        : ({ ok: false, skipped: [] } as const)
    if (!accepted.ok) {
      const all = [...skipped, ...accepted.skipped]
      refuse('conflict', `none of these suggestions apply: ${all.map((s) => `${s.id}, ${s.message}`).join('; ')}`, {
        skipped: all,
      })
    }
    const ok = accepted as Extract<typeof accepted, { ok: true }>
    this.#checkSizes(
      latest.bytes,
      ok.applied.idea.files.map((f) => ({ file: f.id, path: f.path, bytes: byteLength(f.source) })),
    )
    const steps = ok.commands.map((command, step) => ({ step, command, addresses: command.addresses ?? [] }))
    const number = meta.latest + 1
    const decision: Decision = { kind: 'accepted', by: request.caller, at: this.#now(), version: number }
    return this.#newVersion(
      request,
      meta,
      latest,
      'commands',
      ok.applied.idea,
      ok.applied.comments,
      steps,
      ok.applied.steps,
      {
        decide: { ids: ok.accepted, decision },
        value: { accepted: ok.accepted, skipped: [...skipped, ...ok.skipped] },
        outdateDraft: write.outdateDraft === true,
      },
    )
  }

  async #reject(request: WriteRequest, write: Extract<IdeaWrite, { type: 'reject' }>) {
    await this.#requireMeta()
    const [row] = await this.#suggestions([write.suggestion])
    if (row!.decision?.kind === 'accepted') {
      refuse('invalid', `${row!.id} was accepted in v${row!.decision.version}; edit the idea to undo it`)
    }
    const decision: Decision = { kind: 'rejected', by: request.caller, at: this.#now(), version: null }
    const result: WriteResult = { ok: true, value: { kind: 'rejected', comment: row!.id } }
    const drafted = (await this.#draftEntries()).filter(
      (e) => e.change.kind === 'suggestion' && e.change.comment === row!.id,
    )
    await this.#transaction(async (tx) => {
      await this.#decide(tx, [row!.id], decision)
      if (drafted.length > 0) {
        await tx
          .deleteFrom('draft')
          .where(
            'key',
            'in',
            drafted.map((e) => e.key),
          )
          .execute()
      }
      await this.#remember(tx, request.key, result)
    })
    return {
      result,
      events: [
        { name: 'decided', payload: { comment: row!.id, decision, by: request.caller } },
        ...(drafted.length > 0 ? [{ name: 'draft' as const, payload: { by: request.caller } }] : []),
      ] satisfies IdeaEvent[],
    }
  }

  /** Suggestions by ID, refusing any that isn't one. */
  async #suggestions(ids: string[]) {
    const rows = await this.#db
      .selectFrom('comments')
      .select(['id', 'parent', 'suggestion', 'decision'])
      .where('id', 'in', ids)
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

  /** The draft's changes, in the order they were made. */
  async #draftEntries(): Promise<Array<DraftEntry & { seq: number; by: Caller; at: number }>> {
    const rows = await this.#db.selectFrom('draft').selectAll().orderBy('seq').execute()
    return rows.map((r) => ({
      key: r.key,
      seq: r.seq,
      change: JSON.parse(r.change) as DraftChange,
      by: JSON.parse(r.by) as Caller,
      at: r.at,
    }))
  }

  async #buildDraft(latest: Latest, entries: DraftEntry[]) {
    return this.#core.buildDraft(
      this.id,
      latest.idea,
      latest.comments,
      entries.map(({ key, change }) => ({ key, change })),
    )
  }

  /**
   * Adds a change, if it applies to the draft as it is now; otherwise it's
   * refused as outdated. Editing a block again, straight after editing it,
   * changes that edit rather than adding another.
   */
  async #draftAdd(request: WriteRequest, change: DraftChange) {
    if (change.kind === 'suggestion') {
      refuse('invalid', 'suggestions go into the draft by accepting them')
    }
    await this.#requireMeta()
    const latest = await this.#loadLatest()
    const entries = await this.#draftEntries()
    const last = entries.at(-1)
    const merge =
      change.kind === 'edit' &&
      last?.change.kind === 'edit' &&
      last.change.id === change.id &&
      last.change.source === change.was
    const key = merge ? last!.key : crypto.randomUUID().slice(0, 8)
    const next: DraftEntry[] = merge
      ? [
          ...entries.slice(0, -1),
          {
            key,
            change: {
              ...(last!.change as Extract<DraftChange, { kind: 'edit' }>),
              source: (change as { source: string }).source,
            },
          },
        ]
      : [...entries, { key, change }]
    const built = await this.#buildDraft(latest, next)
    const problem = built.problems[key]
    if (problem !== undefined) {
      refuse('conflict', `outdated: ${problem}`, { problem })
    }
    const result: WriteResult = { ok: true, value: { kind: 'draft', key } }
    const at = this.#now()
    await this.#transaction(async (tx) => {
      if (merge) {
        await tx
          .updateTable('draft')
          .set({ change: JSON.stringify(next.at(-1)!.change), at })
          .where('key', '=', key)
          .execute()
      } else {
        await tx
          .insertInto('draft')
          .values({
            key,
            seq: (last?.seq ?? 0) + 1,
            change: JSON.stringify(change),
            by: JSON.stringify(request.caller),
            at,
          })
          .execute()
      }
      await this.#remember(tx, request.key, result)
    })
    return { result, events: [{ name: 'draft', payload: { by: request.caller } }] satisfies IdeaEvent[] }
  }

  async #undraft(request: WriteRequest, key: string) {
    await this.#requireMeta()
    const found = await this.#db.selectFrom('draft').select('key').where('key', '=', key).executeTakeFirst()
    if (!found) {
      refuse('not_found', `no change ${key} in the draft`)
    }
    const result: WriteResult = { ok: true, value: { kind: 'draft', key: null } }
    await this.#transaction(async (tx) => {
      await tx.deleteFrom('draft').where('key', '=', key).execute()
      await this.#remember(tx, request.key, result)
    })
    return { result, events: [{ name: 'draft', payload: { by: request.caller } }] satisfies IdeaEvent[] }
  }

  async #discard(request: WriteRequest) {
    await this.#requireMeta()
    const result: WriteResult = { ok: true, value: { kind: 'draft', key: null } }
    await this.#transaction(async (tx) => {
      await tx.deleteFrom('draft').execute()
      await this.#remember(tx, request.key, result)
    })
    return { result, events: [{ name: 'draft', payload: { by: request.caller } }] satisfies IdeaEvent[] }
  }

  /** Suggestions into the draft, one by one; one that doesn't apply to the draft as it is stays open, saying why. */
  async #acceptIntoDraft(request: WriteRequest, candidates: Suggestion[], skipped: Skipped[]) {
    const latest = await this.#loadLatest()
    const entries = await this.#draftEntries()
    const inDraft = new Set(entries.flatMap((e) => (e.change.kind === 'suggestion' ? [e.change.comment] : [])))
    let next: DraftEntry[] = entries
    const added: Array<DraftEntry & { comment: string }> = []
    for (const s of candidates) {
      if (inDraft.has(s.id)) {
        skipped.push({ id: s.id, message: 'it’s in the draft already' })
        continue
      }
      const entry: DraftEntry = {
        key: crypto.randomUUID().slice(0, 8),
        change: { kind: 'suggestion', comment: s.id, old: s.old, new: s.new },
      }
      const built = await this.#buildDraft(latest, [...next, entry])
      const problem = built.problems[entry.key]
      if (problem !== undefined) {
        skipped.push({ id: s.id, message: problem })
        continue
      }
      next = [...next, entry]
      added.push({ ...entry, comment: s.id })
    }
    if (added.length === 0) {
      refuse(
        'conflict',
        `none of these suggestions apply to the draft: ${skipped.map((s) => `${s.id}, ${s.message}`).join('; ')}`,
        { skipped },
      )
    }
    const result: WriteResult = { ok: true, value: { kind: 'drafted', accepted: added.map((a) => a.comment), skipped } }
    const at = this.#now()
    let seq = entries.at(-1)?.seq ?? 0
    await this.#transaction(async (tx) => {
      for (const a of added) {
        await tx
          .insertInto('draft')
          .values({ key: a.key, seq: ++seq, change: JSON.stringify(a.change), by: JSON.stringify(request.caller), at })
          .execute()
      }
      await this.#remember(tx, request.key, result)
    })
    return { result, events: [{ name: 'draft', payload: { by: request.caller } }] satisfies IdeaEvent[] }
  }

  /** Commits the draft as one version. Every change must still apply: outdated ones are undone or redone first. */
  async #commit(request: WriteRequest) {
    const meta = await this.#requireMeta()
    const latest = await this.#loadLatest()
    const entries = await this.#draftEntries()
    if (entries.length === 0) {
      refuse('invalid', 'the draft is empty')
    }
    const built = await this.#buildDraft(latest, entries)
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
    const accepted = entries.flatMap((e) => (e.change.kind === 'suggestion' ? [e.change.comment] : []))
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
      /** Suggestions this version accepts. */
      decide?: { ids: string[]; decision: Decision }
      value?: { accepted: string[]; skipped: Skipped[] }
      /** Committing the draft: it's emptied with the new version. */
      clearDraft?: boolean
      /** Make the version even if changes in the draft would become outdated (confirmed by the caller). */
      outdateDraft?: boolean
    } = {},
  ) {
    const number = meta.latest + 1
    const { gitHint, decide } = more
    // suggestions accepted here leave the draft: they're in this version
    const accepted = new Set(decide?.ids ?? [])
    const drafted = more.clearDraft ? [] : await this.#draftEntries()
    const leaving = drafted.filter((e) => e.change.kind === 'suggestion' && accepted.has(e.change.comment))
    const staying = drafted.filter((e) => !leaving.includes(e))
    if (staying.length > 0 && !more.outdateDraft) {
      await this.#checkDraftKept(latest, idea, outcomes, staying)
    }
    const result: WriteResult = {
      ok: true,
      value: { kind: 'version', version: number, comments: outcomes, steps: stepResults, ...more.value },
    }
    const stored = await this.#storeContents(idea)
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
      if (more.clearDraft) {
        await tx.deleteFrom('draft').execute()
      } else if (leaving.length > 0) {
        await tx
          .deleteFrom('draft')
          .where(
            'key',
            'in',
            leaving.map((e) => e.key),
          )
          .execute()
      }
      await this.#remember(tx, request.key, result)
    })
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
      events: [
        { name: 'version', payload: { version: number, how, by: request.caller } },
        ...(decide?.ids ?? []).map((comment): IdeaEvent => ({
          name: 'decided',
          payload: { comment, decision: decide!.decision, by: request.caller },
        })),
        // a new version is what the draft is built on: editors read it again
        { name: 'draft', payload: { by: request.caller } },
      ] satisfies IdeaEvent[],
    }
  }

  /**
   * Refuses a version that would make changes in the draft outdated (changes
   * that apply now and wouldn't on it), naming them, unless the caller
   * confirms with `outdateDraft`.
   */
  async #checkDraftKept(
    latest: Latest,
    idea: Idea,
    outcomes: CommentOutcome[],
    entries: Array<DraftEntry & { by: Caller }>,
  ): Promise<void> {
    const plain = entries.map(({ key, change }) => ({ key, change }))
    const before = await this.#buildDraft(latest, plain)
    const comments = outcomes.flatMap((o) =>
      o.state !== 'outdated' && o.anchor ? [{ id: o.id, anchor: o.anchor }] : [],
    )
    const after = await this.#core.buildDraft(this.id, idea, comments, plain)
    const overtaken = entries.filter((e) => after.problems[e.key] !== undefined && before.problems[e.key] === undefined)
    if (overtaken.length === 0) {
      return
    }
    const n = overtaken.length
    refuse(
      'draft_outdated',
      `this version would make ${n === 1 ? 'a change' : `${n} changes`} in the draft outdated; confirm to make it anyway`,
      {
        changes: overtaken.map((e) => ({ key: e.key, change: e.change, by: e.by, problem: after.problems[e.key]! })),
      },
    )
  }

  // --- reads --------------------------------------------------------------------

  /** Comment threads not resolved yet, for lists. */
  async openComments(): Promise<number> {
    const row = await this.#db
      .selectFrom('comments')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('parent', 'is', null)
      .where('resolved', '=', 0)
      .executeTakeFirst()
    return Number(row?.n ?? 0)
  }

  async summary() {
    const meta = await this.#meta()
    if (!meta) {
      return null
    }
    const versions = await this.#db
      .selectFrom('versions as v')
      .select(['v.number', 'v.parent', 'v.created_at', 'v.created_by', 'v.how'])
      .select((eb) =>
        eb
          .selectFrom('steps as s')
          .select((e) => e.fn.countAll<number>().as('n'))
          .whereRef('s.version', '=', 'v.number')
          .as('steps'),
      )
      .orderBy('v.number')
      .execute()
    return {
      id: meta.id,
      title: meta.title,
      description: meta.description,
      owner: meta.owner,
      status: meta.status,
      createdAt: meta.created_at,
      latest: meta.latest,
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
  async comments(version?: number) {
    const v = await this.#versionNumber(version)
    const rows = await this.#db
      .selectFrom('comments')
      .select(['id', 'parent', 'version', 'author', 'created_at', 'body', 'resolved', 'suggestion', 'decision'])
      .where('version', '<=', v)
      .orderBy('created_at')
      .orderBy('id')
      .execute()
    const anchors = new Map(
      (
        await this.#db.selectFrom('anchors').select(['comment', 'state', 'anchor']).where('version', '=', v).execute()
      ).map((a) => [a.comment, a]),
    )
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
      (await this.#draftEntries()).flatMap((e) => (e.change.kind === 'suggestion' ? [e.change.comment] : [])),
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
    await this.#requireMeta()
    const latest = await this.#loadLatest()
    const entries = await this.#draftEntries()
    const built = await this.#buildDraft(latest, entries)
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
      comments: built.comments,
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
    return (await this.#db.selectFrom('idea').selectAll().limit(1).executeTakeFirst()) ?? null
  }

  async #requireMeta(): Promise<Meta> {
    const meta = await this.#meta()
    if (!meta) {
      refuse('not_found', "this idea doesn't exist")
    }
    return meta!
  }

  async #rootComment(id: string): Promise<string> {
    const row = await this.#db.selectFrom('comments').select(['id', 'parent']).where('id', '=', id).executeTakeFirst()
    if (!row) {
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
    return this.#db
      .selectFrom('version_files')
      .select(['file', 'path', 'hash', 'bytes', 'unit_ids'])
      .where('version', '=', version)
      .orderBy(raw`rowid`)
      .execute()
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

  async #remember(db: Kysely<IdeaDB>, key: string, result: WriteResult): Promise<void> {
    const now = this.#now()
    await db
      .insertInto('writes')
      .values({ key, result: JSON.stringify(result), at: now })
      .onConflict((oc) => oc.column('key').doUpdateSet({ result: JSON.stringify(result), at: now }))
      .execute()
    await db
      .deleteFrom('writes')
      .where('at', '<', now - KEEP_RESULTS_MS)
      .execute()
  }
}

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
