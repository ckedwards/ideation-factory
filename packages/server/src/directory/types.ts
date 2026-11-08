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

/**
 * A group rule: one approval from any of its groups, or one from each. With
 * `request`, its groups are asked to review when an idea goes out for review.
 */
export interface GroupRule {
  mode: 'any' | 'each'
  groups: string[]
  request: boolean
}

/** What an idea in a team needs before it can be closed as accepted. */
export interface TeamRequirements {
  /** Approvals from people on the latest version, in all; 0 for no minimum. */
  approvals: number
  groups: GroupRule[]
  /** Every comment thread resolved. */
  resolved: boolean
}

export const NO_REQUIREMENTS: TeamRequirements = { approvals: 0, groups: [], resolved: false }

/** Who did something: a person, or a bot (for a person, or of its own). */
export interface ActorRef {
  user: string
  bot: string | null
  purpose: 'me' | 'bot-for-me' | 'bot'
}

/**
 * Why someone hears about an idea, most direct first: they wrote it, were
 * asked to review it (by name, or through a group), took part, or chose to.
 */
export const INBOX_REASONS = ['author', 'review-requested', 'group-review', 'participating', 'subscribed'] as const
export type InboxReason = (typeof INBOX_REASONS)[number]

export type InboxEventKind =
  | 'version'
  | 'comment'
  | 'suggestion'
  | 'reply'
  | 'review'
  | 'dismissed'
  | 'status'
  | 'decided'
  | 'requested'

/** Something that happened to an idea, for inboxes: who, when, and what (by kind). */
export interface InboxEvent {
  kind: InboxEventKind
  actor: ActorRef
  at: number
  detail: Record<string, unknown>
}

/** An idea's events from one write, sent by its actor through the directory's queue. */
export interface NotifyBatch {
  idea: string
  events: InboxEvent[]
}

/** An inbox row: the idea as lists show it, and what's happened since you last looked. */
export interface InboxRow {
  idea: IdeaListing
  reason: InboxReason
  /** Events since it was last read; 0 once read. */
  newCount: number
  done: boolean
  updatedAt: number
  latest: InboxEvent
}

export interface InboxFilter {
  /** The Done list, rather than the inbox. */
  done?: boolean
  reason?: InboxReason
  /** Only ideas with something new. */
  unread?: boolean
  cursor?: string
  limit?: number
}

/** One requirement, checked against an idea. */
export type RequirementCheck =
  | { kind: 'approvals'; need: number; have: number; met: boolean }
  | {
      kind: 'groups'
      mode: 'any' | 'each'
      /** Each group, and who in it approved; a deleted group's approvals don't count. */
      groups: Array<{ id: string; handle: string; name: string; deleted: boolean; approvedBy: string[] }>
      met: boolean
      /** Can't be met: a deleted group in an "each of" rule, or every group of an "any of". */
      broken: boolean
    }
  | { kind: 'resolved'; open: number; met: boolean }

/** A team's requirements checked against an idea: met when every check is. */
export interface RequirementsCheck {
  met: boolean
  checks: RequirementCheck[]
}

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
  requirements: TeamRequirements
}

export interface Group extends Container {
  kind: 'group'
  deleted: boolean
}

/**
 * How long a handle someone left stays theirs: nobody else can take it, so
 * links to it and mentions of it can't start leading to someone new. Its
 * owner can take it back, and a site admin can release it sooner.
 */
export const HANDLE_PARKED_MS = 90 * 24 * 60 * 60 * 1000

export interface Member {
  user: User
  role: Role
}

/** The teams and groups someone is in, with their role, and those they've asked to join. */
export interface Memberships {
  teams: Array<{ id: string; handle: string; name: string; archived: boolean; role: Role }>
  groups: Array<{ id: string; handle: string; name: string; role: Role }>
  requested: Array<{ kind: ContainerKind; id: string }>
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

/** An idea as one reader may see it: what they can do, its team, and its address. */
export interface IdeaAccess {
  permission: Permission
  team: string | null
  place: IdeaPlace
}

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
  /** Asked to review it (a person or a group). */
  reviewer: boolean
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
  /** Open, or closed: closed as accepted or rejected, or in an archived team. */
  state?: 'open' | 'closed'
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
    /** Whether a changed handle's old one keeps leading to them (not for a suggestion they replaced). */
    options?: { keepOldHandle?: boolean },
  ): Promise<User | null>
  /** A person by ID or handle. */
  user(idOrHandle: string): Promise<User | null>
  /** People by ID, in one read; anyone not found is left out. */
  users(ids: string[]): Promise<User[]>
  findUsers(query: string, limit?: number): Promise<User[]>

  // teams and groups
  createTeam(actor: string, input: { handle: string; name: string; description?: string }): Promise<Result<Team>>
  createGroup(actor: string, input: { handle: string; name: string; description?: string }): Promise<Result<Group>>
  team(idOrHandle: string): Promise<Team | null>
  group(idOrHandle: string): Promise<Group | null>
  teams(options?: { query?: string; cursor?: string; limit?: number }): Promise<Page<Team>>
  groups(options?: { query?: string; cursor?: string; limit?: number }): Promise<Page<Group>>
  /** A team's settings, for its admins; a new handle keeps the old one leading to it. */
  updateTeam(
    actor: string,
    team: string,
    changes: {
      createPolicy?: CreatePolicy
      defaults?: TeamDefaults
      handle?: string
      name?: string
      description?: string
    },
  ): Promise<Result<Team>>
  /** A team's approval requirements, for its maintainers and admins: groups are named by ID or handle, and stored by ID. */
  setRequirements(actor: string, team: string, requirements: TeamRequirements): Promise<Result<Team>>
  /**
   * An idea's team's requirements checked: `approvers` are the people whose
   * approvals count (on the latest version), `open` its open threads. An idea
   * outside a team, or in an archived one, has none.
   */
  checkRequirements(idea: string, approvers: string[], open: number): Promise<RequirementsCheck>
  /**
   * Asks the groups of the idea's team's rules that say so to review it (an
   * idea going out for review). Skips deleted groups and those already
   * reviewing; gives the rest view access. Says which it asked.
   */
  requestRuleGroups(idea: string): Promise<string[]>
  // the inbox: what people hear about the ideas they're involved in
  /** Writes an idea's events to the inboxes of those who hear about it (from the idea actor, through the queue). */
  notify(batch: NotifyBatch): Promise<void>
  /** A person's inbox (or Done list): one row per idea they can still see, newest first. */
  inbox(user: string, filter?: InboxFilter, token?: string | null): Promise<Page<InboxRow>>
  /** How many ideas in the inbox have something new. */
  unreadCount(user: string, token?: string | null): Promise<number>
  /** Marks ideas in a person's inbox read, done or back in the inbox; `null` for all of them. Says how many changed. */
  markInbox(user: string, ideas: string[] | null, change: { read?: boolean; done?: boolean }): Promise<number>
  /** Whether a person hears about an idea, and why (null when they don't). */
  subscription(user: string, idea: string): Promise<{ subscribed: boolean; reason: InboxReason | null }>
  /** Subscribes to an idea, or unsubscribes (which stops everything but review requests). */
  setSubscription(
    user: string,
    idea: string,
    subscribed: boolean,
  ): Promise<Result<{ subscribed: boolean; reason: InboxReason | null }>>
  notificationSettings(user: string): Promise<{ ownBots: boolean }>
  setNotificationSettings(user: string, settings: { ownBots: boolean }): Promise<{ ownBots: boolean }>
  /**
   * Frees a handle, a site admin's decision: a team holding it is renamed to
   * `replacement`, and no old handle leads anywhere any more. (A person
   * holding one is renamed through sign-in first, which keeps its accounts in
   * step; this then drops the alias that left.) Says who held it.
   */
  releaseHandle(kind: 'user' | 'team', handle: string, replacement: string): Promise<{ owner: string | null }>
  /**
   * Until when a handle someone left is parked against `requester` (a person's
   * or a team's ID, or null for someone new): null if it isn't, as when it's
   * their own old handle, or it was left long enough ago.
   */
  parkedUntil(kind: 'user' | 'team', handle: string, requester: string | null): Promise<number | null>
  members(kind: ContainerKind, id: string, options?: { cursor?: string; limit?: number }): Promise<Page<Member>>
  memberships(user: string): Promise<Memberships>
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
   * What get_idea needs from the directory, in one call: what `user` can do
   * with the idea (through `token`'s grant, if it has one), its team, and its
   * address. Null if there's no such idea.
   */
  ideaFor(id: string, user: string, token?: string | null): Promise<IdeaAccess | null>
  /** findIdea, only if `user` can see the idea: otherwise null, as if there were none. */
  findIdeaFor(place: string, number: number, user: string, token?: string | null): Promise<IdeaPlace | null>
  /**
   * The idea at a place (`mobile`, `@riley`) and number, where it is now: one
   * that has moved since is found at its old address too. Says nothing of
   * who can see it.
   */
  findIdea(place: string, number: number): Promise<IdeaPlace | null>
  permission(idea: string, user: string, token?: string | null): Promise<Permission>
  grants(idea: string): Promise<Grant[]>
  /** Asks a person or group to review an idea (giving them view access), or takes them off its reviewers (leaving their access). Needs share. */
  setReviewer(actor: string, idea: string, subject: GrantSubject, reviewer: boolean): Promise<Result<Grant[]>>
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
