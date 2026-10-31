// An idea actor's tables. Versions hold manifests (each file's ID, path,
// content hash and unit IDs); the contents are in the file store by hash.
// Every comment has an anchor per version, so older versions show comments
// where they were then.
import type { Sql } from './sql.ts'

const MIGRATIONS: string[][] = [
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
]

/**
 * Brings the tables up to date. The caller runs it atomically: RivetKit's
 * onMigrate already wraps it in a savepoint, so it must not open a transaction
 * of its own (a nested one waits on the outer one until it times out).
 */
export async function migrate(sql: Sql): Promise<void> {
  await sql.execute('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
  const rows = await sql.execute<{ version: number }>('SELECT version FROM schema_version')
  if (rows.length === 0) {
    await sql.execute('INSERT INTO schema_version (version) VALUES (0)')
  }
  for (let current = rows[0]?.version ?? 0; current < MIGRATIONS.length; current++) {
    for (const statement of MIGRATIONS[current]!) {
      await sql.execute(statement)
    }
    await sql.execute('UPDATE schema_version SET version = ?', current + 1)
  }
}
