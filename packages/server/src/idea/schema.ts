// An idea actor's tables. Versions hold manifests (each file's ID, path,
// content hash and unit IDs); the contents are in the file store by hash.
// Every comment has an anchor per version, so older versions show comments
// where they were then.
import type { Generated, Kysely } from 'kysely'
import { sqliteKysely } from '../sql/kysely.ts'
import type { Sql } from '../sql/sql.ts'

export const IDEA_STATUSES = [
  'draft',
  'requesting-review',
  'changes-in-progress',
  'closed-accepted',
  'closed-rejected',
] as const
export type IdeaStatus = (typeof IDEA_STATUSES)[number]
export const VERDICTS = ['approve', 'request-changes', 'reject'] as const
export type Verdict = (typeof VERDICTS)[number]
export const RESTORE_WHYS = ['quiet', 'left', 'agent', 'discard', 'overwrite', 'restore'] as const
/**
 * Why a restore point was taken: the draft went quiet, someone who changed it left it, or before an
 * agent changed it, or someone discarded, overwrote or restored it.
 */
export type RestoreWhy = (typeof RESTORE_WHYS)[number]

/** The idea actor's tables, as Kysely types: what its queries are written against. */
export interface IdeaDB {
  idea: {
    id: string
    title: string
    description: string
    owner: string
    /** Open (draft, requesting-review, changes-in-progress) or closed (closed-accepted, closed-rejected). */
    status: IdeaStatus
    created_at: number
    latest: number
    next_comment: number
    /** A hint at where it is in git: the repository as host/path, and the branch last synced from. */
    git_uri: string | null
    git_branch: string | null
    /** When the draft last changed (null: never): a restore point is taken once it's been quiet. */
    draft_at: number | null
    /** How many times the draft has changed: a restore point taken at the same count has it as it is. */
    draft_change: number
    /** Who changed the draft last, as a Caller in JSON (null: nobody yet). */
    draft_by: string | null
  }
  versions: {
    number: number
    parent: number | null
    created_at: number
    created_by: string
    how: 'created' | 'commands' | 'upload'
    next_id: number
    /** Who made what's in it, as Callers in JSON: who typed in a committed draft's blocks, else its maker */
    authors: string
  }
  version_files: { version: number; file: string; path: string; hash: string; bytes: number; unit_ids: string }
  /** A version's commands, each with who made it (`authors`, Callers in JSON): who typed in its blocks, for a committed draft */
  steps: { version: number; step: number; command: string; addresses: string; authors: string }
  comments: {
    id: string
    parent: string | null
    version: number
    author: string
    created_at: number
    body: string
    resolved: number
    /** A suggested edit's change, as JSON ({ old, new }: the source it replaces and the replacement); null for a plain comment. */
    suggestion: string | null
    /** Whether a suggestion was accepted or rejected, as JSON ({ kind, by, at, version }); null while it's open. */
    decision: string | null
    /** Part of a review not submitted yet: the reviewer's account (only they see it); null once published. */
    pending: string | null
  }
  anchors: {
    comment: string
    version: number
    state: 'exact' | 'moved' | 'changed' | 'outdated'
    anchor: string | null
  }
  /** Every change of status, in order: its first is the status it was created with. */
  status_changes: { seq: Generated<number>; status: IdeaStatus; by: string; at: number; note: string }
  /**
   * Verdicts, in the order they were given. A reviewer (an account: a person,
   * or a bot) stands by their latest; `dismissed` ({ by, at, reason }, as
   * JSON) is set when someone with edit access dismisses an objection.
   */
  reviews: {
    seq: Generated<number>
    reviewer: string
    by: string
    verdict: Verdict
    version: number
    body: string
    at: number
    dismissed: string | null
  }
  /**
   * The latest version each person has opened the document of (in the web
   * app, or with the cli's show or pull), for reviewers' "seen v3". People
   * only: what their bots read isn't what they've seen.
   */
  seen: { user: string; version: number; at: number }
  /**
   * The idea's draft, a live document for each file it has changed or someone has opened (the page
   * editor's, model.ts): a snapshot of it after `steps` steps, as its Markdown and its blocks' IDs
   * (`source`, `ids`) and the editor's document (`doc`). The steps after it are in draft_steps. A file
   * nobody has opened or changed has no row: it's the latest version's.
   */
  draft_files: { file: string; steps: number; doc: string; source: string; ids: string; at: number }
  /**
   * Each file's steps, in the order they were taken: who took them, and the editor that sent them
   * (`client`, so it knows its own when it catches up; `server` for the server's own). The snapshot's
   * and the recent ones are kept, for catching up.
   */
  draft_steps: { file: string; seq: number; step: string; by: string; client: string; at: number }
  /** Suggestions accepted into the draft, resolved when it's committed: each one's change. */
  draft_suggestions: { comment: string; change: string; by: string; at: number }
  /** Changes a version made around the draft has outdated: kept, to be undone or redone, until then. */
  draft_held: { key: string; change: string; by: string; at: number }
  /** Who changed each of the draft's blocks (by its ID), and when they last did. */
  draft_authors: { block: string; by: string; at: number }
  /**
   * Words an editor saw cut from one block and pasted into another (core's MovedWords), in the order
   * they were: the draft's changes count them as moves while the documents still read that way, so
   * their comments go with them. Emptied when the draft is committed or discarded.
   */
  draft_moved: { seq: Generated<number>; words: string; by: string; at: number }
  /**
   * The draft as it was, kept on purpose so a bad edit or a discard can be taken back
   * (docs/architecture.md, Restore points): taken once it's been quiet, when someone who changed it
   * leaves it, and before an agent changes it or someone discards, overwrites or restores it.
   * `version` is the latest version then; `change` the idea's draft_change it has the draft at; `by`
   * who left, or whose write it was taken before (null when it went quiet). Its label is worked out
   * once, when it's taken: how many changes it has, and against the one before, who changed what
   * (`who`, Callers in JSON; `first`, the first change new since, a DraftChange in JSON cut short,
   * with `more` new after it; `undone`, how many of the one before's it no longer has). `draft` is its
   * changes, who changed each block and the words seen moved, as JSON, of `bytes`; null once it's
   * dropped to make room (limits.draft.restoreKeepMb), when only its label is left.
   */
  draft_restore_points: {
    seq: Generated<number>
    version: number
    why: RestoreWhy
    by: string | null
    at: number
    change: number
    changes: number
    who: string
    first: string | null
    more: number
    undone: number
    bytes: number
    draft: string | null
  }
  writes: { key: string; result: string; at: number }
  /**
   * What a write tells the directory (its inbox events, as a NotifyBatch's),
   * written in the write's own transaction and kept until the directory says
   * it has applied them: the ID makes a resend harmless. attempts and next_at
   * space out retries while the directory can't take them.
   */
  outbox: { id: string; events: string; at: number; attempts: number; next_at: number }
  schema_version: { version: number }
}

/** Every table's columns, as the migrations create them; checked against IdeaDB by type and against a fresh database by a test. */
export const IDEA_COLUMNS = {
  idea: [
    'id',
    'title',
    'description',
    'owner',
    'status',
    'created_at',
    'latest',
    'next_comment',
    'git_uri',
    'git_branch',
    'draft_at',
    'draft_change',
    'draft_by',
  ],
  versions: ['number', 'parent', 'created_at', 'created_by', 'how', 'next_id', 'authors'],
  version_files: ['version', 'file', 'path', 'hash', 'bytes', 'unit_ids'],
  steps: ['version', 'step', 'command', 'addresses', 'authors'],
  comments: [
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
  ],
  anchors: ['comment', 'version', 'state', 'anchor'],
  status_changes: ['seq', 'status', 'by', 'at', 'note'],
  reviews: ['seq', 'reviewer', 'by', 'verdict', 'version', 'body', 'at', 'dismissed'],
  seen: ['user', 'version', 'at'],
  draft_files: ['file', 'steps', 'doc', 'source', 'ids', 'at'],
  draft_steps: ['file', 'seq', 'step', 'by', 'client', 'at'],
  draft_suggestions: ['comment', 'change', 'by', 'at'],
  draft_held: ['key', 'change', 'by', 'at'],
  draft_authors: ['block', 'by', 'at'],
  draft_moved: ['seq', 'words', 'by', 'at'],
  draft_restore_points: [
    'seq',
    'version',
    'why',
    'by',
    'at',
    'change',
    'changes',
    'who',
    'first',
    'more',
    'undone',
    'bytes',
    'draft',
  ],
  writes: ['key', 'result', 'at'],
  outbox: ['id', 'events', 'at', 'attempts', 'next_at'],
  schema_version: ['version'],
} as const satisfies { [T in keyof IdeaDB]: ReadonlyArray<keyof IdeaDB[T]> }

/** Fails to compile if a table in IdeaDB has a column missing from IDEA_COLUMNS. */
type Missing = { [T in keyof IdeaDB]: Exclude<keyof IdeaDB[T], (typeof IDEA_COLUMNS)[T][number]> }
export const ideaColumnsCoverDB: { [T in keyof IdeaDB]: never } = {} as Missing

/**
 * During the alpha there's only v1, changed in place, with no migrations (see
 * AGENTS.md). Once something ships, v1 is frozen and later migrations are
 * appended, written with Kysely's schema builder.
 */
type Migration = string[] | ((db: Kysely<IdeaDB>) => Promise<void>)

const MIGRATIONS: Migration[] = [
  [
    `CREATE TABLE idea (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      owner TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft', 'requesting-review', 'changes-in-progress', 'closed-accepted', 'closed-rejected')),
      created_at INTEGER NOT NULL,
      latest INTEGER NOT NULL,
      next_comment INTEGER NOT NULL,
      git_uri TEXT,
      git_branch TEXT,
      draft_at INTEGER,
      draft_change INTEGER NOT NULL DEFAULT 0,
      draft_by TEXT
    )`,
    `CREATE TABLE versions (
      number INTEGER PRIMARY KEY,
      parent INTEGER,
      created_at INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      how TEXT NOT NULL CHECK (how IN ('created', 'commands', 'upload')),
      next_id INTEGER NOT NULL,
      authors TEXT NOT NULL
    )`,
    `CREATE TABLE version_files (
      version INTEGER NOT NULL REFERENCES versions (number),
      file TEXT NOT NULL,
      path TEXT NOT NULL,
      hash TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      unit_ids TEXT NOT NULL,
      PRIMARY KEY (version, file)
    )`,
    `CREATE TABLE steps (
      version INTEGER NOT NULL REFERENCES versions (number),
      step INTEGER NOT NULL,
      command TEXT NOT NULL,
      addresses TEXT NOT NULL,
      authors TEXT NOT NULL,
      PRIMARY KEY (version, step)
    )`,
    `CREATE TABLE comments (
      id TEXT PRIMARY KEY,
      parent TEXT REFERENCES comments (id),
      version INTEGER NOT NULL,
      author TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      body TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      suggestion TEXT,
      decision TEXT,
      pending TEXT
    )`,
    `CREATE INDEX comments_parent ON comments (parent)`,
    `CREATE TABLE anchors (
      comment TEXT NOT NULL REFERENCES comments (id),
      version INTEGER NOT NULL REFERENCES versions (number),
      state TEXT NOT NULL CHECK (state IN ('exact', 'moved', 'changed', 'outdated')),
      anchor TEXT,
      PRIMARY KEY (comment, version)
    )`,
    `CREATE INDEX anchors_version ON anchors (version)`,
    `CREATE TABLE status_changes (
      seq INTEGER PRIMARY KEY,
      status TEXT NOT NULL,
      by TEXT NOT NULL,
      at INTEGER NOT NULL,
      note TEXT NOT NULL
    )`,
    `CREATE TABLE reviews (
      seq INTEGER PRIMARY KEY,
      reviewer TEXT NOT NULL,
      by TEXT NOT NULL,
      verdict TEXT NOT NULL CHECK (verdict IN ('approve', 'request-changes', 'reject')),
      version INTEGER NOT NULL REFERENCES versions (number),
      body TEXT NOT NULL,
      at INTEGER NOT NULL,
      dismissed TEXT
    )`,
    `CREATE INDEX reviews_reviewer ON reviews (reviewer, seq)`,
    `CREATE TABLE seen (
      user TEXT PRIMARY KEY,
      version INTEGER NOT NULL REFERENCES versions (number),
      at INTEGER NOT NULL
    )`,
    `CREATE TABLE draft_files (
      file TEXT PRIMARY KEY,
      steps INTEGER NOT NULL,
      doc TEXT NOT NULL,
      source TEXT NOT NULL,
      ids TEXT NOT NULL,
      at INTEGER NOT NULL
    )`,
    `CREATE TABLE draft_steps (
      file TEXT NOT NULL,
      seq INTEGER NOT NULL,
      step TEXT NOT NULL,
      by TEXT NOT NULL,
      client TEXT NOT NULL,
      at INTEGER NOT NULL,
      PRIMARY KEY (file, seq)
    )`,
    `CREATE TABLE draft_suggestions (comment TEXT PRIMARY KEY, change TEXT NOT NULL, by TEXT NOT NULL, at INTEGER NOT NULL)`,
    `CREATE TABLE draft_held (key TEXT PRIMARY KEY, change TEXT NOT NULL, by TEXT NOT NULL, at INTEGER NOT NULL)`,
    `CREATE TABLE draft_authors (block TEXT NOT NULL, by TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (block, by))`,
    `CREATE TABLE draft_moved (seq INTEGER PRIMARY KEY, words TEXT NOT NULL, by TEXT NOT NULL, at INTEGER NOT NULL)`,
    `CREATE TABLE draft_restore_points (
      seq INTEGER PRIMARY KEY,
      version INTEGER NOT NULL,
      why TEXT NOT NULL CHECK (why IN ('quiet', 'left', 'agent', 'discard', 'overwrite', 'restore')),
      by TEXT,
      at INTEGER NOT NULL,
      change INTEGER NOT NULL,
      changes INTEGER NOT NULL,
      who TEXT NOT NULL,
      first TEXT,
      more INTEGER NOT NULL,
      undone INTEGER NOT NULL,
      bytes INTEGER NOT NULL,
      draft TEXT
    )`,
    // results of recent writes by idempotency key, so a retried write isn't applied twice
    `CREATE TABLE writes (key TEXT PRIMARY KEY, result TEXT NOT NULL, at INTEGER NOT NULL)`,
    `CREATE INDEX writes_at ON writes (at)`,
    // what writes tell the directory, until it has them
    `CREATE TABLE outbox (id TEXT PRIMARY KEY, events TEXT NOT NULL, at INTEGER NOT NULL, attempts INTEGER NOT NULL, next_at INTEGER NOT NULL)`,
  ],
]

/** The idea schema's current version: the number of migrations. */
export const IDEA_SCHEMA_VERSION = MIGRATIONS.length

/**
 * Brings the tables up to date. The caller runs it atomically: RivetKit's
 * onMigrate already wraps it in a savepoint, so it must not open a transaction
 * of its own (a nested one waits on the outer one until it times out). `to`
 * stops at an earlier version, for migration tests.
 */
export async function migrate(sql: Sql, to = IDEA_SCHEMA_VERSION): Promise<void> {
  await sql.execute('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
  const rows = await sql.execute<{ version: number }>('SELECT version FROM schema_version')
  if (rows.length === 0) {
    await sql.execute('INSERT INTO schema_version (version) VALUES (0)')
  }
  for (let current = rows[0]?.version ?? 0; current < to; current++) {
    const migration = MIGRATIONS[current]!
    if (Array.isArray(migration)) {
      for (const statement of migration) {
        await sql.execute(statement)
      }
    } else {
      await migration(sqliteKysely<IdeaDB>(sql))
    }
    await sql.execute('UPDATE schema_version SET version = ?', current + 1)
  }
}
