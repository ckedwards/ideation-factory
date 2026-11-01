// An idea actor's tables. Versions hold manifests (each file's ID, path,
// content hash and unit IDs); the contents are in the file store by hash.
// Every comment has an anchor per version, so older versions show comments
// where they were then.
import type { Kysely } from 'kysely'
import { sqliteKysely } from '../sql/kysely.ts'
import type { Sql } from '../sql/sql.ts'

/** The idea actor's tables, as Kysely types: what its queries are written against. */
export interface IdeaDB {
  idea: {
    id: string
    title: string
    description: string
    owner: string
    status: string
    created_at: number
    latest: number
    next_comment: number
    /** A hint at where it is in git (v2): the repository as host/path, and the branch last synced from. */
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
  }
  anchors: {
    comment: string
    version: number
    state: 'exact' | 'moved' | 'changed' | 'outdated'
    anchor: string | null
  }
  writes: { key: string; result: string; at: number }
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
  comments: ['id', 'parent', 'version', 'author', 'created_at', 'body', 'resolved'],
  anchors: ['comment', 'version', 'state', 'anchor'],
  writes: ['key', 'result', 'at'],
  schema_version: ['version'],
} as const satisfies { [T in keyof IdeaDB]: ReadonlyArray<keyof IdeaDB[T]> }

/** Fails to compile if a table in IdeaDB has a column missing from IDEA_COLUMNS. */
type Missing = { [T in keyof IdeaDB]: Exclude<keyof IdeaDB[T], (typeof IDEA_COLUMNS)[T][number]> }
export const ideaColumnsCoverDB: { [T in keyof IdeaDB]: never } = {} as Missing

/** v1 shipped as raw SQL and stays exactly as it was; later migrations use Kysely's schema builder. */
type Migration = string[] | ((db: Kysely<IdeaDB>) => Promise<void>)

const MIGRATIONS: Migration[] = [
  [
    `CREATE TABLE idea (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      owner TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      latest INTEGER NOT NULL,
      next_comment INTEGER NOT NULL
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
      resolved INTEGER NOT NULL DEFAULT 0
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
    // results of recent writes by idempotency key, so a retried write isn't applied twice
    `CREATE TABLE writes (key TEXT PRIMARY KEY, result TEXT NOT NULL, at INTEGER NOT NULL)`,
    `CREATE INDEX writes_at ON writes (at)`,
  ],
  // v2: a hint at where the idea is in git, so another machine can find its branch
  async (db) => {
    await db.schema.alterTable('idea').addColumn('git_uri', 'text').execute()
    await db.schema.alterTable('idea').addColumn('git_branch', 'text').execute()
  },
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
