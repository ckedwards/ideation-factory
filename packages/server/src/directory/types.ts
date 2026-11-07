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
  /** Its number in its team, or among its owner's own ideas: mobile/idea/9. */
  number: number
  description: string
  /** Comment threads not resolved yet. */
  openComments: number
}

/** An idea as lists show it: its row, its address, and its team and owner by name. */
export interface IdeaListing extends IdeaRow {
  place: string
  teamInfo: { id: string; handle: string; name: string; archived: boolean } | null
  ownerInfo: User
}

/** What an idea's actor sends the index after it changes. */
export type IndexUpdate = Pick<
  IdeaRow,
  'id' | 'title' | 'status' | 'latest' | 'updatedAt' | 'description' | 'openComments'
>

/** Where an idea is found: its team's handle, or @ and its owner's handle, and its number there. */
export interface IdeaPlace {
  id: string
  /** `mobile`, or `@riley` for Riley's own idea */
  place: string
  number: number
}

/** What a person can do with an idea. Edit and share each include view. */
export interface Permission {
  view: boolean
  edit: boolean
  share: boolean
  owner: boolean
}

export type GrantSubject =
  | { kind: 'user'; id: string }
  | { kind: 'group'; id: string }
  | { kind: 'team'; id: string }
  | { kind: 'everyone' }

export interface Grant {
  subject: GrantSubject
  edit: boolean
  share: boolean
}

/** Who would lose or gain access: counts, with the first names. */
export interface AccessChange {
  count: number
  people: User[]
  /** True if the change is that everyone with an account can see it (or no longer can). */
  everyone: boolean
}

/** What moving an idea to another team (or out of one) would change, for the move wizard. */
export interface MovePreview {
  from: string | null
  to: string | null
  grants: { now: Grant[]; after: Grant[] }
  losing: AccessChange
  gaining: AccessChange
}

/** Changes to the move's default effect, chosen in the wizard. */
export interface MoveAdjustments {
  /** Grants the move would remove (the old team's members) to keep instead. */
  keep?: GrantSubject[]
  /** Grants the new team's defaults would add, to leave out. */
  skip?: GrantSubject[]
}

export interface SearchResult {
  items: IdeaListing[]
  incomplete: boolean
}

/**
 * What a token was made to do, chosen when it was approved. It can only narrow
 * what its owner can do: a read-only token writes nothing, and a limited one
 * reaches only its targets' ideas and can't share, move ideas or manage teams.
 */
export interface TokenGrant {
  id: string
  user: string
  purpose: 'me' | 'bot-for-me' | 'bot'
  bot: string | null
  readOnly: boolean
  /** null: every idea its owner can see. Otherwise its reach, by team ID and idea ID. */
  limits: TokenLimits | null
  createdAt: number
}

export interface TokenLimits {
  teams: string[]
  ideas: string[]
  /** Ideas outside any team. */
  noTeam: boolean
}

export type TokenGrantInput = {
  purpose: TokenGrant['purpose']
  bot?: string
  readOnly?: boolean
  /** Teams by ID or handle, ideas by ID. */
  limits?: { teams?: string[]; ideas?: string[]; noTeam?: boolean } | null
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
  /**
   * A person changed where accounts are kept (sign-in): their name, status,
   * handle (confirmed after single sign-on made the account) or email (changed
   * at the identity provider). Null if there's no such person.
   */
  updateUser(
    id: string,
    changes: { name?: string; inactive?: boolean; handle?: string; email?: string },
  ): Promise<User | null>
  /** A person by ID or handle. */
  user(idOrHandle: string): Promise<User | null>
  findUsers(query: string, limit?: number): Promise<User[]>

  // teams and groups
  createTeam(actor: string, input: { handle: string; name: string; description?: string }): Promise<Result<Team>>
  createGroup(actor: string, input: { handle: string; name: string; description?: string }): Promise<Result<Group>>
  team(idOrHandle: string): Promise<Team | null>
  group(idOrHandle: string): Promise<Group | null>
  teams(options?: { query?: string; cursor?: string; limit?: number }): Promise<Page<Team>>
  groups(options?: { query?: string; cursor?: string; limit?: number }): Promise<Page<Group>>
  updateTeam(
    actor: string,
    team: string,
    changes: { createPolicy?: CreatePolicy; defaults?: TeamDefaults },
  ): Promise<Result<Team>>
  members(kind: ContainerKind, id: string, options?: { cursor?: string; limit?: number }): Promise<Page<Member>>
  addMember(actor: string, kind: ContainerKind, id: string, user: string, role?: Role): Promise<Result<Member>>
  removeMember(actor: string, kind: ContainerKind, id: string, user: string): Promise<Result<null>>
  requestToJoin(actor: string, kind: ContainerKind, id: string): Promise<Result<{ requested: boolean }>>
  joinRequests(actor: string, kind: ContainerKind, id: string): Promise<Result<User[]>>
  decide(actor: string, kind: ContainerKind, id: string, user: string, approve: boolean): Promise<Result<null>>

  // tokens: what each was made to do (see TokenGrant)
  createTokenGrant(actor: string, input: TokenGrantInput): Promise<Result<TokenGrant>>
  /** A token grant, if it's still in force. */
  tokenGrant(id: string): Promise<TokenGrant | null>
  /** Ends a token grant: tokens made with it stop working. Only its owner can. */
  revokeTokenGrant(actor: string, id: string): Promise<Result<null>>

  // ideas: the index, access and lists. `token` is the caller's token grant,
  // if their token has one: it narrows what they can do.
  canCreateIdea(actor: string, team: string | null, token?: string | null): Promise<Result<null>>
  /** Indexes a new idea, numbers it in its place, and gives it its team's default access. Safe to repeat. */
  registerIdea(row: Omit<IdeaRow, 'number' | 'openComments'>): Promise<void>
  /** Updates an idea's index row (its team and owner don't change here). */
  updateIdea(row: IndexUpdate): Promise<void>
  idea(id: string): Promise<IdeaRow | null>
  /** Where an idea is now. */
  placeOf(id: string): Promise<IdeaPlace | null>
  /**
   * The idea at a place (`mobile`, `@riley`) and number, where it is now: one
   * that has moved since is found at its old address too. Says nothing of
   * who can see it.
   */
  findIdea(place: string, number: number): Promise<IdeaPlace | null>
  permission(idea: string, user: string, token?: string | null): Promise<Permission>
  grants(idea: string): Promise<Grant[]>
  setGrant(
    actor: string,
    idea: string,
    subject: GrantSubject,
    access: { edit: boolean; share: boolean } | null,
  ): Promise<Result<Grant[]>>
  /** What moving an idea would change, before anything changes. */
  previewMove(
    actor: string,
    idea: string,
    to: string | null,
    adjustments?: MoveAdjustments,
  ): Promise<Result<MovePreview>>
  /**
   * Moves an idea into, out of, or to another team: the old team's member grant
   * goes, the new team's defaults are added, and it gets the next number in its
   * new place (its old address still finds it).
   */
  moveIdea(actor: string, idea: string, to: string | null, adjustments?: MoveAdjustments): Promise<Result<MovePreview>>
  listIdeas(actor: string, filter?: IdeaFilter, token?: string | null): Promise<Page<IdeaListing>>
  /**
   * Ideas the actor can see whose titles contain the query's terms (each at
   * least 3 characters; shorter ones are ignored). `incomplete` means more
   * ideas matched than one search checks, so only the best-ranked were.
   */
  searchIdeas(actor: string, query: string, limit?: number, token?: string | null): Promise<SearchResult>
}
