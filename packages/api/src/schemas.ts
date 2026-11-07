// Schemas shared by the operations. The server's handlers are typed by these,
// so if what the server returns drifts from what's published, it doesn't compile.
import { Batch } from '@ideaf/core'
import { z } from 'zod'

export { Batch }

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

/** What someone can do with an idea. */
export const Permission = z.object({ view: z.boolean(), edit: z.boolean(), share: z.boolean(), owner: z.boolean() })

export const IdeaSummary = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  owner: z.string(),
  /** The team it's in (get_team), or null for someone's own idea. */
  team: z.string().nullable(),
  /** What you can do with it. */
  you: Permission,
  status: z.string(),
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
})

export const CommentThread = CommentBase.extend({
  resolved: z.boolean(),
  state: AnchorState,
  anchor: Anchor.nullable(),
  /** The last version where the comment was still attached, for "View in v3". */
  lastVersion: z.number().int().nullable(),
  /** Versions whose steps said they address this comment. */
  addressedIn: z.array(z.number().int()),
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
  /** A new version: its files and where each comment is have changed. */
  z.object({ type: z.literal('version'), version: z.number().int(), how: VersionHow, by: Caller }),
])
export type LiveEvent = z.infer<typeof LiveEvent>

/** Close codes: no valid token (or it expired), and no such idea (or not one you can see). */
export const LIVE_CLOSE = { unauthorized: 4401, notFound: 4404 } as const

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
})
export const Group = z.object({ kind: z.literal('group'), ...ContainerFields, deleted: z.boolean() })
export const Member = z.object({ user: User, role: Role })

export function Page<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), next: z.string().nullable() })
}

export const IdeaRow = z.object({
  id: z.string(),
  title: z.string(),
  team: z.string().nullable(),
  owner: z.string(),
  status: z.string(),
  latest: z.number().int(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export const GrantSubject = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('user'), id: z.string() }),
  z.strictObject({ kind: z.literal('group'), id: z.string() }),
  z.strictObject({ kind: z.literal('team'), id: z.string() }),
  z.strictObject({ kind: z.literal('everyone') }),
])
export const Grant = z.object({ subject: GrantSubject, edit: z.boolean(), share: z.boolean() })

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
