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
export type TokenTargetKind = 'team' | 'idea' | 'no_team'

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
    /** JSON: what an idea in the team needs before it can be closed as accepted (TeamRequirements). */
    requirements: string
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
  /**
   * Groups in teams (architecture.md, Groups in teams): the group's members are the team's members,
   * each at the lower of the group's role here and their own role in the group. Never admin.
   */
  team_groups: { team: string; group: string; role: Role; added_by: string; created_at: number }
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
    /** Where it's numbered: its team's ID, or u:<owner> for someone's own idea. */
    place: string
    /** Its number in its place (mobile/idea/9), like a pull request's in its repository. */
    number: number
    /** What lists show under its title. */
    description: string
    /** Comment threads not resolved yet. */
    open_comments: number
  }
  /** Each place's next idea number. */
  numbering: { place: string; next: number }
  /** An idea's earlier place and number, from before it moved, so its old address still leads to it. */
  idea_aliases: { place: string; number: number; idea: string }
  /**
   * A person's or a team's earlier handle, so its old addresses still lead to
   * it, until someone else takes the handle (or a site admin releases it).
   */
  handle_aliases: { kind: 'user' | 'team'; handle: string; owner: string; created_at: number }
  /**
   * Access to an idea. A row gives view; can_edit and can_share add to it.
   * `subject` is a user, group or team ID, or '*' for everyone. `reviewer`: a
   * person or group asked to review it (asking gives view access, and
   * removing the access takes them off the reviewers).
   */
  grants: {
    idea: string
    kind: GrantKind
    subject: string
    can_edit: number
    can_share: number
    reviewer: number
    created_at: number
  }
  /**
   * What a token was made to do, chosen when it was approved: its purpose (and
   * bot name), and limits that can only narrow what its owner can do. Not to
   * be confused with `grants`, which are who an idea is shared with.
   */
  token_grants: {
    id: string
    user: string
    purpose: string
    bot: string | null
    /** 1: no writes at all (comments included). */
    read_only: number
    /** 1: only the ideas its targets name, and no sharing, moving or team management. */
    limited: number
    created_at: number
    revoked_at: number | null
  }
  /** A limited token's reach: a team's ideas, one idea, or ideas outside any team (target ''). */
  token_grant_targets: { token_grant: string; kind: TokenTargetKind; target: string }
  /**
   * Something that happened to an idea, as inboxes show it: `actor` and
   * `detail` are JSON. `by_user`: the person, when they did it themselves (so
   * a watcher's inbox leaves out their own events).
   */
  inbox_events: {
    id: string
    idea: string
    kind: string
    actor: string
    by_user: string | null
    at: number
    detail: string
  }
  /**
   * One row per person per idea they hear about: the latest event, how many
   * are new since they last read it, why they hear about it, and whether
   * it's done (cleared until something new happens).
   */
  inbox: {
    user: string
    idea: string
    reason: string
    event: string
    new_count: number
    done: number
    updated_at: number
  }
  /** Following an idea: participating (took part), subscribed (chose to), or unsubscribed (chose not to). */
  subscriptions: { user: string; idea: string; state: string; at: number }
  /** How much of a team someone hears about, beyond what they're involved in: active ideas, or all of them. No row: participating. */
  watches: { user: string; team: string; level: string; at: number }
  /**
   * A watcher's marks on an idea they hear about only through a team: when
   * they last read it, and when they marked it done (null when not). Its
   * news is worked out from the team's events when the inbox is read.
   */
  watch_marks: { user: string; idea: string; read_at: number; done_at: number | null }
  /**
   * What a person wants to hear about; no row means the defaults. Email:
   * involved (everything the inbox has for ideas they're involved in),
   * review-requests (only being asked to review) or off; email_watching adds
   * watched teams' ideas; cadence is bundled (an email per idea once it goes
   * quiet) or daily (one digest), and digest_at when the last digest went.
   */
  notification_settings: {
    user: string
    own_bots: number
    email: string
    email_watching: number
    cadence: string
    digest_at: number | null
  }
  /**
   * Updates waiting to be emailed: one row per person per event, kept until
   * the email goes, or until they read the idea first. queued_at is the
   * directory's clock (the event's own time is the idea actor's).
   */
  email_pending: { user: string; idea: string; event: string; reason: string; queued_at: number }
  /**
   * One row per person and idea with email pending: when the first and last
   * were queued, and whether the person takes a daily digest. Kept with
   * email_pending, so when an email is due is found through indexes, never by
   * reading the whole queue (which once held the directory 31 s at a time).
   */
  email_queue: { user: string; idea: string; first: number; last: number; daily: number }
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
  teams: [
    'id',
    'handle',
    'name',
    'description',
    'created_by',
    'created_at',
    'archived',
    'create_policy',
    'defaults',
    'requirements',
  ],
  groups: ['id', 'handle', 'name', 'description', 'created_by', 'created_at', 'deleted_at'],
  memberships: ['kind', 'container', 'user', 'role', 'created_at'],
  team_groups: ['team', 'group', 'role', 'added_by', 'created_at'],
  join_requests: ['kind', 'container', 'user', 'created_at'],
  ideas: [
    'id',
    'title',
    'team',
    'owner',
    'status',
    'latest',
    'created_at',
    'updated_at',
    'place',
    'number',
    'description',
    'open_comments',
  ],
  numbering: ['place', 'next'],
  idea_aliases: ['place', 'number', 'idea'],
  handle_aliases: ['kind', 'handle', 'owner', 'created_at'],
  grants: ['idea', 'kind', 'subject', 'can_edit', 'can_share', 'reviewer', 'created_at'],
  token_grants: ['id', 'user', 'purpose', 'bot', 'read_only', 'limited', 'created_at', 'revoked_at'],
  token_grant_targets: ['token_grant', 'kind', 'target'],
  inbox_events: ['id', 'idea', 'kind', 'actor', 'by_user', 'at', 'detail'],
  inbox: ['user', 'idea', 'reason', 'event', 'new_count', 'done', 'updated_at'],
  subscriptions: ['user', 'idea', 'state', 'at'],
  watches: ['user', 'team', 'level', 'at'],
  watch_marks: ['user', 'idea', 'read_at', 'done_at'],
  notification_settings: ['user', 'own_bots', 'email', 'email_watching', 'cadence', 'digest_at'],
  email_pending: ['user', 'idea', 'event', 'reason', 'queued_at'],
  email_queue: ['user', 'idea', 'first', 'last', 'daily'],
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
              .addColumn('requirements', 'text', (c) => c.notNull())
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
      .createTable('team_groups')
      .addColumn('team', 'text', (c) => c.notNull())
      .addColumn('group', 'text', (c) => c.notNull())
      .addColumn('role', 'text', (c) => c.notNull())
      .addColumn('added_by', 'text', (c) => c.notNull())
      .addColumn('created_at', 'bigint', (c) => c.notNull())
      .addPrimaryKeyConstraint('team_groups_pk', ['team', 'group'])
      .execute()
    // the teams a person's groups are in: from the group
    await db.schema.createIndex('team_groups_group').on('team_groups').columns(['group', 'team']).execute()
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
      .addColumn('place', 'text', (c) => c.notNull())
      .addColumn('number', 'integer', (c) => c.notNull())
      .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
      .addColumn('open_comments', 'integer', (c) => c.notNull().defaultTo(0))
      .execute()
    await db.schema.createIndex('ideas_place').on('ideas').columns(['place', 'number']).unique().execute()
    await db.schema
      .createTable('numbering')
      .addColumn('place', 'text', (c) => c.primaryKey())
      .addColumn('next', 'integer', (c) => c.notNull())
      .execute()
    await db.schema
      .createTable('idea_aliases')
      .addColumn('place', 'text', (c) => c.notNull())
      .addColumn('number', 'integer', (c) => c.notNull())
      .addColumn('idea', 'text', (c) => c.notNull())
      .addPrimaryKeyConstraint('idea_aliases_pk', ['place', 'number'])
      .execute()
    await db.schema
      .createTable('handle_aliases')
      .addColumn('kind', 'text', (c) => c.notNull())
      .addColumn('handle', 'text', (c) => c.notNull())
      .addColumn('owner', 'text', (c) => c.notNull())
      .addColumn('created_at', 'bigint', (c) => c.notNull())
      .addPrimaryKeyConstraint('handle_aliases_pk', ['kind', 'handle'])
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
      .addColumn('reviewer', 'integer', (c) => c.notNull().defaultTo(0))
      .addColumn('created_at', 'bigint', (c) => c.notNull())
      .addPrimaryKeyConstraint('grants_pk', ['idea', 'kind', 'subject'])
      .execute()
    await db.schema.createIndex('grants_subject').on('grants').columns(['kind', 'subject', 'idea']).execute()
    await db.schema
      .createTable('token_grants')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('user', 'text', (c) => c.notNull())
      .addColumn('purpose', 'text', (c) => c.notNull())
      .addColumn('bot', 'text')
      .addColumn('read_only', 'integer', (c) => c.notNull())
      .addColumn('limited', 'integer', (c) => c.notNull())
      .addColumn('created_at', 'bigint', (c) => c.notNull())
      .addColumn('revoked_at', 'bigint')
      .execute()
    await db.schema.createIndex('token_grants_user').on('token_grants').columns(['user', 'created_at']).execute()
    await db.schema
      .createTable('token_grant_targets')
      .addColumn('token_grant', 'text', (c) => c.notNull())
      .addColumn('kind', 'text', (c) => c.notNull())
      .addColumn('target', 'text', (c) => c.notNull())
      .addPrimaryKeyConstraint('token_grant_targets_pk', ['token_grant', 'kind', 'target'])
      .execute()
    await db.schema
      .createTable('inbox_events')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('idea', 'text', (c) => c.notNull())
      .addColumn('kind', 'text', (c) => c.notNull())
      .addColumn('actor', 'text', (c) => c.notNull())
      .addColumn('by_user', 'text')
      .addColumn('at', 'bigint', (c) => c.notNull())
      .addColumn('detail', 'text', (c) => c.notNull())
      .execute()
    await db.schema.createIndex('inbox_events_idea').on('inbox_events').columns(['idea', 'at']).execute()
    await db.schema
      .createTable('inbox')
      .addColumn('user', 'text', (c) => c.notNull())
      .addColumn('idea', 'text', (c) => c.notNull())
      .addColumn('reason', 'text', (c) => c.notNull())
      .addColumn('event', 'text', (c) => c.notNull())
      .addColumn('new_count', 'integer', (c) => c.notNull())
      .addColumn('done', 'integer', (c) => c.notNull())
      .addColumn('updated_at', 'bigint', (c) => c.notNull())
      .addPrimaryKeyConstraint('inbox_pk', ['user', 'idea'])
      .execute()
    await db.schema.createIndex('inbox_user').on('inbox').columns(['user', 'done', 'updated_at', 'idea']).execute()
    await db.schema
      .createTable('subscriptions')
      .addColumn('user', 'text', (c) => c.notNull())
      .addColumn('idea', 'text', (c) => c.notNull())
      .addColumn('state', 'text', (c) => c.notNull())
      .addColumn('at', 'bigint', (c) => c.notNull())
      .addPrimaryKeyConstraint('subscriptions_pk', ['user', 'idea'])
      .execute()
    await db.schema.createIndex('subscriptions_idea').on('subscriptions').columns(['idea', 'state']).execute()
    await db.schema
      .createTable('watches')
      .addColumn('user', 'text', (c) => c.notNull())
      .addColumn('team', 'text', (c) => c.notNull())
      .addColumn('level', 'text', (c) => c.notNull())
      .addColumn('at', 'bigint', (c) => c.notNull())
      .addPrimaryKeyConstraint('watches_pk', ['user', 'team'])
      .execute()
    await db.schema
      .createTable('watch_marks')
      .addColumn('user', 'text', (c) => c.notNull())
      .addColumn('idea', 'text', (c) => c.notNull())
      .addColumn('read_at', 'bigint', (c) => c.notNull())
      .addColumn('done_at', 'bigint')
      .addPrimaryKeyConstraint('watch_marks_pk', ['user', 'idea'])
      .execute()
    await db.schema
      .createTable('notification_settings')
      .addColumn('user', 'text', (c) => c.primaryKey())
      .addColumn('own_bots', 'integer', (c) => c.notNull())
      .addColumn('email', 'text', (c) => c.notNull())
      .addColumn('email_watching', 'integer', (c) => c.notNull())
      .addColumn('cadence', 'text', (c) => c.notNull())
      .addColumn('digest_at', 'bigint')
      .execute()
    await db.schema
      .createTable('email_pending')
      .addColumn('user', 'text', (c) => c.notNull())
      .addColumn('idea', 'text', (c) => c.notNull())
      .addColumn('event', 'text', (c) => c.notNull())
      .addColumn('reason', 'text', (c) => c.notNull())
      .addColumn('queued_at', 'bigint', (c) => c.notNull())
      .addPrimaryKeyConstraint('email_pending_pk', ['user', 'event'])
      .execute()
    await db.schema.createIndex('email_pending_user').on('email_pending').columns(['user', 'idea']).execute()
    await db.schema
      .createTable('email_queue')
      .addColumn('user', 'text', (c) => c.notNull())
      .addColumn('idea', 'text', (c) => c.notNull())
      .addColumn('first', 'bigint', (c) => c.notNull())
      .addColumn('last', 'bigint', (c) => c.notNull())
      .addColumn('daily', 'integer', (c) => c.notNull())
      .addPrimaryKeyConstraint('email_queue_pk', ['user', 'idea'])
      .execute()
    await db.schema.createIndex('email_queue_last').on('email_queue').columns(['daily', 'last']).execute()
    await db.schema.createIndex('email_queue_first').on('email_queue').columns(['daily', 'first']).execute()
  },
]

/**
 * Brings the tables up to date. Like the idea actor's, it must not open its own
 * transaction: RivetKit's onMigrate already runs it inside a savepoint.
 */
/** The directory schema's current version: the number of migrations. */
export const DIRECTORY_SCHEMA_VERSION = MIGRATIONS.length

/** `to` stops at an earlier version, for migration tests. The search index has a database of its own (search.ts). */
export async function migrateDirectory(sql: Sql, to = DIRECTORY_SCHEMA_VERSION): Promise<void> {
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
}

export { raw }
