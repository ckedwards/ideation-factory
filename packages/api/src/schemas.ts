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
  z.object({ kind: z.literal('text'), file: z.string(), start: z.number().int(), end: z.number().int(), quote: z.string() }),
])

export const AnchorInput = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('file'), file: FileId }),
  z.strictObject({ kind: z.literal('section'), section: z.string() }),
  z.strictObject({ kind: z.literal('text'), file: FileId, start: z.number().int().nonnegative(), end: z.number().int().positive() }),
])

export const AnchorState = z.enum(['exact', 'moved', 'changed', 'outdated'])

export const CommentOutcome = z.object({ id: z.string(), state: AnchorState, anchor: Anchor.nullable() })

const CommandName = z.enum(['replace', 'insert', 'delete', 'move', 'rename-heading', 'set-section', 'rename-file', 'create-file', 'delete-file'])

export const StepResult = z.object({ step: z.number().int(), command: CommandName, addresses: z.array(z.string()) })

export const Conflict = z.object({
  step: z.number().int(),
  command: CommandName,
  reason: z.enum(['not_found', 'no_match', 'ambiguous', 'expect_mismatch', 'invalid']),
  message: z.string(),
})

export const OutlineEntry = z.object({
  id: z.string(),
  kind: z.enum(['heading', 'paragraph', 'list-item', 'code', 'table', 'quote', 'footnote', 'html', 'thematic-break', 'front-matter', 'definition']),
  path: z.array(z.string()),
  section: z.string().nullable(),
  level: z.number().int().optional(),
  source: z.string(),
})

export const FileOutline = z.object({ id: z.string(), path: z.string(), entries: z.array(OutlineEntry) })

const VersionHow = z.enum(['created', 'commands', 'upload'])

export const IdeaSummary = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  owner: z.string(),
  status: z.string(),
  createdAt: z.number(),
  latest: z.number().int(),
  versions: z.array(
    z.object({ number: z.number().int(), parent: z.number().int().nullable(), createdAt: z.number(), by: Caller, how: VersionHow, steps: z.number().int() }),
  ),
})

const CommentBase = z.object({ id: z.string(), author: Caller, createdAt: z.number(), body: z.string(), version: z.number().int() })

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

export const VersionResult = z.object({ version: z.number().int(), comments: z.array(CommentOutcome), steps: z.array(StepResult) })

export const FileContent = z.object({ file: z.string(), path: z.string(), hash: z.string(), content: z.string() })
