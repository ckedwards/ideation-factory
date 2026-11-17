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
  }
  versions: {
    number: number
    parent: number | null
    created_at: number
    created_by: string
    how: 'created' | 'commands' | 'upload'
    next_id: number
  }
  version_files: { version: number; file: string; path: string; hash: string; bytes: number; unit_ids: string }
  steps: { version: number; step: number; command: string; addresses: string }
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
  /** The idea's draft: changes on the latest version, in the order they were made, until it's committed or discarded. */
  draft: { key: string; seq: number; change: string; by: string; at: number }
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
  ],
  versions: ['number', 'parent', 'created_at', 'created_by', 'how', 'next_id'],
  version_files: ['version', 'file', 'path', 'hash', 'bytes', 'unit_ids'],
  steps: ['version', 'step', 'command', 'addresses'],
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
  draft: ['key', 'seq', 'change', 'by', 'at'],
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
      git_branch TEXT
    )`,
    `CREATE TABLE versions (
      number INTEGER PRIMARY KEY,
      parent INTEGER,
      created_at INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      how TEXT NOT NULL CHECK (how IN ('created', 'commands', 'upload')),
      next_id INTEGER NOT NULL
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
    `CREATE TABLE draft (
      key TEXT PRIMARY KEY,
      seq INTEGER NOT NULL UNIQUE,
      change TEXT NOT NULL,
      by TEXT NOT NULL,
      at INTEGER NOT NULL
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
