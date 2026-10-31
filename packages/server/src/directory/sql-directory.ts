// The directory on SQL, through Kysely: what the directory actor runs, and
// what a Postgres implementation would mostly share. Writes are correct when
// they run concurrently: unique keys, upserts and transactions, never the order
// a queue applies them in.
import { type Expression, type ExpressionBuilder, type Kysely, type SqlBool, sql as raw } from 'kysely'
import type { Sql } from '../idea/sql.ts'
import { sqliteKysely } from './kysely.ts'
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
  type AccessChange,
  type IdeaFilter,
  type IdeaRow,
  type Member,
  type MoveAdjustments,
  type MovePreview,
  type Page,
  type Permission,
  type Result,
  type SearchResult,
  type Team,
  type TeamDefaults,
  type User,
} from './types.ts'

const HANDLE = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/
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
})

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
    return (await this.user(user.id))!
  }

  async user(idOrHandle: string): Promise<User | null> {
    const handle = idOrHandle.toLowerCase().replace(/^@/, '')
    const row = await this.#db
      .selectFrom('users')
      .select(['id', 'handle', 'name', 'inactive'])
      .where((eb) => eb.or([eb('id', '=', idOrHandle), eb('handle', '=', handle)]))
      .executeTakeFirst()
    return row ? toUser(row) : null
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
            .values({ ...base, archived: 0, create_policy: 'members', defaults: JSON.stringify(DEFAULT_TEAM_DEFAULTS) })
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
    if (kind === 'team') {
      const row = await this.#db
        .selectFrom('teams')
        .selectAll()
        .where((eb) => eb.or([eb('id', '=', idOrHandle), eb('handle', '=', idOrHandle.toLowerCase())]))
        .executeTakeFirst()
      return row ? this.#toTeam(row, await members(row.id)) : null
    }
    const row = await this.#db
      .selectFrom('groups')
      .selectAll()
      .where((eb) => eb.or([eb('id', '=', idOrHandle), eb('handle', '=', idOrHandle.toLowerCase())]))
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
    changes: { createPolicy?: CreatePolicy; defaults?: TeamDefaults },
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
      for (const g of d.groups) {
        if (!(await this.group(g.group))) {
          return fail('invalid', `no group ${g.group}`)
        }
      }
    }
    await this.#db
      .updateTable('teams')
      .set({
        ...(changes.createPolicy ? { create_policy: changes.createPolicy } : {}),
        ...(changes.defaults ? { defaults: JSON.stringify(changes.defaults) } : {}),
      })
      .where('id', '=', team.id)
      .execute()
    return ok((await this.team(team.id))!)
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

  async canCreateIdea(actor: string, teamId: string | null): Promise<Result<null>> {
    const user = await this.user(actor)
    if (!user) {
      return fail('forbidden', 'unknown user')
    }
    if (user.inactive) {
      return fail('forbidden', 'inactive users can’t create ideas')
    }
    if (teamId === null) {
      return ok(null)
    }
    const team = await this.team(teamId)
    if (!team) {
      return fail('not_found', `no team ${teamId}`)
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

  async registerIdea(row: IdeaRow): Promise<void> {
    const team = row.team ? await this.team(row.team) : null
    await this.#transaction(async (db) => {
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
        })
        .onConflict((oc) => oc.column('id').doNothing())
        .returning('id')
        .execute()
      if (inserted.length === 0) {
        return // already registered: a retry
      }
      await this.#search.index(db, row.id, row.title)
      if (team) {
        for (const grant of grantsFromDefaults(team)) {
          await insertGrant(db, row.id, grant, this.#now())
        }
      }
    })
  }

  async updateIdea(row: Pick<IdeaRow, 'id' | 'title' | 'status' | 'latest' | 'updatedAt'>): Promise<void> {
    await this.#transaction(async (db) => {
      // never move updated_at backwards: coalesced updates can arrive out of order
      const updated = await db
        .updateTable('ideas')
        .set({ title: row.title, status: row.status, latest: row.latest, updated_at: row.updatedAt })
        .where('id', '=', row.id)
        .where('updated_at', '<=', row.updatedAt)
        .returning('id')
        .execute()
      if (updated.length > 0) {
        await this.#search.index(db, row.id, row.title)
      }
    })
  }

  async idea(id: string): Promise<IdeaRow | null> {
    const row = await this.#db.selectFrom('ideas').selectAll().where('id', '=', id).executeTakeFirst()
    return row ? toIdea(row) : null
  }

  async permission(ideaId: string, user: string): Promise<Permission> {
    const none: Permission = { view: false, edit: false, share: false, owner: false }
    const idea = await this.#db
      .selectFrom('ideas')
      .select(['owner', 'team'])
      .where('id', '=', ideaId)
      .executeTakeFirst()
    if (!idea) {
      return none
    }
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
    }))
  }

  async setGrant(
    actor: string,
    ideaId: string,
    subject: GrantSubject,
    access: { edit: boolean; share: boolean } | null,
  ): Promise<Result<Grant[]>> {
    const idea = await this.idea(ideaId)
    if (!idea) {
      return fail('not_found', `no idea ${ideaId}`)
    }
    if (!(await this.permission(ideaId, actor)).share) {
      return fail('forbidden', 'you need share access to change who can see this idea')
    }
    if (subject.kind === 'user') {
      if (subject.id === idea.owner) {
        return fail('invalid', 'the owner always has full access')
      }
      if (!(await this.user(subject.id))) {
        return fail('not_found', `no user ${subject.id}`)
      }
    }
    if (subject.kind === 'group' && !(await this.group(subject.id))) {
      return fail('not_found', `no group ${subject.id}`)
    }
    if (subject.kind === 'team' && !(await this.team(subject.id))) {
      return fail('not_found', `no team ${subject.id}`)
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
    const now = await this.grants(ideaId)
    const after = moveGrants(now, idea.team, target, adjustments)
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
      await db.updateTable('ideas').set({ team: preview.value.to }).where('id', '=', ideaId).execute()
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
          },
          now,
        )
      }
    })
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

  async listIdeas(actor: string, filter: IdeaFilter = {}): Promise<Page<IdeaRow>> {
    const limit = pageSize(filter.limit)
    const after = decodeCursor(filter.cursor)
    let query = this.#db
      .selectFrom('ideas')
      .selectAll()
      .where((eb) => visibleTo(eb, actor))
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
    if (after) {
      const [updated, id] = [Number(after[0]), String(after[1])]
      query = query.where((eb) =>
        eb.or([eb('updated_at', '<', updated), eb.and([eb('updated_at', '=', updated), eb('id', '<', id)])]),
      )
    }
    const rows = await query.execute()
    const page = rows.slice(0, limit).map(toIdea)
    return { items: page, next: rows.length > limit ? encodeCursor([page.at(-1)!.updatedAt, page.at(-1)!.id]) : null }
  }

  async searchIdeas(actor: string, query: string, limit = 25): Promise<SearchResult> {
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
      .orderBy(closeness(q))
      .orderBy('ideas.updated_at', 'desc')
      .orderBy('ideas.id', 'desc')
      .limit(Math.min(limit, MAX_PAGE))
      .execute()
    const items = rows.map(toIdea)
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

type GrantRow = { kind: DB['grants']['kind']; subject: string; edit: boolean; share: boolean }

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
        after.push({ subject, edit: d.edit, share: d.share })
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
