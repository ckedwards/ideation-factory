// Schemas shared by the operations. The server's handlers are typed by these,
// so if what the server returns drifts from what's published, it doesn't compile.
import { Batch, DraftChange } from '@ideaf/core'
import { z } from 'zod'

export { Batch, DraftChange }

export const IdeaId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'an idea ID: lowercase letters, digits and dashes')
export const FileId = z.string().regex(/^f[0-9]+$/)
export const CommentId = z.string().regex(/^c[0-9]+$/)
/** A version number in a query string. */
export const VersionParam = z.coerce.number().int().positive().optional()

export const Caller = z.object({
  user: z.string(),
  bot: z.string().nullable(),
  purpose: z.enum(['me', 'bot-for-me', 'bot']),
})
export type Caller = z.infer<typeof Caller>

export const Anchor = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('file'), file: z.string() }),
  z.object({ kind: z.literal('section'), file: z.string(), section: z.string() }),
  z.object({
    kind: z.literal('text'),
    file: z.string(),
    start: z.number().int(),
    end: z.number().int(),
    quote: z.string(),
  }),
])

export const AnchorInput = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('file'), file: FileId }),
  z.strictObject({ kind: z.literal('section'), section: z.string() }),
  z.strictObject({
    kind: z.literal('text'),
    file: FileId,
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  }),
])

export const AnchorState = z.enum(['exact', 'moved', 'changed', 'outdated'])

export const CommentOutcome = z.object({ id: z.string(), state: AnchorState, anchor: Anchor.nullable() })

const CommandName = z.enum([
  'replace',
  'insert',
  'delete',
  'move',
  'rename-heading',
  'set-section',
  'rename-file',
  'create-file',
  'delete-file',
])

export const StepResult = z.object({ step: z.number().int(), command: CommandName, addresses: z.array(z.string()) })

export const Conflict = z.object({
  step: z.number().int(),
  command: CommandName,
  reason: z.enum(['not_found', 'no_match', 'ambiguous', 'expect_mismatch', 'invalid']),
  message: z.string(),
})

export const OutlineEntry = z.object({
  id: z.string(),
  kind: z.enum([
    'heading',
    'paragraph',
    'list-item',
    'code',
    'table',
    'quote',
    'footnote',
    'html',
    'thematic-break',
    'front-matter',
    'definition',
  ]),
  path: z.array(z.string()),
  section: z.string().nullable(),
  level: z.number().int().optional(),
  source: z.string(),
})

export const FileOutline = z.object({ id: z.string(), path: z.string(), entries: z.array(OutlineEntry) })

const VersionHow = z.enum(['created', 'commands', 'upload'])

/**
 * A hint at where an idea lives in git: the branch it was last synced from,
 * and the repository as host and path (`github.com/acme/plans`), the same for
 * its https and ssh remotes. `null` without a network remote: a path on disk
 * means nothing on another machine. Never a URL, so never credentials.
 */
export const GitHint = z.strictObject({
  uri: z
    .string()
    .max(500)
    .regex(/^[a-z0-9][a-z0-9.-]*\/[^\s@:\\]+$/, 'a repository as host/path, like github.com/acme/plans')
    .nullable(),
  branch: z.string().min(1).max(250),
})

/**
 * Where an idea is: open (a draft, requesting review, or changes in progress)
 * or closed, as accepted (it goes ahead) or rejected. People move it; nothing
 * moves it by itself.
 */
export const IdeaStatus = z.enum([
  'draft',
  'requesting-review',
  'changes-in-progress',
  'closed-accepted',
  'closed-rejected',
])
export type IdeaStatus = z.infer<typeof IdeaStatus>
export const OpenStatus = z.enum(['draft', 'requesting-review', 'changes-in-progress'])

/** A change of an idea's status, who made it and why. */
export const StatusChange = z.object({ status: IdeaStatus, by: Caller, at: z.number(), note: z.string() })

export const Verdict = z.enum(['approve', 'request-changes', 'reject'])
export type Verdict = z.infer<typeof Verdict>

/**
 * A reviewer's latest verdict, on the version they reviewed. `reviewer` names
 * the account: u:<user> for a person, b:<user>:<bot> for a bot. `counts`: an
 * approval from a person on the latest version (what approval rules count).
 * `standing`: a Request changes or Reject not withdrawn or dismissed, which
 * stops it being closed as accepted, whatever version it was on.
 */
export const Review = z.object({
  reviewer: z.string(),
  by: Caller,
  verdict: Verdict,
  version: z.number().int(),
  body: z.string(),
  at: z.number(),
  dismissed: z.object({ by: Caller, at: z.number(), reason: z.string() }).nullable(),
  counts: z.boolean(),
  standing: z.boolean(),
})
export type Review = z.infer<typeof Review>

/** What someone can do with an idea. */
export const Permission = z.object({ view: z.boolean(), edit: z.boolean(), share: z.boolean(), owner: z.boolean() })

export const IdeaSummary = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  owner: z.string(),
  /** The team it's in (get_team), or null for someone's own idea. */
  team: z.string().nullable(),
  /** Where it's found: its team's handle (or @ and its owner's), and its number there. */
  place: z.string(),
  number: z.number().int(),
  /** What you can do with it. */
  you: Permission,
  status: IdeaStatus,
  createdAt: z.number(),
  latest: z.number().int(),
  /** Where it was last synced from, if from a git branch: how another machine finds it. */
  gitHint: GitHint.nullable(),
  versions: z.array(
    z.object({
      number: z.number().int(),
      parent: z.number().int().nullable(),
      createdAt: z.number(),
      by: Caller,
      how: VersionHow,
      steps: z.number().int(),
    }),
  ),
})

export const CommentBase = z.object({
  id: z.string(),
  author: Caller,
  createdAt: z.number(),
  body: z.string(),
  version: z.number().int(),
  /** Part of your review, not submitted yet: only you see it (review_idea publishes it). */
  pending: z.boolean(),
})

/** Whether a suggestion was accepted (in which version) or rejected, by whom and when. */
export const Decision = z.object({
  kind: z.enum(['accepted', 'rejected']),
  by: Caller,
  at: z.number(),
  version: z.number().int().nullable(),
})

/**
 * A suggested edit: the source it replaces (the selection, widened to whole
 * formatting) and the replacement, and what became of it. As of an older
 * version, one accepted later shows as still open.
 */
export const SuggestionInfo = z.object({
  old: z.string(),
  new: z.string(),
  decision: Decision.nullable(),
  /** Accepted into the idea's draft, not committed yet. */
  inDraft: z.boolean(),
})

export const CommentThread = CommentBase.extend({
  resolved: z.boolean(),
  state: AnchorState,
  anchor: Anchor.nullable(),
  /** The last version where the comment was still attached, for "View in v3". */
  lastVersion: z.number().int().nullable(),
  /** Versions whose steps said they address this comment. */
  addressedIn: z.array(z.number().int()),
  /** A suggested edit's change; null for a plain comment. */
  suggestion: SuggestionInfo.nullable(),
  replies: z.array(CommentBase),
})

/**
 * The live socket for an idea, at /api/ideas/{idea}/live: what's happening
 * to it, as it happens. The first message is a token, as a request would send
 * it; send a fresh one before it expires, or the socket closes. Once the
 * server says `ready`, read what the page shows; every change after that
 * arrives here.
 */
export const LiveClientMessage = z.object({ type: z.literal('token'), token: z.string().min(1) })
export type LiveClientMessage = z.infer<typeof LiveClientMessage>

export const LiveEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  /** A new thread, as list_comments shows it. */
  z.object({ type: z.literal('comment'), thread: CommentThread, by: Caller }),
  z.object({ type: z.literal('reply'), parent: z.string(), reply: CommentBase, by: Caller }),
  z.object({ type: z.literal('resolved'), comment: z.string(), resolved: z.boolean(), by: Caller }),
  /** A suggestion accepted or rejected; its thread is resolved with it. */
  z.object({ type: z.literal('decided'), comment: z.string(), decision: Decision, by: Caller }),
  /** The idea's draft changed, was committed or was discarded: read it again (people with edit access). */
  z.object({ type: z.literal('draft'), by: Caller }),
  /** The idea's status changed. */
  z.object({ type: z.literal('status'), status: IdeaStatus, change: StatusChange, by: Caller }),
  /** A verdict given or dismissed: the reviewer's verdict as it stands. */
  z.object({ type: z.literal('review'), review: Review, by: Caller }),
  /** A new version: its files and where each comment is have changed. */
  z.object({ type: z.literal('version'), version: z.number().int(), how: VersionHow, by: Caller }),
])
export type LiveEvent = z.infer<typeof LiveEvent>

/** Close codes: no valid token (or it expired), and no such idea (or not one you can see). */
/** A live socket's close codes: 1013 is WebSocket's own "try again later". */
export const LIVE_CLOSE = { unauthorized: 4401, notFound: 4404, unavailable: 1013 } as const

/** A unit of the draft: a block that was in the latest version (changed in the draft or not), or new text and the change that added it. */
export const DraftUnit = z.object({
  id: z.string(),
  kind: OutlineEntry.shape.kind,
  source: z.string(),
  level: z.number().int(),
  origin: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('base'), changed: z.boolean() }),
    z.object({ kind: z.literal('new'), change: z.string() }),
  ]),
})

/**
 * An idea's draft: one per idea, on its latest version. Its changes in the
 * order they were made (each with why it doesn't apply, if it doesn't), the
 * files as they'd be, and where each comment would be.
 */
export const Draft = z.object({
  /** The latest version: what the draft is on, and what committing it builds on. */
  version: z.number().int(),
  changes: z.array(
    z.object({
      key: z.string(),
      change: DraftChange,
      by: Caller,
      at: z.number(),
      /** Why it doesn't apply to the draft as it is (outdated); null if it does. */
      problem: z.string().nullable(),
    }),
  ),
  files: z.array(z.object({ file: z.string(), path: z.string(), content: z.string(), units: z.array(DraftUnit) })),
  comments: z.array(CommentOutcome),
  /** How many commands committing makes. */
  steps: z.number().int(),
})

/** A suggestion left out of an accept, and why. */
export const Skipped = z.object({ id: z.string(), message: z.string() })

export const VersionResult = z.object({
  version: z.number().int(),
  comments: z.array(CommentOutcome),
  steps: z.array(StepResult),
})

export const FileContent = z.object({ file: z.string(), path: z.string(), hash: z.string(), content: z.string() })

// --- the directory -----------------------------------------------------------------

/** A person, team or group named by ID or by handle (with or without @). */
export const Ref = z.string().trim().min(1).max(64)
export const Handle = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/, 'a handle: 1 to 39 lowercase letters, digits and dashes')
export const Cursor = z.string().max(500).optional()
export const Limit = z.coerce.number().int().min(1).max(100).optional()

export const User = z.object({ id: z.string(), handle: z.string(), name: z.string(), inactive: z.boolean() })
export const Role = z.enum(['admin', 'maintainer', 'member'])
export const CreatePolicy = z.enum(['anyone', 'members', 'maintainers'])
export const TeamDefaults = z.strictObject({
  members: z.enum(['none', 'view', 'edit']),
  public: z.boolean(),
  groups: z.array(z.strictObject({ group: z.string(), edit: z.boolean() })).max(50),
})

/**
 * What an idea in a team needs before it can be closed as accepted: a number
 * of approvals from people on the latest version, group rules (one approval
 * from any of the groups, or one from each; `request` asks the groups to
 * review when an idea goes out for review), and every thread resolved.
 */
export const TeamRequirements = z.strictObject({
  approvals: z.number().int().min(0).max(50),
  groups: z
    .array(
      z.strictObject({
        mode: z.enum(['any', 'each']),
        /** By ID or handle; stored by ID. */
        groups: z.array(z.string().min(1).max(64)).min(1).max(10),
        request: z.boolean(),
      }),
    )
    .max(10),
  resolved: z.boolean(),
})
export type TeamRequirements = z.infer<typeof TeamRequirements>

/** One requirement, checked against an idea. */
export const RequirementCheck = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('approvals'), need: z.number().int(), have: z.number().int(), met: z.boolean() }),
  z.object({
    kind: z.literal('groups'),
    mode: z.enum(['any', 'each']),
    /** Each group, and the people in it whose approvals count. */
    groups: z.array(
      z.object({
        id: z.string(),
        handle: z.string(),
        name: z.string(),
        deleted: z.boolean(),
        approvedBy: z.array(z.string()),
      }),
    ),
    met: z.boolean(),
    /** It can't be met until a maintainer fixes it: it names a deleted group. */
    broken: z.boolean(),
  }),
  z.object({ kind: z.literal('resolved'), open: z.number().int(), met: z.boolean() }),
])
export type RequirementCheck = z.infer<typeof RequirementCheck>

/** A team's requirements checked against an idea; met with no checks when it has none. */
export const RequirementsCheck = z.object({ met: z.boolean(), checks: z.array(RequirementCheck) })

const ContainerFields = {
  id: z.string(),
  handle: z.string(),
  name: z.string(),
  description: z.string(),
  createdAt: z.number(),
  members: z.number().int(),
}
export const Team = z.object({
  kind: z.literal('team'),
  ...ContainerFields,
  archived: z.boolean(),
  createPolicy: CreatePolicy,
  defaults: TeamDefaults,
  requirements: TeamRequirements,
})
export const Group = z.object({ kind: z.literal('group'), ...ContainerFields, deleted: z.boolean() })
/** A team's or group's ID, handle and name. */
export const ContainerRef = z.object({ id: z.string(), handle: z.string(), name: z.string() })
/** A group in a team, or a team a group is in, has a member's or a maintainer's role there: never admin. */
export const GroupRole = z.enum(['member', 'maintainer'])
/**
 * A team's or group's member: their role (the highest of their own and, in a team, each of its
 * groups' they're in), when they joined (ms), their own membership's role (null when they're in only
 * through groups), and the groups they're in it through.
 */
export const Member = z.object({
  user: User,
  role: Role,
  joined: z.number(),
  direct: Role.nullable(),
  through: z.array(z.object({ group: ContainerRef, role: Role })),
})
/** A group in a team: its members are the team's, at the lower of its role here and theirs in it. */
export const TeamGroup = z.object({
  group: ContainerRef.extend({ members: z.number().int() }),
  role: GroupRole,
  addedBy: User.nullable(),
  added: z.number(),
  /** How many are in the team only through this group: who'd leave it if the group did. */
  leaving: z.number().int(),
})
/** A team a group is in. */
export const GroupTeam = z.object({ team: ContainerRef, role: GroupRole, added: z.number(), leaving: z.number().int() })
/**
 * How much of a team you hear about: only the ideas you're involved in (the
 * default), every idea once it's out of draft up to and including its close,
 * or every idea, drafts included.
 */
export const WatchLevel = z.enum(['participating', 'active', 'all'])
export type WatchLevel = z.infer<typeof WatchLevel>

/** The teams and groups you're in, with your role in each, and those you've asked to join. */
export const Memberships = z.object({
  /** With how much of each you hear about (watch). */
  teams: z.array(
    z.object({
      id: z.string(),
      handle: z.string(),
      name: z.string(),
      archived: z.boolean(),
      /** Your role: the highest of your own and each of your groups'. */
      role: Role,
      /** Your own membership's role, or null when you're in only through groups. */
      direct: Role.nullable(),
      watch: WatchLevel,
    }),
  ),
  groups: z.array(z.object({ id: z.string(), handle: z.string(), name: z.string(), role: Role })),
  requested: z.array(z.object({ kind: z.enum(['team', 'group']), id: z.string() })),
})

export function Page<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), next: z.string().nullable() })
}

/** An idea as lists show it, with its team and owner by name and its address. */
export const IdeaRow = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  status: IdeaStatus,
  latest: z.number().int(),
  createdAt: z.number(),
  updatedAt: z.number(),
  /** Its address: its team's handle (or @ and its owner's) and its number there (ideaPath). */
  place: z.string(),
  number: z.number().int(),
  /** Comment threads not resolved yet. */
  openComments: z.number().int(),
  team: z.object({ id: z.string(), handle: z.string(), name: z.string(), archived: z.boolean() }).nullable(),
  owner: User,
})

/** Why you hear about an idea, most direct first; `watching`: through a team you watch. */
export const InboxReason = z.enum([
  'author',
  'review-requested',
  'group-review',
  'participating',
  'subscribed',
  'watching',
])
export type InboxReason = z.infer<typeof InboxReason>

/** What reaches you by email: everything the inbox has for ideas you're involved in, only review requests, or nothing. */
export const EmailChoice = z.enum(['involved', 'review-requests', 'off'])
/** An email per idea once it goes quiet for a few minutes, or one digest a day. */
export const EmailCadence = z.enum(['bundled', 'daily'])
export const NotificationSettings = z.object({
  ownBots: z.boolean(),
  email: EmailChoice,
  emailWatching: z.boolean(),
  cadence: EmailCadence,
  /** Whether this deployment sends email at all; without it the email settings do nothing. */
  emailAvailable: z.boolean(),
})
export type NotificationSettings = z.infer<typeof NotificationSettings>

/**
 * An inbox row: one per idea, however much happened. The idea as lists show
 * it, why you hear about it, how many events are new since you read it, and
 * the latest of them (its `detail` by kind: a version's number, a comment's
 * ID and the start of its text, a verdict, a status…).
 */
export const Notification = z.object({
  idea: IdeaRow,
  reason: InboxReason,
  newCount: z.number().int(),
  done: z.boolean(),
  updatedAt: z.number(),
  latest: z.object({
    kind: z.enum([
      'version',
      'comment',
      'suggestion',
      'reply',
      'review',
      'dismissed',
      'status',
      'decided',
      'requested',
    ]),
    actor: Caller,
    at: z.number(),
    detail: z.record(z.string(), z.unknown()),
  }),
})
export type Notification = z.infer<typeof Notification>

/** Where an idea is found: `mobile/idea/9`, or `@riley/idea/3` for someone's own. */
export const IdeaPlace = z.object({
  id: z.string(),
  /** Its team's handle, or @ and its owner's handle. */
  place: z.string(),
  number: z.number().int(),
})

export const GrantSubject = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('user'), id: z.string() }),
  z.strictObject({ kind: z.literal('group'), id: z.string() }),
  z.strictObject({ kind: z.literal('team'), id: z.string() }),
  z.strictObject({ kind: z.literal('everyone') }),
])
export const Grant = z.object({
  subject: GrantSubject,
  edit: z.boolean(),
  share: z.boolean(),
  /** Asked to review it: a person or a group. */
  reviewer: z.boolean(),
})

/** What a token may do: see current_token. */
export const TokenInfo = z.object({
  user: User,
  purpose: z.enum(['me', 'bot-for-me', 'bot']),
  bot: z.string().nullable(),
  readOnly: z.boolean(),
  limits: z
    .object({
      teams: z.array(z.object({ id: z.string(), handle: z.string() })),
      ideas: z.array(z.string()),
      noTeam: z.boolean(),
    })
    .nullable(),
  /** The token grant's ID, or null for a token without one. */
  grant: z.string().nullable(),
})

const AccessChange = z.object({ count: z.number().int(), people: z.array(User), everyone: z.boolean() })
export const MovePreview = z.object({
  from: z.string().nullable(),
  to: z.string().nullable(),
  grants: z.object({ now: z.array(Grant), after: z.array(Grant) }),
  losing: AccessChange,
  gaining: AccessChange,
})
