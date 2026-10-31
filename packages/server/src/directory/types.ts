// What the directory deals in, and the interface every implementation (the
// directory actor's SQLite now, Postgres later) provides.
import type { ContainerKind, GrantKind, Role } from './schema.ts'

export type { ContainerKind, GrantKind, Role }

export type DirectoryErrorCode = 'not_found' | 'exists' | 'invalid' | 'forbidden'
export type Result<T> = { ok: true; value: T } | { ok: false; error: { code: DirectoryErrorCode; message: string } }

export interface User {
  id: string
  handle: string
  name: string
  inactive: boolean
}

export type CreatePolicy = 'anyone' | 'members' | 'maintainers'

/** What a new idea in a team starts with. */
export interface TeamDefaults {
  /** What the team's members get. */
  members: 'none' | 'view' | 'edit'
  /** Whether new ideas start public (everyone with an account can view). */
  public: boolean
  /** Groups that get access to new ideas. */
  groups: Array<{ group: string; edit: boolean }>
}

export const DEFAULT_TEAM_DEFAULTS: TeamDefaults = { members: 'view', public: false, groups: [] }

export interface Container {
  kind: ContainerKind
  id: string
  handle: string
  name: string
  description: string
  createdAt: number
  members: number
}

export interface Team extends Container {
  kind: 'team'
  archived: boolean
  createPolicy: CreatePolicy
  defaults: TeamDefaults
}

export interface Group extends Container {
  kind: 'group'
  deleted: boolean
}

export interface Member {
  user: User
  role: Role
}

export interface Page<T> {
  items: T[]
  /** Pass back to get the next page; null on the last one. */
  next: string | null
}

export interface IdeaRow {
  id: string
  title: string
  team: string | null
  owner: string
  status: string
  latest: number
  createdAt: number
  updatedAt: number
}

/** What a person can do with an idea. Edit and share each include view. */
export interface Permission {
  view: boolean
  edit: boolean
  share: boolean
  owner: boolean
}

export type GrantSubject = { kind: 'user'; id: string } | { kind: 'group'; id: string } | { kind: 'team'; id: string } | { kind: 'everyone' }

export interface Grant {
  subject: GrantSubject
  edit: boolean
  share: boolean
}

export interface IdeaFilter {
  team?: string
  owner?: string
  status?: string
  cursor?: string
  limit?: number
}

export interface Directory {
  // people
  ensureUser(user: { id: string; handle: string; name: string; email?: string }): Promise<User>
  user(id: string): Promise<User | null>
  findUsers(query: string, limit?: number): Promise<User[]>

  // teams and groups
  createTeam(actor: string, input: { handle: string; name: string; description?: string }): Promise<Result<Team>>
  createGroup(actor: string, input: { handle: string; name: string; description?: string }): Promise<Result<Group>>
  team(idOrHandle: string): Promise<Team | null>
  group(idOrHandle: string): Promise<Group | null>
  teams(options?: { query?: string; cursor?: string; limit?: number }): Promise<Page<Team>>
  groups(options?: { query?: string; cursor?: string; limit?: number }): Promise<Page<Group>>
  updateTeam(actor: string, team: string, changes: { createPolicy?: CreatePolicy; defaults?: TeamDefaults }): Promise<Result<Team>>
  members(kind: ContainerKind, id: string, options?: { cursor?: string; limit?: number }): Promise<Page<Member>>
  addMember(actor: string, kind: ContainerKind, id: string, user: string, role?: Role): Promise<Result<Member>>
  removeMember(actor: string, kind: ContainerKind, id: string, user: string): Promise<Result<null>>
  requestToJoin(actor: string, kind: ContainerKind, id: string): Promise<Result<{ requested: boolean }>>
  joinRequests(actor: string, kind: ContainerKind, id: string): Promise<Result<User[]>>
  decide(actor: string, kind: ContainerKind, id: string, user: string, approve: boolean): Promise<Result<null>>

  // ideas: the index, access and lists
  canCreateIdea(actor: string, team: string | null): Promise<Result<null>>
  /** Indexes a new idea and gives it its team's default access. Safe to repeat. */
  registerIdea(row: IdeaRow): Promise<void>
  /** Updates an idea's index row (its team and owner don't change here). */
  updateIdea(row: Pick<IdeaRow, 'id' | 'title' | 'status' | 'latest' | 'updatedAt'>): Promise<void>
  idea(id: string): Promise<IdeaRow | null>
  permission(idea: string, user: string): Promise<Permission>
  grants(idea: string): Promise<Grant[]>
  setGrant(actor: string, idea: string, subject: GrantSubject, access: { edit: boolean; share: boolean } | null): Promise<Result<Grant[]>>
  listIdeas(actor: string, filter?: IdeaFilter): Promise<Page<IdeaRow>>
  searchIdeas(actor: string, query: string, limit?: number): Promise<IdeaRow[]>
}
