// The directory on SQL, through Kysely: what the directory actor runs, and
// what a Postgres implementation would mostly share. Writes are correct when
// they run concurrently: unique keys, upserts and transactions, never the order
// a queue applies them in.
import { type Expression, type ExpressionBuilder, type Kysely, type SqlBool, sql as raw } from 'kysely'
import type { Sql } from '../sql/sql.ts'
import { sqliteKysely } from '../sql/kysely.ts'
import type { ContainerKind, DB, Role } from './schema.ts'
import { type IdeaSearch, SEARCH_WORK_CAP, searchTerms } from './search.ts'
import {
  type Container,
  type CreatePolicy,
  DEFAULT_TEAM_DEFAULTS,
  type Directory,
  type Grant,
  type GrantSubject,
  type Group,
  type GroupRule,
  type AccessChange,
  type ActorRef,
  INBOX_REASONS,
  type InboxEvent,
  type InboxFilter,
  type InboxReason,
  type InboxRow,
  type NotifyBatch,
  type IdeaFilter,
  type IdeaPlace,
  type IdeaAccess,
  type IdeaListing,
  type Memberships,
  type IdeaRow,
  type IndexUpdate,
  HANDLE_PARKED_MS,
  type Member,
  type MoveAdjustments,
  type MovePreview,
  type Page,
  NO_REQUIREMENTS,
  type Permission,
  type RequirementCheck,
  type RequirementsCheck,
  type Result,
  type SearchResult,
  type Team,
  type TeamDefaults,
  type TeamRequirements,
  type TokenGrant,
  type TokenGrantInput,
  type User,
} from './types.ts'

const HANDLE = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/
/**
 * Handles a team or group can't have: a team's ideas are at /<team>/idea/9,
 * so these stay the app's own paths, now or soon.
 */
const RESERVED = new Set([
  'admin',
  'api',
  'assets',
  'cli',
  'consent',
  'groups',
  'health',
  'home',
  'idea',
  'ideas',
  'inbox',
  'login',
  'logout',
  'me',
  'new',
  'node_modules',
  'notifications',
  'people',
  'search',
  'settings',
  'src',
  'teams',
])
const MAX_PAGE = 100
const RANK: Record<Role, number> = { member: 0, maintainer: 1, admin: 2 }

const ok = <T>(value: T): Result<T> => ({ ok: true, value })
const fail = <T>(code: 'not_found' | 'exists' | 'invalid' | 'forbidden', message: string): Result<T> => ({
  ok: false,
  error: { code, message },
})

function newId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return (
    prefix +
    [...bytes]
      .map((b) => b.toString(36).padStart(2, '0'))
      .join('')
      .slice(0, 12)
  )
}

function encodeCursor(values: Array<string | number>): string {
  return Buffer.from(JSON.stringify(values)).toString('base64url')
}

function decodeCursor(cursor: string | undefined): Array<string | number> | null {
  if (!cursor) {
    return null
  }
  try {
    const values: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString())
    return Array.isArray(values) ? (values as Array<string | number>) : null
  } catch {
    return null
  }
}

const pageSize = (limit: number | undefined) => Math.min(MAX_PAGE, Math.max(1, limit ?? 25))

type UserRow = DB['users']
const toUser = (r: Pick<UserRow, 'id' | 'handle' | 'name' | 'inactive'>): User => ({
  id: r.id,
  handle: r.handle,
  name: r.name,
  inactive: r.inactive === 1,
})

const toIdea = (r: DB['ideas']): IdeaRow => ({
  id: r.id,
  title: r.title,
  team: r.team,
  owner: r.owner,
  status: r.status,
  latest: r.latest,
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
  number: Number(r.number),
  description: r.description,
  openComments: Number(r.open_comments),
})

/** Where an idea is numbered: its team, or its owner's own ideas. */
const placeKey = (team: string | null, owner: string) => team ?? `u:${owner}`

/** Why a parked handle can't be taken yet, and when it can. */
export function parkedMessage(handle: string, until: number): string {
  return `${handle} was someone else's until recently, so it's kept for them until ${new Date(until).toISOString().slice(0, 10)}: pick another`
}

/**
 * A person or team changed handle: the old one leads to them now (until
 * someone else takes it), and the new one stops leading to anyone else.
 */
async function renamed(
  db: Kysely<DB>,
  kind: 'user' | 'team',
  owner: string,
  from: string,
  to: string,
  now: number,
  keepOld = true,
) {
  await db.deleteFrom('handle_aliases').where('kind', '=', kind).where('handle', '=', to).execute()
  if (!keepOld) {
    return
  }
  await db
    .insertInto('handle_aliases')
    .values({ kind, handle: from, owner, created_at: now })
    .onConflict((oc) => oc.columns(['kind', 'handle']).doUpdateSet({ owner, created_at: now }))
    .execute()
}

/**
 * The next number in a place, counted atomically: an upsert, so two ideas
 * created at once can't get the same number, in SQLite or Postgres.
 */
async function nextNumber(db: Kysely<DB>, place: string): Promise<number> {
  const row = await db
    .insertInto('numbering')
    .values({ place, next: 2 })
    .onConflict((oc) => oc.column('place').doUpdateSet((eb) => ({ next: eb('numbering.next', '+', 1) })))
    .returning('next')
    .executeTakeFirstOrThrow()
  return Number(row.next) - 1
}

export interface SqlDirectoryOptions {
  sql: Sql
  search: IdeaSearch
  now?: () => number
  /** The most matches one search checks (default SEARCH_WORK_CAP); smaller in tests. */
  searchCap?: number
}

export class SqlDirectory implements Directory {
  readonly #sql: Sql
  readonly #db: Kysely<DB>
  readonly #search: IdeaSearch
  readonly #now: () => number
  readonly #searchCap: number

  constructor(options: SqlDirectoryOptions) {
    this.#searchCap = options.searchCap ?? SEARCH_WORK_CAP
    this.#sql = options.sql
    this.#db = sqliteKysely<DB>(options.sql)
    this.#search = options.search
    this.#now = options.now ?? Date.now
  }

  #transaction<T>(fn: (db: Kysely<DB>) => Promise<T>): Promise<T> {
    return this.#sql.transaction((tx) => fn(sqliteKysely<DB>(tx)))
  }

  // --- people ---------------------------------------------------------------------

  async ensureUser(user: { id: string; handle: string; name: string; email?: string }): Promise<User> {
    await this.#db
      .insertInto('users')
      .values({
        id: user.id,
        handle: user.handle.toLowerCase(),
        name: user.name,
        email: user.email ?? null,
        inactive: 0,
        created_at: this.#now(),
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute()
    // taking a handle someone had before: it leads to its new owner now
    await this.#db
      .deleteFrom('handle_aliases')
      .where('kind', '=', 'user')
      .where('handle', '=', user.handle.toLowerCase())
      .where('owner', '!=', user.id)
      .execute()
    return (await this.user(user.id))!
  }

  async updateUser(
    id: string,
    changes: { name?: string; inactive?: boolean; handle?: string; email?: string },
    { keepOldHandle = true }: { keepOldHandle?: boolean } = {},
  ): Promise<User | null> {
    const set = {
      ...(changes.name !== undefined ? { name: changes.name } : {}),
      ...(changes.inactive !== undefined ? { inactive: changes.inactive ? 1 : 0 } : {}),
      ...(changes.handle !== undefined ? { handle: changes.handle.toLowerCase() } : {}),
      ...(changes.email !== undefined ? { email: changes.email.toLowerCase() } : {}),
    }
    if (Object.keys(set).length > 0) {
      await this.#transaction(async (db) => {
        const was = await db.selectFrom('users').select('handle').where('id', '=', id).executeTakeFirst()
        await db.updateTable('users').set(set).where('id', '=', id).execute()
        if (was && set.handle !== undefined && set.handle !== was.handle) {
          await renamed(db, 'user', id, was.handle, set.handle, this.#now(), keepOldHandle)
        }
      })
    }
    return this.user(id)
  }

  async user(idOrHandle: string): Promise<User | null> {
    const handle = idOrHandle.toLowerCase().replace(/^@/, '')
    const find = (where: { id: string } | { handle: string }) =>
      this.#db
        .selectFrom('users')
        .select(['id', 'handle', 'name', 'inactive'])
        .where((eb) =>
          'id' in where ? eb('id', '=', where.id) : eb.or([eb('id', '=', idOrHandle), eb('handle', '=', where.handle)]),
        )
        .executeTakeFirst()
    // by ID or handle, or by a handle they had before
    const row =
      (await find({ handle })) ?? (await this.#aliased('user', handle).then((id) => (id ? find({ id }) : undefined)))
    return row ? toUser(row) : null
  }

  async users(ids: string[]): Promise<User[]> {
    const unique = [...new Set(ids)]
    if (unique.length === 0) {
      return []
    }
    const rows = await this.#db
      .selectFrom('users')
      .select(['id', 'handle', 'name', 'inactive'])
      .where('id', 'in', unique)
      .execute()
    return rows.map(toUser)
  }

  /** Whose old handle this is, if it's still theirs to lead to. */
  async #aliased(kind: 'user' | 'team', handle: string): Promise<string | null> {
    const row = await this.#db
      .selectFrom('handle_aliases')
      .select('owner')
      .where('kind', '=', kind)
      .where('handle', '=', handle)
      .executeTakeFirst()
    return row?.owner ?? null
  }

  async findUsers(query: string, limit = 8): Promise<User[]> {
    const q = likeEscape(query.trim().toLowerCase().replace(/^@/, ''))
    if (!q) {
      return []
    }
    const rows = await this.#db
      .selectFrom('users')
      .select(['id', 'handle', 'name', 'inactive'])
      .where((eb) =>
        eb.or([
          eb('handle', 'like', `${q}%`),
          eb(eb.fn('lower', ['name']), 'like', `${q}%`),
          eb(eb.fn('lower', ['name']), 'like', `% ${q}%`),
        ]),
      )
      .orderBy('handle')
      .limit(Math.min(limit, 50))
      .execute()
    return rows.map(toUser).sort((a, b) => Number(b.handle.startsWith(q)) - Number(a.handle.startsWith(q)))
  }

  // --- teams and groups ---------------------------------------------------------------

  createTeam(actor: string, input: { handle: string; name: string; description?: string }): Promise<Result<Team>> {
    return this.#createContainer('team', actor, input) as Promise<Result<Team>>
  }

  createGroup(actor: string, input: { handle: string; name: string; description?: string }): Promise<Result<Group>> {
    return this.#createContainer('group', actor, input) as Promise<Result<Group>>
  }

  async #createContainer(
    kind: ContainerKind,
    actor: string,
    input: { handle: string; name: string; description?: string },
  ): Promise<Result<Container>> {
    const handle = input.handle.toLowerCase()
    if (!HANDLE.test(handle)) {
      return fail(
        'invalid',
        'a handle is 1 to 39 lowercase letters, digits and dashes, not starting or ending with a dash',
      )
    }
    if (RESERVED.has(handle)) {
      return fail('invalid', `${handle} is one of the site's own addresses: pick another handle`)
    }
    if (kind === 'team') {
      const parked = await this.parkedUntil('team', handle, null)
      if (parked) {
        return fail('exists', parkedMessage(handle, parked))
      }
    }
    const name = input.name.trim()
    if (!name || name.length > 100) {
      return fail('invalid', 'a name is 1 to 100 characters')
    }
    const creator = await this.user(actor)
    if (!creator) {
      return fail('forbidden', 'unknown user')
    }
    if (creator.inactive) {
      return fail('forbidden', 'inactive users can’t create teams or groups')
    }
    const id = newId(kind === 'team' ? 't' : 'g')
    const now = this.#now()
    try {
      await this.#transaction(async (db) => {
        const base = { id, handle, name, description: input.description ?? '', created_by: actor, created_at: now }
        if (kind === 'team') {
          await db
            .insertInto('teams')
            .values({
              ...base,
              archived: 0,
              create_policy: 'members',
              defaults: JSON.stringify(DEFAULT_TEAM_DEFAULTS),
              requirements: JSON.stringify(NO_REQUIREMENTS),
            })
            .execute()
        } else {
          await db
            .insertInto('groups')
            .values({ ...base, deleted_at: null })
            .execute()
        }
        await db
          .insertInto('memberships')
          .values({ kind, container: id, user: actor, role: 'admin', created_at: now })
          .execute()
        if (kind === 'team') {
          // a handle another team had before: it leads to this one now
          await db.deleteFrom('handle_aliases').where('kind', '=', 'team').where('handle', '=', handle).execute()
        }
      })
    } catch (error) {
      if (isUniqueViolation(error)) {
        return fail('exists', `the ${kind} handle "${handle}" is taken`)
      }
      throw error
    }
    return ok((await this.#container(kind, id))!)
  }

  team(idOrHandle: string): Promise<Team | null> {
    return this.#container('team', idOrHandle) as Promise<Team | null>
  }

  group(idOrHandle: string): Promise<Group | null> {
    return this.#container('group', idOrHandle) as Promise<Group | null>
  }

  async #container(kind: ContainerKind, idOrHandle: string): Promise<Container | null> {
    const members = (id: string) =>
      this.#db
        .selectFrom('memberships')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('kind', '=', kind)
        .where('container', '=', id)
        .executeTakeFirstOrThrow()
        .then((r) => Number(r.n))
    const handle = idOrHandle.toLowerCase().replace(/^@/, '')
    if (kind === 'team') {
      const find = (id: string, byHandle: string | null) =>
        this.#db
          .selectFrom('teams')
          .selectAll()
          .where((eb) =>
            byHandle === null ? eb('id', '=', id) : eb.or([eb('id', '=', id), eb('handle', '=', byHandle)]),
          )
          .executeTakeFirst()
      // by ID or handle, or by a handle it had before
      const row =
        (await find(idOrHandle, handle)) ??
        (await this.#aliased('team', handle).then((id) => (id ? find(id, null) : undefined)))
      return row ? this.#toTeam(row, await members(row.id)) : null
    }
    const row = await this.#db
      .selectFrom('groups')
      .selectAll()
      .where((eb) => eb.or([eb('id', '=', idOrHandle), eb('handle', '=', handle)]))
      .executeTakeFirst()
    return row ? this.#toGroup(row, await members(row.id)) : null
  }

  #toTeam(row: DB['teams'], members: number): Team {
    return {
      kind: 'team',
      id: row.id,
      handle: row.handle,
      name: row.name,
      description: row.description,
      createdAt: Number(row.created_at),
      members,
      archived: row.archived === 1,
      createPolicy: row.create_policy as CreatePolicy,
      defaults: JSON.parse(row.defaults) as TeamDefaults,
      requirements: JSON.parse(row.requirements) as TeamRequirements,
    }
  }

  #toGroup(row: DB['groups'], members: number): Group {
    return {
      kind: 'group',
      id: row.id,
      handle: row.handle,
      name: row.name,
      description: row.description,
      createdAt: Number(row.created_at),
      members,
      deleted: row.deleted_at !== null,
    }
  }

  async teams(options: { query?: string; cursor?: string; limit?: number } = {}): Promise<Page<Team>> {
    return this.#listContainers('team', options) as Promise<Page<Team>>
  }

  async groups(options: { query?: string; cursor?: string; limit?: number } = {}): Promise<Page<Group>> {
    return this.#listContainers('group', options) as Promise<Page<Group>>
  }

  async #listContainers(
    kind: ContainerKind,
    options: { query?: string; cursor?: string; limit?: number },
  ): Promise<Page<Container>> {
    const limit = pageSize(options.limit)
    const after = decodeCursor(options.cursor)
    const q = likeEscape((options.query ?? '').trim().toLowerCase())
    const table = kind === 'team' ? 'teams' : 'groups'
    let query = this.#db
      .selectFrom(table)
      .select(['id', 'handle'])
      .orderBy('handle')
      .limit(limit + 1)
    if (q) {
      query = query.where((eb) =>
        eb.or([eb('handle', 'like', `${q}%`), eb(eb.fn('lower', ['name']), 'like', `%${q}%`)]),
      )
    }
    if (after) {
      query = query.where('handle', '>', String(after[0]))
    }
    const rows = await query.execute()
    const page = rows.slice(0, limit)
    const items = (await Promise.all(page.map((r) => this.#container(kind, r.id)))).filter(
      (c): c is Container => c !== null,
    )
    return { items, next: rows.length > limit ? encodeCursor([page.at(-1)!.handle]) : null }
  }

  async updateTeam(
    actor: string,
    teamId: string,
    changes: {
      createPolicy?: CreatePolicy
      defaults?: TeamDefaults
      handle?: string
      name?: string
      description?: string
    },
  ): Promise<Result<Team>> {
    const team = await this.team(teamId)
    if (!team) {
      return fail('not_found', `no team ${teamId}`)
    }
    if ((await this.#role('team', team.id, actor)) !== 'admin') {
      return fail('forbidden', 'only a team’s admins can change its settings')
    }
    if (changes.createPolicy && !['anyone', 'members', 'maintainers'].includes(changes.createPolicy)) {
      return fail('invalid', 'createPolicy is anyone, members or maintainers')
    }
    if (changes.defaults) {
      const d = changes.defaults
      if (!['none', 'view', 'edit'].includes(d.members) || typeof d.public !== 'boolean' || !Array.isArray(d.groups)) {
        return fail('invalid', 'defaults are { members, public, groups }')
      }
      const groups: TeamDefaults['groups'] = []
      for (const g of d.groups) {
        const group = await this.group(g.group)
        if (!group) {
          return fail('invalid', `no group ${g.group}`)
        }
        // stored by ID, whether named by ID or handle
        groups.push({ group: group.id, edit: g.edit })
      }
      changes = { ...changes, defaults: { ...d, groups } }
    }
    const handle = changes.handle?.toLowerCase()
    if (handle !== undefined && handle !== team.handle) {
      if (!HANDLE.test(handle)) {
        return fail(
          'invalid',
          'a handle is 1 to 39 lowercase letters, digits and dashes, not starting or ending with a dash',
        )
      }
      if (RESERVED.has(handle)) {
        return fail('invalid', `${handle} is one of the site's own addresses: pick another handle`)
      }
      const parked = await this.parkedUntil('team', handle, team.id)
      if (parked) {
        return fail('exists', parkedMessage(handle, parked))
      }
    }
    const name = changes.name?.trim()
    if (name !== undefined && (!name || name.length > 100)) {
      return fail('invalid', 'a name is 1 to 100 characters')
    }
    if (changes.description !== undefined && changes.description.length > 2000) {
      return fail('invalid', 'a description is at most 2,000 characters')
    }
    try {
      await this.#transaction(async (db) => {
        await db
          .updateTable('teams')
          .set({
            ...(changes.createPolicy ? { create_policy: changes.createPolicy } : {}),
            ...(changes.defaults ? { defaults: JSON.stringify(changes.defaults) } : {}),
            ...(handle !== undefined ? { handle } : {}),
            ...(name !== undefined ? { name } : {}),
            ...(changes.description !== undefined ? { description: changes.description } : {}),
          })
          .where('id', '=', team.id)
          .execute()
        if (handle !== undefined && handle !== team.handle) {
          await renamed(db, 'team', team.id, team.handle, handle, this.#now())
        }
      })
    } catch (error) {
      if (isUniqueViolation(error)) {
        return fail('exists', `the team handle "${handle}" is taken`)
      }
      throw error
    }
    return ok((await this.team(team.id))!)
  }

  async setRequirements(actor: string, teamId: string, requirements: TeamRequirements): Promise<Result<Team>> {
    const team = await this.team(teamId)
    if (!team) {
      return fail('not_found', `no team ${teamId}`)
    }
    const role = await this.#role('team', team.id, actor)
    if (role !== 'admin' && role !== 'maintainer') {
      return fail('forbidden', 'only a team’s maintainers and admins can change its approval requirements')
    }
    const r = requirements
    if (!Number.isInteger(r.approvals) || r.approvals < 0 || r.approvals > 50) {
      return fail('invalid', 'approvals is a whole number from 0 to 50')
    }
    if (!Array.isArray(r.groups) || r.groups.length > 10) {
      return fail('invalid', 'a team has at most 10 group rules')
    }
    const rules: GroupRule[] = []
    for (const rule of r.groups) {
      if ((rule.mode !== 'any' && rule.mode !== 'each') || rule.groups.length === 0 || rule.groups.length > 10) {
        return fail('invalid', 'a group rule is "any" or "each" of 1 to 10 groups')
      }
      const ids: string[] = []
      for (const name of rule.groups) {
        const group = await this.group(name)
        if (!group) {
          return fail('invalid', `no group ${name}`)
        }
        if (group.deleted) {
          return fail('invalid', `${group.handle} is deleted`)
        }
        // stored by ID, whether named by ID or handle
        if (!ids.includes(group.id)) {
          ids.push(group.id)
        }
      }
      rules.push({ mode: rule.mode, groups: ids, request: rule.request === true })
    }
    const stored: TeamRequirements = { approvals: r.approvals, groups: rules, resolved: r.resolved === true }
    await this.#db
      .updateTable('teams')
      .set({ requirements: JSON.stringify(stored) })
      .where('id', '=', team.id)
      .execute()
    return ok((await this.team(team.id))!)
  }

  async checkRequirements(ideaId: string, approvers: string[], open: number): Promise<RequirementsCheck> {
    const idea = await this.idea(ideaId)
    const team = idea?.team ? await this.team(idea.team) : null
    if (!team || team.archived) {
      return { met: true, checks: [] }
    }
    const r = team.requirements
    const checks: RequirementCheck[] = []
    if (r.approvals > 0) {
      checks.push({
        kind: 'approvals',
        need: r.approvals,
        have: approvers.length,
        met: approvers.length >= r.approvals,
      })
    }
    const named = [...new Set(r.groups.flatMap((rule) => rule.groups))]
    // who of the approvers is in each group the rules name
    const members =
      named.length > 0 && approvers.length > 0
        ? await this.#db
            .selectFrom('memberships')
            .select(['container', 'user'])
            .where('kind', '=', 'group')
            .where('container', 'in', named)
            .where('user', 'in', approvers)
            .execute()
        : []
    for (const rule of r.groups) {
      const groups = await Promise.all(
        rule.groups.map(async (id) => {
          const group = await this.group(id)
          const deleted = !group || group.deleted
          return {
            id,
            handle: group?.handle ?? id,
            name: group?.name ?? id,
            deleted,
            // a deleted group's members' approvals don't count toward it
            approvedBy: deleted ? [] : members.filter((m) => m.container === id).map((m) => m.user),
          }
        }),
      )
      const live = groups.filter((g) => !g.deleted)
      const broken = rule.mode === 'each' ? live.length < groups.length : live.length === 0
      const met =
        !broken &&
        (rule.mode === 'each' ? live.every((g) => g.approvedBy.length > 0) : live.some((g) => g.approvedBy.length > 0))
      checks.push({ kind: 'groups', mode: rule.mode, groups, met, broken })
    }
    if (r.resolved) {
      checks.push({ kind: 'resolved', open, met: open === 0 })
    }
    return { met: checks.every((c) => c.met), checks }
  }

  async requestRuleGroups(ideaId: string): Promise<string[]> {
    const idea = await this.idea(ideaId)
    const team = idea?.team ? await this.team(idea.team) : null
    if (!team || team.archived) {
      return []
    }
    const wanted = [...new Set(team.requirements.groups.filter((r) => r.request).flatMap((r) => r.groups))]
    const asked: string[] = []
    for (const id of wanted) {
      const group = await this.group(id)
      if (!group || group.deleted) {
        continue
      }
      const existing = await this.#db
        .selectFrom('grants')
        .select('reviewer')
        .where('idea', '=', ideaId)
        .where('kind', '=', 'group')
        .where('subject', '=', id)
        .executeTakeFirst()
      if (existing?.reviewer === 1) {
        continue
      }
      await this.#db
        .insertInto('grants')
        .values({
          idea: ideaId,
          kind: 'group',
          subject: id,
          can_edit: 0,
          can_share: 0,
          reviewer: 1,
          created_at: this.#now(),
        })
        .onConflict((oc) => oc.columns(['idea', 'kind', 'subject']).doUpdateSet({ reviewer: 1 }))
        .execute()
      await this.#notifyRequest(ideaId, { kind: 'group', id }, null)
      asked.push(id)
    }
    return asked
  }

  // --- the inbox ---------------------------------------------------------------------

  /**
   * Who hears about an idea, and why: its owner, people asked to review it
   * (by name, or every member of a group asked), and its subscribers; less
   * anyone who unsubscribed. The most direct reason wins.
   */
  async #audience(idea: IdeaRow, db: Kysely<DB> = this.#db): Promise<Map<string, InboxReason>> {
    const reasons = new Map<string, InboxReason>()
    const add = (user: string, reason: InboxReason) => {
      const now = reasons.get(user)
      if (!now || INBOX_REASONS.indexOf(reason) < INBOX_REASONS.indexOf(now)) {
        reasons.set(user, reason)
      }
    }
    // one after the other: inside a transaction there's one connection
    const subs = await db.selectFrom('subscriptions').select(['user', 'state']).where('idea', '=', idea.id).execute()
    const asked = await db
      .selectFrom('grants')
      .select(['kind', 'subject'])
      .where('idea', '=', idea.id)
      .where('reviewer', '=', 1)
      .execute()
    const groups = asked.filter((g) => g.kind === 'group').map((g) => g.subject)
    const members = groups.length
      ? await db
          .selectFrom('memberships')
          .select('user')
          .where('kind', '=', 'group')
          .where('container', 'in', groups)
          .execute()
      : []
    add(idea.owner, 'author')
    for (const g of asked) {
      if (g.kind === 'user') {
        add(g.subject, 'review-requested')
      }
    }
    for (const m of members) {
      add(m.user, 'group-review')
    }
    for (const s of subs) {
      if (s.state !== 'unsubscribed') {
        add(s.user, s.state as InboxReason)
      }
    }
    for (const s of subs) {
      if (s.state === 'unsubscribed') {
        reasons.delete(s.user)
      }
    }
    return reasons
  }

  /** Writes one event to these people's inboxes: one statement for all of them. */
  async #deliver(db: Kysely<DB>, idea: string, event: InboxEvent, to: Map<string, InboxReason>): Promise<void> {
    const id = newId('ev')
    await db
      .insertInto('inbox_events')
      .values({
        id,
        idea,
        kind: event.kind,
        actor: JSON.stringify(event.actor),
        at: event.at,
        detail: JSON.stringify(event.detail),
      })
      .execute()
    if (to.size === 0) {
      return
    }
    await db
      .insertInto('inbox')
      .values(
        [...to].map(([user, reason]) => ({
          user,
          idea,
          reason,
          event: id,
          new_count: 1,
          done: 0,
          updated_at: event.at,
        })),
      )
      .onConflict((oc) =>
        oc.columns(['user', 'idea']).doUpdateSet((eb) => ({
          reason: eb.ref('excluded.reason'),
          event: eb.ref('excluded.event'),
          new_count: raw<number>`inbox.new_count + 1`,
          done: 0,
          updated_at: eb.ref('excluded.updated_at'),
        })),
      )
      .execute()
  }

  /**
   * Writes ideas' events to inboxes: several batches (a queue's worth) in one
   * transaction, since each commit writes pages and SQLite's writes are the
   * bottleneck. Should that transaction fail, each batch is tried on its own,
   * so one bad batch doesn't lose the others.
   */
  async notify(input: NotifyBatch | NotifyBatch[]): Promise<void> {
    const batches = (Array.isArray(input) ? input : [input]).filter((b) => b.events.length > 0)
    if (batches.length === 0) {
      return
    }
    // what your bots do stays out of your inbox if you said so
    const owners = [
      ...new Set(
        batches.flatMap((b) => b.events.filter((e) => e.actor.purpose === 'bot-for-me').map((e) => e.actor.user)),
      ),
    ]
    const quiet = new Set(
      owners.length
        ? (
            await this.#db
              .selectFrom('notification_settings')
              .select('user')
              .where('user', 'in', owners)
              .where('own_bots', '=', 0)
              .execute()
          ).map((r) => r.user)
        : [],
    )
    const ideas = new Map<string, IdeaRow>()
    for (const id of new Set(batches.map((b) => b.idea))) {
      const idea = await this.idea(id)
      if (idea) {
        ideas.set(id, idea)
      }
    }
    const apply = (some: NotifyBatch[]) =>
      this.#transaction(async (db) => {
        for (const batch of some) {
          const idea = ideas.get(batch.idea)
          if (idea) {
            await this.#notifyOne(db, idea, batch.events, quiet)
          }
        }
      })
    try {
      await apply(batches)
    } catch (error) {
      if (batches.length === 1) {
        throw error
      }
      const failed: unknown[] = []
      for (const batch of batches) {
        await apply([batch]).catch((e: unknown) => failed.push(e))
      }
      if (failed.length > 0) {
        throw failed[0]
      }
    }
  }

  /** One idea's events, inside the caller's transaction. */
  async #notifyOne(db: Kysely<DB>, idea: IdeaRow, events: InboxEvent[], quiet: Set<string>): Promise<void> {
    // taking part subscribes you, unless you've unsubscribed
    const taking = [
      ...new Set(
        events
          .filter((e) => ['comment', 'suggestion', 'reply', 'review'].includes(e.kind) && e.actor.purpose === 'me')
          .map((e) => e.actor.user),
      ),
    ].filter((u) => u !== idea.owner)
    if (taking.length) {
      await db
        .insertInto('subscriptions')
        .values(taking.map((user) => ({ user, idea: idea.id, state: 'participating', at: this.#now() })))
        .onConflict((oc) => oc.columns(['user', 'idea']).doNothing())
        .execute()
    }
    const audience = await this.#audience(idea, db)
    for (const event of events) {
      // you don't hear about what you did; what your bots did, unless you said not to
      const to = new Map(
        [...audience].filter(
          ([user]) =>
            user !== event.actor.user ||
            (event.actor.purpose === 'bot-for-me' && !quiet.has(user)) ||
            event.actor.purpose === 'bot',
        ),
      )
      await this.#deliver(db, idea.id, event, to)
    }
  }

  /** A review request: the person asked, or every member of the group, hears of it even if they unsubscribed. */
  async #notifyRequest(ideaId: string, subject: { kind: 'user' | 'group'; id: string }, actor: ActorRef | null) {
    const idea = await this.idea(ideaId)
    if (!idea) {
      return
    }
    const users =
      subject.kind === 'user'
        ? [subject.id]
        : (
            await this.#db
              .selectFrom('memberships')
              .select('user')
              .where('kind', '=', 'group')
              .where('container', '=', subject.id)
              .execute()
          ).map((m) => m.user)
    const reason: InboxReason = subject.kind === 'user' ? 'review-requested' : 'group-review'
    const audience = await this.#audience(idea)
    const to = new Map<string, InboxReason>()
    for (const user of users) {
      if (user === actor?.user) {
        continue
      }
      const now = audience.get(user)
      to.set(user, now && INBOX_REASONS.indexOf(now) < INBOX_REASONS.indexOf(reason) ? now : reason)
    }
    await this.#transaction((db) =>
      this.#deliver(
        db,
        idea.id,
        {
          kind: 'requested',
          actor: actor ?? { user: '', bot: null, purpose: 'me' },
          at: this.#now(),
          detail: { subject },
        },
        to,
      ),
    )
  }

  async inbox(user: string, filter: InboxFilter = {}, token?: string | null): Promise<Page<InboxRow>> {
    const limit = pageSize(filter.limit)
    const after = decodeCursor(filter.cursor)
    let query = this.#db
      .selectFrom('inbox')
      .innerJoin('ideas', 'ideas.id', 'inbox.idea')
      .innerJoin('inbox_events', 'inbox_events.id', 'inbox.event')
      .selectAll('ideas')
      .select([
        'inbox.reason',
        'inbox.new_count',
        'inbox.done',
        'inbox.updated_at as inbox_at',
        'inbox_events.kind as event_kind',
        'inbox_events.actor as event_actor',
        'inbox_events.at as event_at',
        'inbox_events.detail as event_detail',
      ])
      .where('inbox.user', '=', user)
      .where('inbox.done', '=', filter.done ? 1 : 0)
      // only ideas they can still see: losing access hides what they'd heard
      .where((eb) => visibleTo(eb as unknown as ExpressionBuilder<DB, 'ideas'>, user))
      // a limited token sees only what it reaches
      .where((eb) =>
        token ? tokenReaches(eb as unknown as ExpressionBuilder<DB, 'ideas'>, user, token) : eb.lit(true),
      )
      .orderBy('inbox.updated_at', 'desc')
      .orderBy('inbox.idea', 'desc')
      .limit(limit + 1)
    if (filter.reason) {
      query = query.where('inbox.reason', '=', filter.reason)
    }
    if (filter.unread) {
      query = query.where('inbox.new_count', '>', 0)
    }
    if (after) {
      const [at, id] = [Number(after[0]), String(after[1])]
      query = query.where((eb) =>
        eb.or([eb('inbox.updated_at', '<', at), eb.and([eb('inbox.updated_at', '=', at), eb('inbox.idea', '<', id)])]),
      )
    }
    const rows = await query.execute()
    const page = rows.slice(0, limit)
    const listings = await this.#listings(page.map((r) => toIdea(r)))
    return {
      items: page.map((r, i) => ({
        idea: listings[i]!,
        reason: r.reason as InboxReason,
        newCount: r.new_count,
        done: r.done === 1,
        updatedAt: Number(r.inbox_at),
        latest: {
          kind: r.event_kind as InboxEvent['kind'],
          actor: JSON.parse(r.event_actor) as ActorRef,
          at: Number(r.event_at),
          detail: JSON.parse(r.event_detail) as Record<string, unknown>,
        },
      })),
      next: rows.length > limit ? encodeCursor([Number(page.at(-1)!.inbox_at), page.at(-1)!.id]) : null,
    }
  }

  async unreadCount(user: string, token?: string | null): Promise<number> {
    const row = await this.#db
      .selectFrom('inbox')
      .innerJoin('ideas', 'ideas.id', 'inbox.idea')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('inbox.user', '=', user)
      .where('inbox.done', '=', 0)
      .where('inbox.new_count', '>', 0)
      .where((eb) => visibleTo(eb as unknown as ExpressionBuilder<DB, 'ideas'>, user))
      .where((eb) =>
        token ? tokenReaches(eb as unknown as ExpressionBuilder<DB, 'ideas'>, user, token) : eb.lit(true),
      )
      .executeTakeFirst()
    return Number(row?.n ?? 0)
  }

  async markInbox(user: string, ideas: string[] | null, change: { read?: boolean; done?: boolean }): Promise<number> {
    if (ideas?.length === 0 || (!change.read && change.done === undefined)) {
      return 0
    }
    // which rows: these ideas, or (for "all") everything in the list they move out of
    let which = this.#db.selectFrom('inbox').select('idea').where('user', '=', user)
    if (ideas) {
      which = which.where('idea', 'in', ideas)
    } else if (change.done !== undefined) {
      which = which.where('done', '=', change.done ? 0 : 1)
    }
    if (change.read && change.done === undefined) {
      which = which.where('new_count', '>', 0)
    }
    const chosen = (await which.execute()).map((r) => r.idea)
    if (chosen.length === 0) {
      return 0
    }
    await this.#db
      .updateTable('inbox')
      .set({
        ...(change.read ? { new_count: 0 } : {}),
        ...(change.done !== undefined ? { done: change.done ? 1 : 0 } : {}),
      })
      .where('user', '=', user)
      .where('idea', 'in', chosen)
      .execute()
    return chosen.length
  }

  async subscription(user: string, ideaId: string): Promise<{ subscribed: boolean; reason: InboxReason | null }> {
    const idea = await this.idea(ideaId)
    if (!idea) {
      return { subscribed: false, reason: null }
    }
    const reason = (await this.#audience(idea)).get(user) ?? null
    return { subscribed: reason !== null, reason }
  }

  async setSubscription(
    user: string,
    ideaId: string,
    subscribed: boolean,
  ): Promise<Result<{ subscribed: boolean; reason: InboxReason | null }>> {
    if (!(await this.permission(ideaId, user)).view) {
      return fail('not_found', "this idea doesn't exist, or you can't see it")
    }
    const state = subscribed ? 'subscribed' : 'unsubscribed'
    await this.#db
      .insertInto('subscriptions')
      .values({ user, idea: ideaId, state, at: this.#now() })
      .onConflict((oc) => oc.columns(['user', 'idea']).doUpdateSet({ state, at: this.#now() }))
      .execute()
    return ok(await this.subscription(user, ideaId))
  }

  async notificationSettings(user: string): Promise<{ ownBots: boolean }> {
    const row = await this.#db
      .selectFrom('notification_settings')
      .select('own_bots')
      .where('user', '=', user)
      .executeTakeFirst()
    return { ownBots: row ? row.own_bots === 1 : true }
  }

  async setNotificationSettings(user: string, settings: { ownBots: boolean }): Promise<{ ownBots: boolean }> {
    const own_bots = settings.ownBots ? 1 : 0
    await this.#db
      .insertInto('notification_settings')
      .values({ user, own_bots })
      .onConflict((oc) => oc.column('user').doUpdateSet({ own_bots }))
      .execute()
    return this.notificationSettings(user)
  }

  async parkedUntil(kind: 'user' | 'team', handle: string, requester: string | null): Promise<number | null> {
    const row = await this.#db
      .selectFrom('handle_aliases')
      .select(['owner', 'created_at'])
      .where('kind', '=', kind)
      .where('handle', '=', handle.toLowerCase().replace(/^@/, ''))
      .executeTakeFirst()
    if (!row || row.owner === requester) {
      return null
    }
    const until = Number(row.created_at) + HANDLE_PARKED_MS
    return until > this.#now() ? until : null
  }

  async releaseHandle(kind: 'user' | 'team', handle: string, replacement: string): Promise<{ owner: string | null }> {
    const name = handle.toLowerCase().replace(/^@/, '')
    return this.#transaction(async (db) => {
      const holder =
        kind === 'team'
          ? await db.selectFrom('teams').select('id').where('handle', '=', name).executeTakeFirst()
          : await db.selectFrom('users').select('id').where('handle', '=', name).executeTakeFirst()
      if (holder && kind === 'team') {
        // renamed without an alias: the old handle is free, and leads nowhere
        await db.updateTable('teams').set({ handle: replacement }).where('id', '=', holder.id).execute()
      }
      const alias = await db
        .deleteFrom('handle_aliases')
        .where('kind', '=', kind)
        .where('handle', '=', name)
        .returning('owner')
        .executeTakeFirst()
      return { owner: holder?.id ?? alias?.owner ?? null }
    })
  }

  async members(
    kind: ContainerKind,
    id: string,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<Page<Member>> {
    const limit = pageSize(options.limit)
    const after = decodeCursor(options.cursor)
    let query = this.#db
      .selectFrom('memberships')
      .innerJoin('users', 'users.id', 'memberships.user')
      .select(['users.id', 'users.handle', 'users.name', 'users.inactive', 'memberships.role'])
      .where('memberships.kind', '=', kind)
      .where('memberships.container', '=', id)
      .orderBy('users.handle')
      .limit(limit + 1)
    if (after) {
      query = query.where('users.handle', '>', String(after[0]))
    }
    const rows = await query.execute()
    const page = rows.slice(0, limit)
    return {
      items: page.map((r) => ({ user: toUser(r), role: r.role })),
      next: rows.length > limit ? encodeCursor([page.at(-1)!.handle]) : null,
    }
  }

  async #admins(kind: ContainerKind, container: string): Promise<number> {
    const row = await this.#db
      .selectFrom('memberships')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('kind', '=', kind)
      .where('container', '=', container)
      .where('role', '=', 'admin')
      .executeTakeFirstOrThrow()
    return Number(row.n)
  }

  async memberships(user: string): Promise<Memberships> {
    const [teams, groups, requested] = await Promise.all([
      this.#db
        .selectFrom('memberships as m')
        .innerJoin('teams as t', 't.id', 'm.container')
        .select(['t.id', 't.handle', 't.name', 't.archived', 'm.role'])
        .where('m.kind', '=', 'team')
        .where('m.user', '=', user)
        .orderBy('t.handle')
        .execute(),
      this.#db
        .selectFrom('memberships as m')
        .innerJoin('groups as g', 'g.id', 'm.container')
        .select(['g.id', 'g.handle', 'g.name', 'm.role'])
        .where('m.kind', '=', 'group')
        .where('m.user', '=', user)
        .where('g.deleted_at', 'is', null)
        .orderBy('g.handle')
        .execute(),
      this.#db.selectFrom('join_requests').select(['kind', 'container']).where('user', '=', user).execute(),
    ])
    return {
      teams: teams.map((t) => ({ id: t.id, handle: t.handle, name: t.name, archived: t.archived === 1, role: t.role })),
      groups: groups.map((g) => ({ id: g.id, handle: g.handle, name: g.name, role: g.role })),
      requested: requested.map((r) => ({ kind: r.kind, id: r.container })),
    }
  }

  async #role(kind: ContainerKind, container: string, user: string): Promise<Role | null> {
    const row = await this.#db
      .selectFrom('memberships')
      .select('role')
      .where('kind', '=', kind)
      .where('container', '=', container)
      .where('user', '=', user)
      .executeTakeFirst()
    return row?.role ?? null
  }

  async #resolve(kind: ContainerKind, id: string): Promise<Container | null> {
    return this.#container(kind, id)
  }

  async addMember(
    actor: string,
    kind: ContainerKind,
    id: string,
    user: string,
    role: Role = 'member',
  ): Promise<Result<Member>> {
    const container = await this.#resolve(kind, id)
    if (!container) {
      return fail('not_found', `no ${kind} ${id}`)
    }
    const mine = await this.#role(kind, container.id, actor)
    if (mine !== 'admin' && mine !== 'maintainer') {
      return fail('forbidden', `only a ${kind}’s maintainers and admins can add members`)
    }
    if (role !== 'member' && mine !== 'admin') {
      return fail('forbidden', `only a ${kind}’s admins can give roles`)
    }
    const person = await this.user(user)
    if (!person) {
      return fail('not_found', `no user ${user}`)
    }
    if (person.inactive) {
      return fail('invalid', `${person.handle} is inactive`)
    }
    // someone already in it: this changes their role, which only an admin can,
    // and never leaves it without an admin
    const theirs = await this.#role(kind, container.id, person.id)
    if (theirs && theirs !== role) {
      if (mine !== 'admin') {
        return fail('forbidden', `only a ${kind}’s admins can change roles`)
      }
      if (theirs === 'admin' && (await this.#admins(kind, container.id)) <= 1) {
        return fail('invalid', `a ${kind} needs at least one admin; make someone else an admin first`)
      }
    }
    await this.#transaction(async (db) => {
      await db
        .insertInto('memberships')
        .values({ kind, container: container.id, user, role, created_at: this.#now() })
        .onConflict((oc) => oc.columns(['kind', 'container', 'user']).doUpdateSet({ role }))
        .execute()
      await db
        .deleteFrom('join_requests')
        .where('kind', '=', kind)
        .where('container', '=', container.id)
        .where('user', '=', user)
        .execute()
    })
    return ok({ user: person, role })
  }

  async removeMember(actor: string, kind: ContainerKind, id: string, user: string): Promise<Result<null>> {
    const container = await this.#resolve(kind, id)
    if (!container) {
      return fail('not_found', `no ${kind} ${id}`)
    }
    const mine = await this.#role(kind, container.id, actor)
    const theirs = await this.#role(kind, container.id, user)
    if (!theirs) {
      return ok(null)
    }
    const leaving = actor === user
    if (
      !leaving &&
      (mine === null || mine === 'member' || RANK[mine] < RANK[theirs] || (theirs === 'admin' && mine !== 'admin'))
    ) {
      return fail('forbidden', `you can’t remove a ${theirs} from this ${kind}`)
    }
    return this.#transaction(async (db) => {
      if (theirs === 'admin') {
        const admins = await db
          .selectFrom('memberships')
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .where('kind', '=', kind)
          .where('container', '=', container.id)
          .where('role', '=', 'admin')
          .executeTakeFirstOrThrow()
        if (Number(admins.n) <= 1) {
          return fail<null>('invalid', `a ${kind} needs at least one admin; make someone else an admin first`)
        }
      }
      await db
        .deleteFrom('memberships')
        .where('kind', '=', kind)
        .where('container', '=', container.id)
        .where('user', '=', user)
        .execute()
      return ok(null)
    })
  }

  async requestToJoin(actor: string, kind: ContainerKind, id: string): Promise<Result<{ requested: boolean }>> {
    const container = await this.#resolve(kind, id)
    if (!container) {
      return fail('not_found', `no ${kind} ${id}`)
    }
    if (await this.#role(kind, container.id, actor)) {
      return ok({ requested: false })
    }
    await this.#db
      .insertInto('join_requests')
      .values({ kind, container: container.id, user: actor, created_at: this.#now() })
      .onConflict((oc) => oc.columns(['kind', 'container', 'user']).doNothing())
      .execute()
    return ok({ requested: true })
  }

  async joinRequests(actor: string, kind: ContainerKind, id: string): Promise<Result<User[]>> {
    const container = await this.#resolve(kind, id)
    if (!container) {
      return fail('not_found', `no ${kind} ${id}`)
    }
    const mine = await this.#role(kind, container.id, actor)
    if (mine !== 'admin' && mine !== 'maintainer') {
      return fail('forbidden', `only a ${kind}’s maintainers and admins see its join requests`)
    }
    const rows = await this.#db
      .selectFrom('join_requests')
      .innerJoin('users', 'users.id', 'join_requests.user')
      .select(['users.id', 'users.handle', 'users.name', 'users.inactive'])
      .where('join_requests.kind', '=', kind)
      .where('join_requests.container', '=', container.id)
      .orderBy('join_requests.created_at')
      .orderBy('users.handle')
      .execute()
    return ok(rows.map(toUser))
  }

  async decide(actor: string, kind: ContainerKind, id: string, user: string, approve: boolean): Promise<Result<null>> {
    const container = await this.#resolve(kind, id)
    if (!container) {
      return fail('not_found', `no ${kind} ${id}`)
    }
    const mine = await this.#role(kind, container.id, actor)
    if (mine !== 'admin' && mine !== 'maintainer') {
      return fail('forbidden', `only a ${kind}’s maintainers and admins can approve requests`)
    }
    const request = await this.#db
      .selectFrom('join_requests')
      .select('user')
      .where('kind', '=', kind)
      .where('container', '=', container.id)
      .where('user', '=', user)
      .executeTakeFirst()
    if (!request) {
      return fail('not_found', `${user} hasn't asked to join`)
    }
    if (approve) {
      const added = await this.addMember(actor, kind, container.id, user)
      return added.ok ? ok(null) : added
    }
    await this.#db
      .deleteFrom('join_requests')
      .where('kind', '=', kind)
      .where('container', '=', container.id)
      .where('user', '=', user)
      .execute()
    return ok(null)
  }

  // --- ideas: the index, access and lists -------------------------------------------------

  async canCreateIdea(actor: string, teamId: string | null, token?: string | null): Promise<Result<null>> {
    const user = await this.user(actor)
    if (!user) {
      return fail('forbidden', 'unknown user')
    }
    if (user.inactive) {
      return fail('forbidden', 'inactive users can’t create ideas')
    }
    const grant = token ? await this.tokenGrant(token) : null
    if (token && (!grant || grant.user !== actor)) {
      return fail('forbidden', 'this token was revoked')
    }
    if (grant?.readOnly) {
      return fail('forbidden', 'this token is read only')
    }
    if (teamId === null) {
      return grant?.limits && !grant.limits.noTeam
        ? fail('forbidden', 'this token can only create ideas in the teams it was given')
        : ok(null)
    }
    const team = await this.team(teamId)
    if (!team) {
      return fail('not_found', `no team ${teamId}`)
    }
    if (grant?.limits && !grant.limits.teams.includes(team.id)) {
      return fail('forbidden', `this token wasn't given team ${team.handle}`)
    }
    if (team.archived) {
      return fail('forbidden', `${team.handle} is archived`)
    }
    if (team.createPolicy === 'anyone') {
      return ok(null)
    }
    const role = await this.#role('team', team.id, actor)
    if (team.createPolicy === 'members' && role) {
      return ok(null)
    }
    if (role === 'admin' || role === 'maintainer') {
      return ok(null)
    }
    return fail(
      'forbidden',
      team.createPolicy === 'members'
        ? `only members of ${team.handle} can create ideas in it`
        : `only maintainers and admins of ${team.handle} can create ideas in it`,
    )
  }

  async registerIdea(row: Omit<IdeaRow, 'number' | 'openComments'>): Promise<void> {
    const team = row.team ? await this.team(row.team) : null
    await this.#transaction(async (db) => {
      if (await db.selectFrom('ideas').select('id').where('id', '=', row.id).executeTakeFirst()) {
        return // already registered: a retry
      }
      const place = placeKey(team?.id ?? null, row.owner)
      const inserted = await db
        .insertInto('ideas')
        .values({
          id: row.id,
          title: row.title,
          team: team?.id ?? null,
          owner: row.owner,
          status: row.status,
          latest: row.latest,
          created_at: row.createdAt,
          updated_at: row.updatedAt,
          place,
          number: await nextNumber(db, place),
          description: row.description,
          open_comments: 0,
        })
        // two registrations at once: the second leaves the first alone
        .onConflict((oc) => oc.column('id').doNothing())
        .returning('id')
        .execute()
      if (inserted.length === 0) {
        return
      }
      await this.#search.index(db, row.id, row.title)
      if (team) {
        for (const grant of grantsFromDefaults(team)) {
          await insertGrant(db, row.id, grant, this.#now())
        }
      }
    })
  }

  /** Applies index updates: several (a queue's worth) in one transaction, each on its own should that fail. */
  async updateIdea(input: IndexUpdate | IndexUpdate[]): Promise<void> {
    const rows = Array.isArray(input) ? input : [input]
    const apply = (some: IndexUpdate[]) =>
      this.#transaction(async (db) => {
        for (const row of some) {
          // never move updated_at backwards: coalesced updates can arrive out of order
          const updated = await db
            .updateTable('ideas')
            .set({
              title: row.title,
              status: row.status,
              latest: row.latest,
              updated_at: row.updatedAt,
              description: row.description,
              open_comments: row.openComments,
            })
            .where('id', '=', row.id)
            .where('updated_at', '<=', row.updatedAt)
            .returning('id')
            .execute()
          if (updated.length > 0) {
            await this.#search.index(db, row.id, row.title)
          }
        }
      })
    if (rows.length === 0) {
      return
    }
    try {
      await apply(rows)
    } catch (error) {
      if (rows.length === 1) {
        throw error
      }
      const failed: unknown[] = []
      for (const row of rows) {
        await apply([row]).catch((e: unknown) => failed.push(e))
      }
      if (failed.length > 0) {
        throw failed[0]
      }
    }
  }

  async idea(id: string): Promise<IdeaRow | null> {
    const row = await this.#db.selectFrom('ideas').selectAll().where('id', '=', id).executeTakeFirst()
    return row ? toIdea(row) : null
  }

  async placeOf(id: string): Promise<IdeaPlace | null> {
    const row = await this.idea(id)
    if (!row) {
      return null
    }
    const place = row.team ? (await this.team(row.team))?.handle : `@${(await this.user(row.owner))?.handle}`
    return place ? { id: row.id, place, number: row.number } : null
  }

  async ideaFor(id: string, user: string, token?: string | null): Promise<IdeaAccess | null> {
    const [row, place, permission] = await Promise.all([
      this.idea(id),
      this.placeOf(id),
      this.permission(id, user, token),
    ])
    return row && place ? { permission, team: row.team, place } : null
  }

  async findIdeaFor(place: string, number: number, user: string, token?: string | null): Promise<IdeaPlace | null> {
    const found = await this.findIdea(place, number)
    return found && (await this.permission(found.id, user, token)).view ? found : null
  }

  async findIdea(place: string, number: number): Promise<IdeaPlace | null> {
    const key = place.startsWith('@')
      ? await this.user(place.slice(1)).then((u) => (u ? placeKey(null, u.id) : null))
      : await this.team(place).then((t) => (t ? placeKey(t.id, '') : null))
    if (!key) {
      return null
    }
    const here = await this.#db
      .selectFrom('ideas')
      .select('id')
      .where('place', '=', key)
      .where('number', '=', number)
      .executeTakeFirst()
    const moved = here
      ? null
      : await this.#db
          .selectFrom('idea_aliases')
          .select('idea')
          .where('place', '=', key)
          .where('number', '=', number)
          .executeTakeFirst()
    const id = here?.id ?? moved?.idea
    return id ? this.placeOf(id) : null
  }

  // --- tokens -------------------------------------------------------------------

  async createTokenGrant(actor: string, input: TokenGrantInput): Promise<Result<TokenGrant>> {
    const user = await this.user(actor)
    if (!user || user.inactive) {
      return fail('forbidden', 'unknown or inactive user')
    }
    if (!['me', 'bot-for-me', 'bot'].includes(input.purpose)) {
      return fail('invalid', 'a token’s purpose is me, bot-for-me or bot')
    }
    const bot = input.purpose === 'me' ? null : (input.bot ?? '')
    if (bot !== null && !BOT_NAME.test(bot)) {
      return fail('invalid', 'a bot token needs a bot name: lowercase letters, digits and dashes')
    }
    let targets: Array<{ kind: 'team' | 'idea' | 'no_team'; target: string }> = []
    if (input.limits) {
      for (const ref of input.limits.teams ?? []) {
        const team = await this.team(ref)
        if (!team) {
          return fail('not_found', `no team ${ref}`)
        }
        targets.push({ kind: 'team', target: team.id })
      }
      for (const id of input.limits.ideas ?? []) {
        if (!(await this.permission(id, actor)).view) {
          return fail('not_found', `no idea ${id} that you can see`)
        }
        targets.push({ kind: 'idea', target: id })
      }
      if (input.limits.noTeam) {
        targets.push({ kind: 'no_team', target: '' })
      }
      if (targets.length === 0) {
        return fail('invalid', 'a limited token needs at least one team, idea, or ideas outside teams')
      }
      targets = [...new Map(targets.map((t) => [`${t.kind}:${t.target}`, t])).values()]
    }
    const id = newId('tg')
    const now = this.#now()
    await this.#transaction(async (db) => {
      await db
        .insertInto('token_grants')
        .values({
          id,
          user: actor,
          purpose: input.purpose,
          bot,
          read_only: input.readOnly ? 1 : 0,
          limited: input.limits ? 1 : 0,
          created_at: now,
          revoked_at: null,
        })
        .execute()
      if (targets.length > 0) {
        await db
          .insertInto('token_grant_targets')
          .values(targets.map((t) => ({ token_grant: id, ...t })))
          .execute()
      }
    })
    return ok((await this.tokenGrant(id))!)
  }

  async tokenGrant(id: string): Promise<TokenGrant | null> {
    const row = await this.#db
      .selectFrom('token_grants')
      .selectAll()
      .where('id', '=', id)
      .where('revoked_at', 'is', null)
      .executeTakeFirst()
    if (!row) {
      return null
    }
    const targets =
      row.limited === 1
        ? await this.#db.selectFrom('token_grant_targets').selectAll().where('token_grant', '=', id).execute()
        : []
    return {
      id: row.id,
      user: row.user,
      purpose: row.purpose as TokenGrant['purpose'],
      bot: row.bot,
      readOnly: row.read_only === 1,
      limits:
        row.limited === 1
          ? {
              teams: targets.filter((t) => t.kind === 'team').map((t) => t.target),
              ideas: targets.filter((t) => t.kind === 'idea').map((t) => t.target),
              noTeam: targets.some((t) => t.kind === 'no_team'),
            }
          : null,
      createdAt: Number(row.created_at),
    }
  }

  async revokeTokenGrant(actor: string, id: string): Promise<Result<null>> {
    const revoked = await this.#db
      .updateTable('token_grants')
      .set({ revoked_at: this.#now() })
      .where('id', '=', id)
      .where('user', '=', actor)
      .where('revoked_at', 'is', null)
      .returning('id')
      .execute()
    return revoked.length > 0 ? ok(null) : fail('not_found', `no token grant ${id} of yours`)
  }

  async permission(ideaId: string, user: string, token?: string | null): Promise<Permission> {
    const none: Permission = { view: false, edit: false, share: false, owner: false }
    const idea = await this.#db
      .selectFrom('ideas')
      .select(['owner', 'team'])
      .where('id', '=', ideaId)
      .executeTakeFirst()
    if (!idea) {
      return none
    }
    const base = await this.#basePermission(ideaId, idea, user)
    if (!token || !base.view) {
      return base
    }
    // a token's grant only narrows what its owner can do
    const grant = await this.tokenGrant(token)
    if (!grant || grant.user !== user) {
      return none
    }
    const reaches =
      !grant.limits ||
      (idea.team !== null && grant.limits.teams.includes(idea.team)) ||
      (idea.team === null && grant.limits.noTeam) ||
      grant.limits.ideas.includes(ideaId)
    if (!reaches) {
      return none
    }
    return {
      view: true,
      edit: base.edit && !grant.readOnly,
      share: base.share && !grant.readOnly && !grant.limits,
      owner: base.owner,
    }
  }

  async #basePermission(
    ideaId: string,
    idea: { owner: string; team: string | null },
    user: string,
  ): Promise<Permission> {
    if (idea.owner === user) {
      return { view: true, edit: true, share: true, owner: true }
    }
    const rows = await this.#db
      .selectFrom('grants')
      .select(['can_edit', 'can_share'])
      .where('idea', '=', ideaId)
      .where((eb) => grantAppliesTo(eb, user))
      .execute()
    const teamAdmin = idea.team !== null && (await this.#role('team', idea.team, user)) === 'admin'
    return {
      view: rows.length > 0 || teamAdmin,
      edit: rows.some((r) => r.can_edit === 1),
      // a team's admins can always share its ideas, so access can be fixed when an owner is away
      share: rows.some((r) => r.can_share === 1) || teamAdmin,
      owner: false,
    }
  }

  async grants(ideaId: string): Promise<Grant[]> {
    const rows = await this.#db
      .selectFrom('grants')
      .selectAll()
      .where('idea', '=', ideaId)
      .orderBy('kind')
      .orderBy('subject')
      .execute()
    return rows.map((r) => ({
      subject: toSubject(r.kind, r.subject),
      edit: r.can_edit === 1,
      share: r.can_share === 1,
      reviewer: r.reviewer === 1,
    }))
  }

  /** A grant subject by ID, whether it was named by ID or by handle. */
  async #subject(named: GrantSubject): Promise<Result<GrantSubject>> {
    if (named.kind === 'everyone') {
      return ok(named)
    }
    const found =
      named.kind === 'user'
        ? await this.user(named.id)
        : named.kind === 'group'
          ? await this.group(named.id)
          : await this.team(named.id)
    return found ? ok({ kind: named.kind, id: found.id }) : fail('not_found', `no ${named.kind} ${named.id}`)
  }

  async setGrant(
    actor: string,
    ideaId: string,
    named: GrantSubject,
    access: { edit: boolean; share: boolean } | null,
  ): Promise<Result<Grant[]>> {
    const idea = await this.idea(ideaId)
    if (!idea) {
      return fail('not_found', `no idea ${ideaId}`)
    }
    if (!(await this.permission(ideaId, actor)).share) {
      return fail('forbidden', 'you need share access to change who can see this idea')
    }
    const found = await this.#subject(named)
    if (!found.ok) {
      return found
    }
    const subject = found.value
    if (subject.kind === 'user' && subject.id === idea.owner) {
      return fail('invalid', 'the owner always has full access')
    }
    if (subject.kind === 'everyone' && access && (access.edit || access.share)) {
      return fail('invalid', 'everyone can only be given view access')
    }
    const id = subject.kind === 'everyone' ? '*' : subject.id
    if (access) {
      await insertGrant(
        this.#db,
        ideaId,
        { kind: subject.kind, subject: id, edit: access.edit, share: access.share },
        this.#now(),
        true,
      )
    } else {
      await this.#db
        .deleteFrom('grants')
        .where('idea', '=', ideaId)
        .where('kind', '=', subject.kind)
        .where('subject', '=', id)
        .execute()
    }
    return ok(await this.grants(ideaId))
  }

  async setReviewer(actor: string, ideaId: string, named: GrantSubject, reviewer: boolean): Promise<Result<Grant[]>> {
    const idea = await this.idea(ideaId)
    if (!idea) {
      return fail('not_found', `no idea ${ideaId}`)
    }
    if (!(await this.permission(ideaId, actor)).share) {
      return fail('forbidden', 'you need share access to ask for reviews')
    }
    if (named.kind !== 'user' && named.kind !== 'group') {
      return fail('invalid', 'a reviewer is a person or a group')
    }
    const found = await this.#subject(named)
    if (!found.ok) {
      return found
    }
    const subject = found.value as { kind: 'user' | 'group'; id: string }
    if (subject.kind === 'user' && subject.id === idea.owner) {
      return fail('invalid', "the owner can't review their own idea")
    }
    if (subject.kind === 'group' && (await this.group(subject.id))?.deleted) {
      return fail('invalid', `${named.id} is deleted`)
    }
    if (reviewer) {
      const before = await this.#db
        .selectFrom('grants')
        .select('reviewer')
        .where('idea', '=', ideaId)
        .where('kind', '=', subject.kind)
        .where('subject', '=', subject.id)
        .executeTakeFirst()
      // asking gives view access; access they already have stays as it is
      await this.#db
        .insertInto('grants')
        .values({
          idea: ideaId,
          kind: subject.kind,
          subject: subject.id,
          can_edit: 0,
          can_share: 0,
          reviewer: 1,
          created_at: this.#now(),
        })
        .onConflict((oc) => oc.columns(['idea', 'kind', 'subject']).doUpdateSet({ reviewer: 1 }))
        .execute()
      if (before?.reviewer !== 1) {
        await this.#notifyRequest(ideaId, subject, { user: actor, bot: null, purpose: 'me' })
      }
    } else {
      // taken off the reviewers, they keep their access
      await this.#db
        .updateTable('grants')
        .set({ reviewer: 0 })
        .where('idea', '=', ideaId)
        .where('kind', '=', subject.kind)
        .where('subject', '=', subject.id)
        .execute()
    }
    return ok(await this.grants(ideaId))
  }

  async previewMove(
    actor: string,
    ideaId: string,
    to: string | null,
    adjustments: MoveAdjustments = {},
  ): Promise<Result<MovePreview>> {
    const idea = await this.idea(ideaId)
    if (!idea || !(await this.permission(ideaId, actor)).view) {
      return fail('not_found', `no idea ${ideaId}`)
    }
    if (!(await this.permission(ideaId, actor)).share) {
      return fail('forbidden', 'moving an idea changes who can see it, so it needs share access')
    }
    const target = to === null ? null : await this.team(to)
    if (to !== null && !target) {
      return fail('not_found', `no team ${to}`)
    }
    const allowed = await this.canCreateIdea(actor, target?.id ?? null)
    if (!allowed.ok) {
      return allowed
    }
    const resolved: Required<MoveAdjustments> = { keep: [], skip: [] }
    for (const which of ['keep', 'skip'] as const) {
      for (const named of adjustments[which] ?? []) {
        const found = await this.#subject(named)
        if (!found.ok) {
          return found
        }
        resolved[which].push(found.value)
      }
    }
    const now = await this.grants(ideaId)
    const after = moveGrants(now, idea.team, target, resolved)
    const [before, later] = await Promise.all([
      this.#viewers(idea.owner, idea.team, now),
      this.#viewers(idea.owner, target?.id ?? null, after),
    ])
    return ok({
      from: idea.team,
      to: target?.id ?? null,
      grants: { now, after },
      losing: await this.#difference(before, later),
      gaining: await this.#difference(later, before),
    })
  }

  async moveIdea(
    actor: string,
    ideaId: string,
    to: string | null,
    adjustments: MoveAdjustments = {},
  ): Promise<Result<MovePreview>> {
    const preview = await this.previewMove(actor, ideaId, to, adjustments)
    if (!preview.ok) {
      return preview
    }
    const { after } = preview.value.grants
    await this.#transaction(async (db) => {
      const was = await db
        .selectFrom('ideas')
        .select(['place', 'number', 'owner'])
        .where('id', '=', ideaId)
        .executeTakeFirstOrThrow()
      const place = placeKey(preview.value.to, was.owner)
      if (place !== was.place) {
        // its old address keeps finding it, and its new place gives it the next number there
        await db.insertInto('idea_aliases').values({ place: was.place, number: was.number, idea: ideaId }).execute()
        await db
          .updateTable('ideas')
          .set({ team: preview.value.to, place, number: await nextNumber(db, place) })
          .where('id', '=', ideaId)
          .execute()
      }
      await db.deleteFrom('grants').where('idea', '=', ideaId).execute()
      const now = this.#now()
      for (const g of after) {
        await insertGrant(
          db,
          ideaId,
          {
            kind: g.subject.kind,
            subject: g.subject.kind === 'everyone' ? '*' : g.subject.id,
            edit: g.edit,
            share: g.share,
            reviewer: g.reviewer,
          },
          now,
        )
      }
    })
    // moved into a team while in review: its rules' groups are asked, as if it had just gone out
    const status = (await this.idea(ideaId))?.status
    if (to && (status === 'requesting-review' || status === 'changes-in-progress')) {
      await this.requestRuleGroups(ideaId)
    }
    return preview
  }

  /** Everyone who can view an idea with these grants: user IDs, or 'everyone'. */
  async #viewers(owner: string, team: string | null, grants: Grant[]): Promise<Set<string> | 'everyone'> {
    if (grants.some((g) => g.subject.kind === 'everyone')) {
      return 'everyone'
    }
    const users = new Set<string>([owner])
    const containers: Array<{ kind: ContainerKind; id: string }> = []
    for (const g of grants) {
      if (g.subject.kind === 'user') {
        users.add(g.subject.id)
      } else if (g.subject.kind === 'group' || g.subject.kind === 'team') {
        containers.push({ kind: g.subject.kind, id: g.subject.id })
      }
    }
    for (const c of containers) {
      for (const r of await this.#db
        .selectFrom('memberships')
        .select('user')
        .where('kind', '=', c.kind)
        .where('container', '=', c.id)
        .execute()) {
        users.add(r.user)
      }
    }
    if (team) {
      for (const r of await this.#db
        .selectFrom('memberships')
        .select('user')
        .where('kind', '=', 'team')
        .where('container', '=', team)
        .where('role', '=', 'admin')
        .execute()) {
        users.add(r.user)
      }
    }
    return users
  }

  async #difference(a: Set<string> | 'everyone', b: Set<string> | 'everyone'): Promise<AccessChange> {
    if (b === 'everyone') {
      return { count: 0, people: [], everyone: false }
    }
    if (a === 'everyone') {
      const total = await this.#db
        .selectFrom('users')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirstOrThrow()
      return { count: Math.max(0, Number(total.n) - b.size), people: [], everyone: true }
    }
    const ids = [...a].filter((id) => !b.has(id))
    const people = ids.length
      ? (
          await this.#db
            .selectFrom('users')
            .select(['id', 'handle', 'name', 'inactive'])
            .where('id', 'in', ids.slice(0, 20))
            .orderBy('handle')
            .execute()
        ).map(toUser)
      : []
    return { count: ids.length, people, everyone: false }
  }

  async listIdeas(actor: string, filter: IdeaFilter = {}, token?: string | null): Promise<Page<IdeaListing>> {
    const limit = pageSize(filter.limit)
    const after = decodeCursor(filter.cursor)
    let query = this.#db
      .selectFrom('ideas')
      .selectAll()
      .where((eb) => visibleTo(eb, actor))
      .where((eb) => (token ? tokenReaches(eb, actor, token) : eb.lit(true)))
      .orderBy('updated_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit + 1)
    if (filter.team) {
      query = query.where('team', '=', filter.team)
    }
    if (filter.owner) {
      query = query.where('owner', '=', filter.owner)
    }
    if (filter.status) {
      query = query.where('status', '=', filter.status)
    }
    if (filter.state) {
      const closed = ['closed-accepted', 'closed-rejected']
      const archived = (eb: ExpressionBuilder<DB, 'ideas'>) =>
        eb('team', 'in', eb.selectFrom('teams').select('id').where('archived', '=', 1))
      query =
        filter.state === 'closed'
          ? query.where((eb) => eb.or([eb('status', 'in', closed), archived(eb)]))
          : query.where((eb) =>
              eb.and([eb('status', 'not in', closed), eb.or([eb('team', 'is', null), eb.not(archived(eb))])]),
            )
    }
    if (after) {
      const [updated, id] = [Number(after[0]), String(after[1])]
      query = query.where((eb) =>
        eb.or([eb('updated_at', '<', updated), eb.and([eb('updated_at', '=', updated), eb('id', '<', id)])]),
      )
    }
    const rows = await query.execute()
    const page = rows.slice(0, limit).map(toIdea)
    return {
      items: await this.#listings(page),
      next: rows.length > limit ? encodeCursor([page.at(-1)!.updatedAt, page.at(-1)!.id]) : null,
    }
  }

  /** Rows as lists show them: with their address, and their teams and owners by name, read once per page. */
  async #listings(rows: IdeaRow[]): Promise<IdeaListing[]> {
    const teamIds = [...new Set(rows.flatMap((r) => (r.team ? [r.team] : [])))]
    const ownerIds = [...new Set(rows.map((r) => r.owner))]
    const [teams, owners] = await Promise.all([
      teamIds.length
        ? this.#db.selectFrom('teams').select(['id', 'handle', 'name', 'archived']).where('id', 'in', teamIds).execute()
        : [],
      ownerIds.length
        ? this.#db
            .selectFrom('users')
            .select(['id', 'handle', 'name', 'inactive'])
            .where('id', 'in', ownerIds)
            .execute()
        : [],
    ])
    const team = new Map(
      teams.map((t) => [t.id, { id: t.id, handle: t.handle, name: t.name, archived: t.archived === 1 }]),
    )
    const owner = new Map(
      owners.map((u) => [u.id, { id: u.id, handle: u.handle, name: u.name, inactive: u.inactive === 1 }]),
    )
    return rows.map((row) => {
      const teamInfo = row.team ? (team.get(row.team) ?? null) : null
      const ownerInfo = owner.get(row.owner) ?? { id: row.owner, handle: row.owner, name: row.owner, inactive: false }
      return { ...row, place: teamInfo ? teamInfo.handle : `@${ownerInfo.handle}`, teamInfo, ownerInfo }
    })
  }

  async searchIdeas(actor: string, query: string, limit = 25, token?: string | null): Promise<SearchResult> {
    const terms = searchTerms(query)
    const matching = this.#search.matching(terms, this.#searchCap)
    if (!matching) {
      return { items: [], incomplete: false }
    }
    // access is filtered and ranking applied in the same query, before the limit,
    // so ideas you can't see never crowd out yours
    const q = query
      .trim()
      .toLowerCase()
      .replace(/[%_\\]/g, '')
    const rows = await this.#db
      .selectFrom(matching)
      .innerJoin('ideas', 'ideas.id', 'm.id')
      .selectAll('ideas')
      .where((eb) => visibleTo(eb as unknown as ExpressionBuilder<DB, 'ideas'>, actor))
      .where((eb) =>
        token ? tokenReaches(eb as unknown as ExpressionBuilder<DB, 'ideas'>, actor, token) : eb.lit(true),
      )
      .orderBy(closeness(q))
      .orderBy('ideas.updated_at', 'desc')
      .orderBy('ideas.id', 'desc')
      .limit(Math.min(limit, MAX_PAGE))
      .execute()
    const items = await this.#listings(rows.map(toIdea))
    return { items, incomplete: await this.#search.exceeds(this.#db, terms, this.#searchCap) }
  }
}

// --- access, as SQL -----------------------------------------------------------------

/** A grant row applies to a user directly, to everyone, or to a group or team they're in. */
function grantAppliesTo(eb: ExpressionBuilder<DB, 'grants'>, user: string): Expression<SqlBool> {
  return eb.or([
    eb.and([eb('grants.kind', '=', 'user'), eb('grants.subject', '=', user)]),
    eb('grants.kind', '=', 'everyone'),
    eb.and([
      eb('grants.kind', 'in', ['group', 'team']),
      eb(
        'grants.subject',
        'in',
        eb
          .selectFrom('memberships')
          .select('memberships.container')
          .where('memberships.user', '=', user)
          .whereRef('memberships.kind', '=', 'grants.kind'),
      ),
    ]),
  ])
}

/** The visibility filter, as part of the list's own indexed query (scale concern 2). */
function visibleTo(eb: ExpressionBuilder<DB, 'ideas'>, user: string): Expression<SqlBool> {
  return eb.or([
    eb('ideas.owner', '=', user),
    eb.exists(
      eb
        .selectFrom('grants')
        .select('grants.idea')
        .whereRef('grants.idea', '=', 'ideas.id')
        .where((g) => grantAppliesTo(g, user)),
    ),
    eb(
      'ideas.team',
      'in',
      eb
        .selectFrom('memberships')
        .select('memberships.container')
        .where('memberships.user', '=', user)
        .where('memberships.kind', '=', 'team')
        .where('memberships.role', '=', 'admin'),
    ),
  ])
}

/**
 * A token grant's reach, as part of the same indexed query: the grant is still
 * in force and its owner's, and either unlimited or naming the idea's team, the
 * idea itself, or (for an idea outside any team) ideas outside teams.
 */
function tokenReaches(eb: ExpressionBuilder<DB, 'ideas'>, user: string, token: string): Expression<SqlBool> {
  return eb.exists(
    eb
      .selectFrom('token_grants')
      .select('token_grants.id')
      .where('token_grants.id', '=', token)
      .where('token_grants.user', '=', user)
      .where('token_grants.revoked_at', 'is', null)
      .where((g) =>
        g.or([
          g('token_grants.limited', '=', 0),
          g.exists(
            g
              .selectFrom('token_grant_targets')
              .select('token_grant_targets.token_grant')
              .whereRef('token_grant_targets.token_grant', '=', 'token_grants.id')
              .where((t) =>
                t.or([
                  t.and([
                    t('token_grant_targets.kind', '=', 'team'),
                    t('token_grant_targets.target', '=', t.ref('ideas.team')),
                  ]),
                  t.and([
                    t('token_grant_targets.kind', '=', 'idea'),
                    t('token_grant_targets.target', '=', t.ref('ideas.id')),
                  ]),
                  t.and([t('token_grant_targets.kind', '=', 'no_team'), t('ideas.team', 'is', null)]),
                ]),
              ),
          ),
        ]),
      ),
  )
}

const BOT_NAME = /^[a-z0-9][a-z0-9-]{0,38}$/

type GrantRow = { kind: DB['grants']['kind']; subject: string; edit: boolean; share: boolean; reviewer?: boolean }

const sameSubject = (a: GrantSubject, b: GrantSubject) =>
  a.kind === b.kind && (a.kind === 'everyone' || a.id === (b as { id: string }).id)

/** The grants after a move: the old team's member grant goes, the new team's defaults come, with the wizard's adjustments. */
function moveGrants(now: Grant[], from: string | null, to: Team | null, adjustments: MoveAdjustments): Grant[] {
  const keep = adjustments.keep ?? []
  const skip = adjustments.skip ?? []
  const after = now.filter(
    (g) =>
      !(from && g.subject.kind === 'team' && g.subject.id === from && to?.id !== from) ||
      keep.some((k) => sameSubject(k, g.subject)),
  )
  if (to) {
    for (const d of grantsFromDefaults(to)) {
      const subject = toSubject(d.kind, d.subject)
      if (skip.some((s) => sameSubject(s, subject))) {
        continue
      }
      const existing = after.find((g) => sameSubject(g.subject, subject))
      if (existing) {
        existing.edit ||= d.edit
        existing.share ||= d.share
      } else {
        after.push({ subject, edit: d.edit, share: d.share, reviewer: false })
      }
    }
  }
  return after
}

function grantsFromDefaults(team: Team): GrantRow[] {
  const out: GrantRow[] = []
  if (team.defaults.members !== 'none') {
    out.push({ kind: 'team', subject: team.id, edit: team.defaults.members === 'edit', share: false })
  }
  if (team.defaults.public) {
    out.push({ kind: 'everyone', subject: '*', edit: false, share: false })
  }
  for (const g of team.defaults.groups) {
    out.push({ kind: 'group', subject: g.group, edit: g.edit, share: false })
  }
  return out
}

async function insertGrant(db: Kysely<DB>, idea: string, grant: GrantRow, now: number, replace = false): Promise<void> {
  await db
    .insertInto('grants')
    .values({
      idea,
      kind: grant.kind,
      subject: grant.subject,
      can_edit: grant.edit ? 1 : 0,
      can_share: grant.share ? 1 : 0,
      reviewer: grant.reviewer ? 1 : 0,
      created_at: now,
    })
    .onConflict((oc) =>
      replace
        ? oc
            .columns(['idea', 'kind', 'subject'])
            .doUpdateSet({ can_edit: grant.edit ? 1 : 0, can_share: grant.share ? 1 : 0 })
        : oc.columns(['idea', 'kind', 'subject']).doNothing(),
    )
    .execute()
}

function toSubject(kind: DB['grants']['kind'], subject: string): GrantSubject {
  return kind === 'everyone' ? { kind } : { kind, id: subject }
}

/** Drops LIKE's wildcards from user input (escaping them differs between SQLite and Postgres). */
/**
 * How closely a title matches, as SQL (the same in SQLite and Postgres): an
 * exact match first, then titles that start with it, then a word that starts
 * with it, then anywhere.
 */
function closeness(q: string) {
  const title = raw`lower(ideas.title)`
  return raw`CASE WHEN ${title} = ${q} THEN 0 WHEN ${title} LIKE ${`${q}%`} THEN 1 WHEN ${title} LIKE ${`% ${q}%`} OR ${title} LIKE ${`%-${q}%`} THEN 2 ELSE 3 END`
}

function likeEscape(text: string): string {
  return text.replace(/[%_\\]/g, '')
}

function isUniqueViolation(error: unknown): boolean {
  const message = String((error as { message?: unknown })?.message ?? error)
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE|duplicate key value/i.test(message)
}
