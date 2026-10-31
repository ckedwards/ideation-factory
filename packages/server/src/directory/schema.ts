// The directory's tables. Defined with Kysely's schema builder so the same
// definitions produce SQLite DDL now and Postgres DDL for the escape hatch.
// Correctness under concurrency comes from these keys and constraints, never
// from the order an actor's queue applies writes in.
import type { Kysely } from 'kysely'
import { sql as raw } from 'kysely'
import type { Sql } from '../sql/sql.ts'
import { sqliteKysely } from '../sql/kysely.ts'

export type ContainerKind = 'team' | 'group'
export type Role = 'admin' | 'maintainer' | 'member'
export type GrantKind = 'user' | 'group' | 'team' | 'everyone'

export interface DB {
  users: { id: string; handle: string; name: string; email: string | null; inactive: number; created_at: number }
  teams: {
    id: string
    handle: string
    name: string
    description: string
    created_by: string
    created_at: number
    archived: number
    /** Who can create ideas in the team: anyone, members or maintainers (and admins). */
    create_policy: string
    /** JSON: the defaults for new ideas (TeamDefaults). */
    defaults: string
  }
  groups: {
    id: string
    handle: string
    name: string
    description: string
    created_by: string
    created_at: number
    deleted_at: number | null
  }
  memberships: { kind: ContainerKind; container: string; user: string; role: Role; created_at: number }
  join_requests: { kind: ContainerKind; container: string; user: string; created_at: number }
  /** One row per idea: what lists and search show, kept up to date by the idea's actor. */
  ideas: {
    id: string
    title: string
    team: string | null
    owner: string
    status: string
    latest: number
    created_at: number
    updated_at: number
  }
  /** Access to an idea. A row gives view; can_edit and can_share add to it. `subject` is a user, group or team ID, or '*' for everyone. */
  grants: { idea: string; kind: GrantKind; subject: string; can_edit: number; can_share: number; created_at: number }
  schema_version: { version: number }
}

/**
 * Every table's columns, as the migrations create them. The types below make
 * this list name every table and column in `DB` (and nothing else), and a
 * migration test checks it against what a fresh database really has, so the
 * types the queries are written against can't drift from the schema: a column
 * added to `DB` without a migration fails one or the other.
 */
export const COLUMNS = {
  users: ['id', 'handle', 'name', 'email', 'inactive', 'created_at'],
  teams: ['id', 'handle', 'name', 'description', 'created_by', 'created_at', 'archived', 'create_policy', 'defaults'],
  groups: ['id', 'handle', 'name', 'description', 'created_by', 'created_at', 'deleted_at'],
  memberships: ['kind', 'container', 'user', 'role', 'created_at'],
  join_requests: ['kind', 'container', 'user', 'created_at'],
  ideas: ['id', 'title', 'team', 'owner', 'status', 'latest', 'created_at', 'updated_at'],
  grants: ['idea', 'kind', 'subject', 'can_edit', 'can_share', 'created_at'],
  schema_version: ['version'],
} as const satisfies { [T in keyof DB]: ReadonlyArray<keyof DB[T]> }

/** Fails to compile if a table in `DB` has a column missing from COLUMNS. */
type Missing = { [T in keyof DB]: Exclude<keyof DB[T], (typeof COLUMNS)[T][number]> }
export const columnsCoverDB: { [T in keyof DB]: never } = {} as Missing

type Migration = (db: Kysely<DB>) => Promise<void>

const MIGRATIONS: Migration[] = [
  async (db) => {
    await db.schema
      .createTable('users')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('handle', 'text', (c) => c.notNull().unique())
      .addColumn('name', 'text', (c) => c.notNull())
      .addColumn('email', 'text', (c) => c.unique())
      .addColumn('inactive', 'integer', (c) => c.notNull().defaultTo(0))
      .addColumn('created_at', 'bigint', (c) => c.notNull())
      .execute()
    for (const table of ['teams', 'groups'] as const) {
      let create = db.schema
        .createTable(table)
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('handle', 'text', (c) => c.notNull().unique())
        .addColumn('name', 'text', (c) => c.notNull())
        .addColumn('description', 'text', (c) => c.notNull())
        .addColumn('created_by', 'text', (c) => c.notNull())
        .addColumn('created_at', 'bigint', (c) => c.notNull())
      create =
        table === 'teams'
          ? create
              .addColumn('archived', 'integer', (c) => c.notNull().defaultTo(0))
              .addColumn('create_policy', 'text', (c) => c.notNull())
              .addColumn('defaults', 'text', (c) => c.notNull())
          : create.addColumn('deleted_at', 'bigint')
      await create.execute()
    }
    await db.schema
      .createTable('memberships')
      .addColumn('kind', 'text', (c) => c.notNull())
      .addColumn('container', 'text', (c) => c.notNull())
      .addColumn('user', 'text', (c) => c.notNull())
      .addColumn('role', 'text', (c) => c.notNull())
      .addColumn('created_at', 'bigint', (c) => c.notNull())
      .addPrimaryKeyConstraint('memberships_pk', ['kind', 'container', 'user'])
      .execute()
    await db.schema.createIndex('memberships_user').on('memberships').columns(['user', 'kind', 'container']).execute()
    await db.schema
      .createTable('join_requests')
      .addColumn('kind', 'text', (c) => c.notNull())
      .addColumn('container', 'text', (c) => c.notNull())
      .addColumn('user', 'text', (c) => c.notNull())
      .addColumn('created_at', 'bigint', (c) => c.notNull())
      .addPrimaryKeyConstraint('join_requests_pk', ['kind', 'container', 'user'])
      .execute()
    await db.schema
      .createTable('ideas')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('title', 'text', (c) => c.notNull())
      .addColumn('team', 'text')
      .addColumn('owner', 'text', (c) => c.notNull())
      .addColumn('status', 'text', (c) => c.notNull())
      .addColumn('latest', 'integer', (c) => c.notNull())
      .addColumn('created_at', 'bigint', (c) => c.notNull())
      .addColumn('updated_at', 'bigint', (c) => c.notNull())
      .execute()
    await db.schema.createIndex('ideas_updated').on('ideas').columns(['updated_at', 'id']).execute()
    await db.schema.createIndex('ideas_team').on('ideas').columns(['team', 'updated_at', 'id']).execute()
    await db.schema.createIndex('ideas_owner').on('ideas').columns(['owner', 'updated_at', 'id']).execute()
    await db.schema
      .createTable('grants')
      .addColumn('idea', 'text', (c) => c.notNull())
      .addColumn('kind', 'text', (c) => c.notNull())
      .addColumn('subject', 'text', (c) => c.notNull())
      .addColumn('can_edit', 'integer', (c) => c.notNull())
      .addColumn('can_share', 'integer', (c) => c.notNull())
      .addColumn('created_at', 'bigint', (c) => c.notNull())
      .addPrimaryKeyConstraint('grants_pk', ['idea', 'kind', 'subject'])
      .execute()
    await db.schema.createIndex('grants_subject').on('grants').columns(['kind', 'subject', 'idea']).execute()
  },
]

/**
 * Brings the tables up to date. Like the idea actor's, it must not open its own
 * transaction: RivetKit's onMigrate already runs it inside a savepoint.
 */
/** The directory schema's current version: the number of migrations. */
export const DIRECTORY_SCHEMA_VERSION = MIGRATIONS.length

/** `extra` adds what lives outside these tables (the search index); `to` stops at an earlier version, for migration tests. */
export async function migrateDirectory(
  sql: Sql,
  extra: Array<(sql: Sql) => Promise<void>> = [],
  to = DIRECTORY_SCHEMA_VERSION,
): Promise<void> {
  const db = sqliteKysely<DB>(sql)
  await db.schema
    .createTable('schema_version')
    .ifNotExists()
    .addColumn('version', 'integer', (c) => c.notNull())
    .execute()
  const rows = await db.selectFrom('schema_version').select('version').execute()
  if (rows.length === 0) {
    await db.insertInto('schema_version').values({ version: 0 }).execute()
  }
  for (let current = rows[0]?.version ?? 0; current < to; current++) {
    await MIGRATIONS[current]!(db)
    await db
      .updateTable('schema_version')
      .set({ version: current + 1 })
      .execute()
  }
  for (const migrate of extra) {
    await migrate(sql)
  }
}

export { raw }
