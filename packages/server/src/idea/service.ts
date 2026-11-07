// The logic of one idea, with no Rivet in it: the idea actor is a thin shell
// that feeds this its queued writes (one at a time, in order) and its reads.
//
// Storage: the idea's SQLite holds versions (manifests), steps, comments and an
// anchor per comment per version; file contents go to the file store by hash.
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
  z.strictObject({ type: z.literal('reply'), parent: z.string(), body: z.string().trim().min(1).max(20_000) }),
  z.strictObject({ type: z.literal('resolve'), comment: z.string(), resolved: z.boolean() }),
  z.strictObject({ type: z.literal('edit'), batch: Batch }),
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
export type WriteError = { code: WriteErrorCode; message: string; details?: unknown }

export type WriteValue =
  | { kind: 'created'; version: number }
  | { kind: 'comment'; comment: string }
  | { kind: 'resolved'; comment: string; resolved: boolean }
  | { kind: 'version'; version: number; comments: CommentOutcome[]; steps: StepResult[] }

export type WriteResult = { ok: true; value: WriteValue } | { ok: false; error: WriteError }

/** A comment as list_comments shows it: its thread, or one reply. */
export type CommentShape = { id: string; author: Caller; createdAt: number; body: string; version: number }
export type ThreadShape = CommentShape & {
  resolved: boolean
  state: AnchorState
  anchor: Anchor | null
  lastVersion: number | null
  addressedIn: number[]
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
          return await this.#comment(request, write)
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

  async #comment(request: WriteRequest, write: Extract<IdeaWrite, { type: 'comment' }>) {
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
    const id = `c${meta.next_comment}`
    const at = this.#now()
    const result: WriteResult = { ok: true, value: { kind: 'comment', comment: id } }
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
    return this.#newVersion(request, meta, latest, 'commands', ok.idea, ok.comments, steps, ok.steps)
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
    return this.#newVersion(request, meta, latest, 'upload', ok.idea, ok.comments, [], [], write.gitHint)
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
    gitHint?: { uri: string | null; branch: string },
  ) {
    const number = meta.latest + 1
    const result: WriteResult = {
      ok: true,
      value: { kind: 'version', version: number, comments: outcomes, steps: stepResults },
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
      events: [{ name: 'version', payload: { version: number, how, by: request.caller } }] satisfies IdeaEvent[],
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
      .select(['id', 'parent', 'version', 'author', 'created_at', 'body', 'resolved'])
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
          replies: (replies.get(r.id) ?? []).map(shape),
        }
      })
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

function kb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`
}
