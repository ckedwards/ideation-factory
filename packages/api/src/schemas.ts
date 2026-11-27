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
  z.object({ kind: z.literal('idea') }),
  z.object({ kind: z.literal('file'), file: z.string() }),
  z.object({ kind: z.literal('section'), file: z.string(), section: z.string() }),
  /** One block (a paragraph, a list item, a table, code, a quote), by its ID; a heading's is its section. */
  z.object({ kind: z.literal('block'), file: z.string(), block: z.string() }),
  z.object({
    kind: z.literal('text'),
    file: z.string(),
    start: z.number().int(),
    end: z.number().int(),
    quote: z.string(),
  }),
])

export const AnchorInput = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('idea') }),
  z.strictObject({ kind: z.literal('file'), file: FileId }),
  z.strictObject({ kind: z.literal('section'), section: z.string() }),
  z.strictObject({ kind: z.literal('block'), block: z.string() }),
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
  'move-text',
  'rename-heading',
  'set-section',
  'rename-file',
  'create-file',
  'delete-file',
])

export const StepResult = z.object({
  step: z.number().int(),
  command: CommandName,
  addresses: z.array(z.string()),
  /** Who made it: for a committed draft, everyone who typed in its blocks; otherwise whoever made the version. */
  authors: z.array(Caller),
})

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
  /** Whether its draft has changes nobody's committed yet (shown to everyone who can see the idea). */
  uncommitted: z.boolean(),
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
      /** Who made what's in it: for a committed draft, everyone who typed in it; otherwise `by`. */
      authors: z.array(Caller),
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
  /** Where it was in that version, for one that's outdated (its anchor is null): what it was on. */
  lastAnchor: Anchor.nullable(),
  /** For one outdated on a section or a block: that heading or block as it was there, as show_blocks lists it. */
  lastUnit: OutlineEntry.nullable(),
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
  /**
   * The idea's draft changed, was committed, discarded (`discarded`, with the restore point that brings
   * it back, null if it was empty) or restored (`restored`): read it again (people with edit access).
   */
  z.object({
    type: z.literal('draft'),
    by: Caller,
    uncommitted: z.boolean(),
    discarded: z.object({ point: z.number().int().nullable() }).optional(),
    restored: z.boolean().optional(),
  }),
  /** A restore point of the draft taken or deleted: read list_restore_points again (people with edit access). */
  z.object({ type: z.literal('restorePoints'), by: Caller.nullable() }),
  /** The idea's status changed. */
  z.object({ type: z.literal('status'), status: IdeaStatus, change: StatusChange, by: Caller }),
  /** A verdict given or dismissed: the reviewer's verdict as it stands. */
  z.object({ type: z.literal('review'), review: Review, by: Caller }),
  /**
   * A new version: its files and where each comment is have changed. `committed` when it's the draft,
   * committed; `overwrote`, how many of the draft's changes one made around it overwrote.
   */
  z.object({
    type: z.literal('version'),
    version: z.number().int(),
    how: VersionHow,
    by: Caller,
    committed: z.boolean(),
    overwrote: z.number().int(),
  }),
])
export type LiveEvent = z.infer<typeof LiveEvent>

/** Close codes: no valid token (or it expired), and no such idea (or not one you can see). */
/** A live socket's close codes: 1013 is WebSocket's own "try again later". */
export const LIVE_CLOSE = { unauthorized: 4401, notFound: 4404, unavailable: 1013 } as const

/**
 * The draft's live socket, at /api/ideas/{idea}/draft/live: typing in the idea's draft as it's typed,
 * for people who can edit it (docs/handoff-live-editing.md). The first message is a token, as on the
 * idea's live socket; send a fresh one before it expires. Once the server says `ready`, open each
 * file to edit: its document is the page editor's (ui's editor/model.ts), with the count of steps
 * it's at. Send steps typed on the count you have; the server sends every file's steps you have open
 * to everyone editing it, yours with your `client`, once they're stored. Behind, take what you
 * missed and send yours again on top. `version` says a version was made, after the steps that moved
 * the documents onto it.
 *
 * Each browser window is one entity in the draft (step 4): the token message names it (`window`, the
 * same after a reconnect), and `ready` says whether it's in. Past the draft's limit of windows it
 * isn't: it can open files and take everyone's steps, read-only, until `joined`. A window that's in
 * sends `here` with its caret, at most every `caretMs` and at least every few seconds while it's
 * open, and is told where everyone else's is (`presence`) and who's gone (`left`).
 */
const DraftFileId = z.string().min(1).max(64)
const StepCount = z.number().int().min(0)
const DraftWindowId = z.string().min(8).max(64)
/** Where a window's caret is: its selection in a file, at the file's count of steps (a collapsed one when anchor is head). */
export const DraftCaret = z.object({
  file: DraftFileId,
  anchor: z.number().int().min(0),
  head: z.number().int().min(0),
  version: StepCount,
})
export type DraftCaret = z.infer<typeof DraftCaret>
/** A window in the draft: whose it is, its color for the draft (1 to 8, given out as windows arrive), and its caret, if it's in a file. */
export const DraftPresence = z.object({
  window: DraftWindowId,
  user: z.string(),
  color: z.number().int().min(1).max(8),
  at: DraftCaret.nullable(),
})
export type DraftPresence = z.infer<typeof DraftPresence>
export const DraftLiveClientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('token'), token: z.string().min(1), window: DraftWindowId }),
  /** Where this window's caret is now; null when it's in no file. */
  z.object({ type: z.literal('here'), at: DraftCaret.nullable() }),
  z.object({ type: z.literal('open'), file: DraftFileId }),
  z.object({
    type: z.literal('steps'),
    file: DraftFileId,
    version: StepCount,
    steps: z.array(z.unknown()).min(1).max(10_000),
    client: z.string().min(1).max(64),
  }),
  z.object({ type: z.literal('since'), file: DraftFileId, version: StepCount }),
  /**
   * Words seen cut from one block and pasted into another (`old`, their Markdown in `from`), so the
   * draft counts them as moved and their comments go with them.
   */
  z.object({
    type: z.literal('moved'),
    file: DraftFileId,
    words: z.object({
      from: z.string().min(1).max(64),
      old: z.string().min(1).max(100_000),
      to: z.union([
        z.object({ in: z.string().min(1).max(64), after: z.string().max(1_000_000) }),
        z.object({ in: z.string().min(1).max(64), before: z.string().max(1_000_000) }),
      ]),
    }),
  }),
])
export type DraftLiveClientMessage = z.infer<typeof DraftLiveClientMessage>

export const DraftLiveEvent = z.discriminatedUnion('type', [
  /**
   * The socket's open: whether this window is in the draft (`joined`; read-only otherwise, as the draft
   * has `limit` windows already), everyone in it, and how often to send the caret at most.
   */
  z.object({
    type: z.literal('ready'),
    joined: z.boolean(),
    limit: z.number().int(),
    caretMs: z.number().int(),
    people: z.array(DraftPresence),
  }),
  /** This window's in the draft now (someone left), and can type. */
  z.object({ type: z.literal('joined'), people: z.array(DraftPresence) }),
  /** A window arrived, or its caret moved. */
  z.object({ type: z.literal('presence'), person: DraftPresence }),
  /** A window left the draft. */
  z.object({ type: z.literal('left'), window: DraftWindowId }),
  /** A file opened: its document, at its count of steps. */
  z.object({ type: z.literal('opened'), file: DraftFileId, version: StepCount, doc: z.unknown() }),
  /**
   * Steps stored, from count `from`, each with the client that sent it (`server` for the server's own)
   * and, for the server's own, who made it (an agent's change is shown as its); null for a window's.
   */
  z.object({
    type: z.literal('steps'),
    file: DraftFileId,
    from: StepCount,
    steps: z.array(z.unknown()),
    clients: z.array(z.string()),
    by: z.array(Caller.nullable()),
  }),
  /** Your steps were sent on an older count than `version`: take what you missed, and send them again. */
  z.object({ type: z.literal('behind'), file: DraftFileId, version: StepCount }),
  /** What you missed is too long ago to have been kept: open the file again. */
  z.object({ type: z.literal('gone'), file: DraftFileId }),
  /** Your steps weren't taken, and why; they aren't to be sent again as they are. */
  z.object({ type: z.literal('refused'), file: DraftFileId, message: z.string() }),
  /**
   * A version was made: the draft committed (`committed`), or one made around it, which overwrote
   * `overwrote` of the draft's changes (their blocks now have its words).
   */
  z.object({
    type: z.literal('version'),
    version: z.number().int(),
    by: Caller,
    committed: z.boolean(),
    overwrote: z.number().int(),
  }),
  /** Someone discarded the draft: every file is back to the latest version. `point` brings it back (null: it was empty). */
  z.object({ type: z.literal('discarded'), by: Caller, point: z.number().int().nullable() }),
  /** Someone brought the draft back from a restore point. */
  z.object({ type: z.literal('restored'), by: Caller }),
])
export type DraftLiveEvent = z.infer<typeof DraftLiveEvent>

/** The draft's live socket's close codes: the idea's, and no edit access (or it's gone). */
export const DRAFT_LIVE_CLOSE = { ...LIVE_CLOSE, forbidden: 4403 } as const

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
      /** Whoever changed it last, and when */
      by: Caller,
      at: z.number(),
      /** Everyone who changed it, the last first: for typing, everyone who typed in its blocks */
      authors: z.array(Caller),
      /** Why it doesn't apply to the draft as it is (outdated); null if it does. */
      problem: z.string().nullable(),
    }),
  ),
  files: z.array(z.object({ file: z.string(), path: z.string(), content: z.string(), units: z.array(DraftUnit) })),
  comments: z.array(CommentOutcome),
  /** How many commands committing makes. */
  steps: z.number().int(),
  /** Who is typing in it now (in the last few seconds), and where: the heading of the section, if any. */
  typing: z.array(z.object({ user: z.string(), file: z.string(), heading: z.string().nullable() })),
})

/**
 * The draft as it was, kept so a bad edit or a discard can be taken back: taken once the draft has
 * been quiet a couple of minutes, every ten while it's busy, and before a discard, an overwrite or a
 * restore. Kept until two versions after the one it was taken on.
 */
export const RestorePoint = z.object({
  point: z.number().int(),
  /** The latest version when it was taken. */
  version: z.number().int(),
  /**
   * The draft went quiet, someone who changed it left it, or it was taken before an agent changed it
   * or someone discarded, overwrote or restored it.
   */
  why: z.enum(['quiet', 'left', 'agent', 'discard', 'overwrite', 'restore']),
  /** Who left, or whose change, discard, overwrite or restore it was taken before; null for a quiet one. */
  by: Caller.nullable(),
  at: z.number(),
  /** How many changes the draft had. */
  changes: z.number().int(),
  /** Who made the changes new since the restore point before it. */
  who: z.array(Caller),
  /** The first change new since the one before, its text cut short; null if none is new. */
  first: DraftChange.nullable(),
  /** How many more changes are new since the one before. */
  more: z.number().int(),
  /** How many of the one before's changes it doesn't have. */
  undone: z.number().int(),
  /** False once it's been dropped to make room for newer ones: only its label is left, and it can't be restored. */
  kept: z.boolean(),
})

/** A restore point as restoring it would make the draft, without restoring it. */
export const RestorePointPreview = z.object({
  point: z.number().int(),
  /** Each file as it would read. */
  files: z.array(z.object({ file: z.string(), path: z.string(), content: z.string() })),
  /** How many of its changes would come back held: a version made since has outdated them. */
  held: z.number().int(),
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
/**
 * The signed-in person, and what their work is labeled as: `me` is themselves; `bot-for-me` is the
 * bot named in `bot`, acting for them; `bot` is the bot on its own.
 */
export const Me = User.extend({ bot: Caller.shape.bot, purpose: Caller.shape.purpose })
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
  /** The teams watched above participating, member or not. */
  watching: z.array(z.object({ id: z.string(), handle: z.string(), name: z.string(), level: WatchLevel })),
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
  /** The people whose approval of the latest version counts, in the order they approved. */
  approvals: z.array(User),
  /** The people and groups asked to review it. */
  reviewers: z.array(
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('user'), user: User }),
      z.object({ kind: z.literal('group'), group: z.object({ id: z.string(), handle: z.string(), name: z.string() }) }),
    ]),
  ),
  /**
   * Who can see it beyond its owner and its team: only those asked to review it
   * (private), others it's shared with too (shared), or everyone (public).
   */
  visibility: z.enum(['private', 'shared', 'public']),
  /** Its team's approval requirements, checked: met with no checks when it has none. */
  requirements: RequirementsCheck,
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

/** What the inbox can be filtered by: why you hear about an idea, or `teams`, its notices about teams and groups. */
export const InboxShow = z.enum([...InboxReason.options, 'teams'])
export type InboxShow = z.infer<typeof InboxShow>

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
export const IdeaNotification = z.object({
  kind: z.literal('idea'),
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
export type IdeaNotification = z.infer<typeof IdeaNotification>

/** What a notice is about: a group joined or left a team, or you were added to or taken out of a team or a group. */
export const NoticeKind = z.enum(['group-joined', 'group-left', 'added', 'removed'])
export type NoticeKind = z.infer<typeof NoticeKind>

/** A team or a group as a notice names it: its name as it was then, and its handle now (for a link) if it's still there. */
export const NoticeSubject = z.object({ id: z.string(), handle: z.string().nullable(), name: z.string() })

/**
 * An inbox row about a team or a group, not an idea: one per thing that happened, newest first among the
 * ideas. `as`: why it's yours (you're an admin of the team, or of the group, or it's about you); `role`: the
 * one given (a group's in the team, or yours when you were added).
 */
export const NoticeNotification = z.object({
  kind: z.literal('notice'),
  /** Starts with `nt`, which no idea's ID does. */
  id: z.string(),
  notice: z.object({
    kind: NoticeKind,
    team: NoticeSubject.nullable(),
    group: NoticeSubject.nullable(),
    role: z.string().nullable(),
    as: z.enum(['team-admin', 'group-admin', 'you']),
    actor: Caller,
  }),
  reason: z.literal('teams'),
  /** 1 until it's read. */
  newCount: z.number().int(),
  done: z.boolean(),
  updatedAt: z.number(),
})

export type NoticeNotification = z.infer<typeof NoticeNotification>

/** An inbox row: an idea (one row however much happened to it), or a notice about a team or a group. */
export const Notification = z.discriminatedUnion('kind', [IdeaNotification, NoticeNotification])
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
