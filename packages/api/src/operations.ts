// Every operation, defined once. Step 3 covers the agent loop: create an idea,
// read it, show its blocks, pull, sync, preview and apply edits, and comments.
import { z } from 'zod'
import { defineOperation } from './operation.ts'
import { directoryOperations } from './operations-directory.ts'
import {
  AnchorInput,
  Caller,
  Batch,
  CommentId,
  CommentOutcome,
  CommentThread,
  Conflict,
  Draft,
  DraftChange,
  Skipped,
  FileContent,
  FileId,
  FileOutline,
  GitHint,
  GrantSubject,
  IdeaId,
  IdeaPlace,
  IdeaStatus,
  IdeaSummary,
  OpenStatus,
  Review,
  StatusChange,
  Verdict,
  Ref,
  StepResult,
  VersionParam,
  VersionResult,
} from './schemas.ts'

const MarkdownFile = z.strictObject({ path: z.string().min(1).max(512), content: z.string() })

export const operations = {
  createIdea: defineOperation({
    name: 'create_idea',
    summary: 'Start an idea',
    description:
      "Creates an idea from one or more Markdown files, as its first version. Outside a team it's private to you; in a team (ID or handle) it starts with the team's defaults for new ideas, and you need permission to create ideas there. Retrying with the same idempotency key returns the same idea instead of creating another.",
    method: 'POST',
    path: '/ideas',
    kind: 'write',
    input: z.strictObject({
      title: z.string().trim().min(1).max(200),
      description: z.string().max(5000).optional(),
      team: Ref.optional(),
      files: z.array(MarkdownFile).min(1).max(500),
      /** The git branch (and repository) the files come from, so another machine can find it. */
      gitHint: GitHint.optional(),
      /** Out for review straight away, instead of a draft. */
      status: z.enum(['draft', 'requesting-review']).optional(),
    }),
    output: z.object({
      idea: z.string(),
      version: z.number().int(),
      /** Where it's found: its team's handle (or @ and yours), and its number there (ideaPath). */
      place: z.string(),
      number: z.number().int(),
    }),
  }),

  findIdea: defineOperation({
    name: 'find_idea',
    summary: 'Find an idea by its number',
    description:
      "The idea at a team's handle and number (mobile and 9 for mobile/idea/9), or someone's own at @ and their handle. An idea that moved since is found at its old number too, and the answer says where it is now. Ideas you can't see aren't found.",
    method: 'GET',
    path: '/find-idea',
    kind: 'read',
    input: z.strictObject({
      place: z.string().trim().min(1).max(40),
      number: z.coerce.number().int().positive(),
    }),
    output: IdeaPlace,
  }),

  getIdea: defineOperation({
    name: 'get_idea',
    summary: 'Read an idea',
    description:
      "An idea's title, owner, team, status, latest version and version history (who made each version, and whether with commands or an upload), and what you can do with it.",
    method: 'GET',
    path: '/ideas/{idea}',
    kind: 'read',
    input: z.strictObject({ idea: IdeaId }),
    output: IdeaSummary,
  }),

  showBlocks: defineOperation({
    name: 'show_blocks',
    summary: 'Show the structured view',
    description:
      "Each file's sections and blocks with their stable IDs and source text, plus the open comments and what they're attached to. Read this before building an edit batch: commands name their targets by these IDs.",
    method: 'GET',
    path: '/ideas/{idea}/blocks',
    kind: 'read',
    input: z.strictObject({ idea: IdeaId, version: VersionParam }),
    output: z.object({ version: z.number().int(), files: z.array(FileOutline), comments: z.array(CommentThread) }),
  }),

  pull: defineOperation({
    name: 'pull',
    summary: 'Get the files',
    description:
      "Every file of a version (the latest by default) with its content and content hash. The hash is the file's base for the next sync: send it back so the server can follow comments through your edits and tell you to pull first if the idea moved on.",
    method: 'GET',
    path: '/ideas/{idea}/files',
    kind: 'read',
    input: z.strictObject({ idea: IdeaId, version: VersionParam }),
    output: z.object({ version: z.number().int(), files: z.array(FileContent) }),
  }),

  sync: defineOperation({
    name: 'sync',
    summary: 'Upload edited files',
    description:
      "Uploads edited copies of files as a new version, re-anchoring comments through the diff. If it would make changes in the idea's draft outdated, it's refused with draft_outdated, naming them: send it again with `outdateDraft` to confirm. Each existing file must give the hash it was edited from (its base); if that isn't the latest, the upload is refused with pull_first. New files have no `file` or `base`. `force` uploads anyway, so newer changes show as undone. Editing with commands keeps comments more exactly than an upload.",
    method: 'POST',
    path: '/ideas/{idea}/sync',
    kind: 'write',
    input: z.strictObject({
      idea: IdeaId,
      files: z
        .array(
          z.strictObject({
            file: FileId.optional(),
            path: z.string().min(1).max(512),
            content: z.string(),
            base: z.string().optional(),
          }),
        )
        .max(500),
      deleted: z.array(FileId).max(500).optional(),
      force: z.boolean().optional(),
      /** The git branch (and repository) synced from: the idea's git hint becomes this. */
      gitHint: GitHint.optional(),
      /** Upload even though it makes changes in the idea's draft outdated (draft_outdated said which). */
      outdateDraft: z.boolean().optional(),
    }),
    output: VersionResult,
  }),

  previewEdit: defineOperation({
    name: 'preview_edit',
    summary: 'Dry-run an edit batch',
    description:
      'Shows what a batch would do, changing nothing: the new text of each changed file, and what happens to each comment (exact, moved, changed or outdated). A batch that no longer applies returns conflict, naming the steps.',
    method: 'POST',
    path: '/ideas/{idea}/edits/preview',
    kind: 'read',
    input: z.strictObject({ idea: IdeaId, batch: Batch }),
    output: z.object({
      base: z.number().int(),
      comments: z.array(CommentOutcome),
      steps: z.array(StepResult),
      files: z.array(
        z.object({ file: z.string(), path: z.string(), content: z.string(), before: z.string().nullable() }),
      ),
      deleted: z.array(z.string()),
    }),
  }),

  edit: defineOperation({
    name: 'edit',
    summary: 'Apply an edit batch',
    description:
      "If it would make changes in the idea's draft outdated, it's refused with draft_outdated, naming them: send it again with `outdateDraft` to confirm. Applies a batch of edit commands (replace, insert, delete, move, rename-heading, set-section, and file commands) as one new version. All or nothing. If the idea moved on since the batch's base, it's replayed onto the latest version; any step that no longer applies makes it a conflict, with nothing changed. Steps can name the comments they address.",
    method: 'POST',
    path: '/ideas/{idea}/edits',
    kind: 'write',
    input: z.strictObject({
      idea: IdeaId,
      batch: Batch,
      /** Apply it even though it makes changes in the idea's draft outdated (draft_outdated said which). */
      outdateDraft: z.boolean().optional(),
    }),
    output: VersionResult,
  }),

  listComments: defineOperation({
    name: 'list_comments',
    summary: 'List comments',
    description:
      'Every comment thread as of a version (the latest by default): where it is anchored there and its state, replies, whether it is resolved, and which versions addressed it.',
    method: 'GET',
    path: '/ideas/{idea}/comments',
    kind: 'read',
    input: z.strictObject({ idea: IdeaId, version: VersionParam }),
    output: z.array(CommentThread),
  }),

  addComment: defineOperation({
    name: 'add_comment',
    summary: 'Comment',
    description:
      "Comments on a file, a section (by its ID) or a range of a file's plain text (from show_blocks), on the latest version. If the idea has moved on, it's refused with stale_version: read it again.",
    method: 'POST',
    path: '/ideas/{idea}/comments',
    kind: 'write',
    input: z.strictObject({
      idea: IdeaId,
      version: z.number().int().positive(),
      anchor: AnchorInput,
      body: z.string().trim().min(1).max(20_000),
    }),
    output: z.object({ comment: z.string() }),
  }),

  reply: defineOperation({
    name: 'reply',
    summary: 'Reply to a comment',
    description: 'Adds a reply to a comment thread.',
    method: 'POST',
    path: '/ideas/{idea}/comments/{comment}/replies',
    kind: 'write',
    input: z.strictObject({ idea: IdeaId, comment: CommentId, body: z.string().trim().min(1).max(20_000) }),
    output: z.object({ comment: z.string() }),
  }),

  resolveComment: defineOperation({
    name: 'resolve_comment',
    summary: 'Resolve or reopen a comment',
    description: 'Marks a comment thread resolved, or reopens it.',
    method: 'POST',
    path: '/ideas/{idea}/comments/{comment}/resolve',
    kind: 'write',
    input: z.strictObject({ idea: IdeaId, comment: CommentId, resolved: z.boolean() }),
    output: z.object({ comment: z.string(), resolved: z.boolean() }),
  }),

  suggestEdit: defineOperation({
    name: 'suggest_edit',
    summary: 'Suggest an edit',
    description:
      "Suggests a replacement for a range of a file's plain text (from show_blocks), on the latest version: a comment that carries a change. What it replaces is the range's Markdown source, widened to whole formatting where the range cuts through it; the answer says what that is, so send `new` as its replacement. Anyone who can comment can suggest; people with edit access accept or reject. If the idea has moved on, it's refused with stale_version: read it again.",
    method: 'POST',
    path: '/ideas/{idea}/suggestions',
    kind: 'write',
    input: z.strictObject({
      idea: IdeaId,
      version: z.number().int().positive(),
      anchor: z.strictObject({
        kind: z.literal('text'),
        file: FileId,
        start: z.number().int().nonnegative(),
        end: z.number().int().positive(),
      }),
      /** The replacement, as Markdown. */
      new: z.string().max(1_000_000),
      /** Why, if it needs saying. */
      body: z.string().trim().max(20_000).optional(),
    }),
    output: z.object({ comment: z.string(), old: z.string() }),
  }),

  suggestionSource: defineOperation({
    name: 'suggestion_source',
    summary: 'What a suggestion would replace',
    description:
      "The Markdown source a suggestion on a range of a file's plain text would replace (on the latest version): the range's source, widened to whole formatting where the range cuts through it. Read it to write the replacement.",
    method: 'GET',
    path: '/ideas/{idea}/suggestions/source',
    kind: 'read',
    input: z.strictObject({
      idea: IdeaId,
      file: FileId,
      start: z.coerce.number().int().nonnegative(),
      end: z.coerce.number().int().positive(),
    }),
    output: z.object({ version: z.number().int(), old: z.string() }),
  }),

  acceptSuggestions: defineOperation({
    name: 'accept_suggestions',
    summary: 'Accept suggested edits',
    description:
      "Accepts suggestions as one new version, a step for each that addresses it, and resolves them; or, with `into: draft`, adds them to the idea's draft, to be committed with the rest of it. One whose text has changed or gone since (in the version, or in the draft), or that overlaps one before it, is skipped and stays open, saying why; if none apply, it's refused with conflict. Needs edit access.",
    method: 'POST',
    path: '/ideas/{idea}/suggestions/accept',
    kind: 'write',
    input: z.strictObject({
      idea: IdeaId,
      suggestions: z.array(CommentId).min(1).max(100),
      /** `draft`: into the idea's draft, to commit with the rest of it, instead of a version now. */
      into: z.enum(['version', 'draft']).optional(),
      /** As a version, even though it makes changes in the idea's draft outdated (draft_outdated said which). */
      outdateDraft: z.boolean().optional(),
    }),
    output: z.object({
      /** The new version; null when they went into the draft. */
      version: z.number().int().nullable(),
      accepted: z.array(z.string()),
      skipped: z.array(Skipped),
    }),
  }),

  rejectSuggestion: defineOperation({
    name: 'reject_suggestion',
    summary: 'Reject a suggested edit',
    description:
      'Rejects a suggestion, resolving it. One already accepted can’t be: edit the idea instead. Needs edit access.',
    method: 'POST',
    path: '/ideas/{idea}/suggestions/{comment}/reject',
    kind: 'write',
    input: z.strictObject({ idea: IdeaId, comment: CommentId }),
    output: z.object({ comment: z.string() }),
  }),

  getDraft: defineOperation({
    name: 'get_draft',
    summary: 'Read the draft',
    description:
      "The idea's draft: one per idea, shared by everyone with edit access, on its latest version. Its changes in the order they were made, each with why it doesn't apply if it's outdated; the files as they'd be, each block with where it came from; and where each comment would be. Empty until someone edits. Needs edit access.",
    method: 'GET',
    path: '/ideas/{idea}/draft',
    kind: 'read',
    input: z.strictObject({ idea: IdeaId }),
    output: Draft,
  }),

  changeDraft: defineOperation({
    name: 'change_draft',
    summary: 'Change the draft',
    description:
      "Adds a change to the idea's draft: a block's (or heading's) new source, a deletion (a heading deletes its section), or new Markdown at a place. Blocks are named by their IDs in the draft (get_draft), and an edit or deletion gives the block as it read (`was`): if it reads differently now, the change is refused with conflict, as outdated. Editing a block again straight after is one change. Needs edit access.",
    method: 'POST',
    path: '/ideas/{idea}/draft/changes',
    kind: 'write',
    input: z.strictObject({ idea: IdeaId, change: DraftChange }),
    output: z.object({ key: z.string() }),
  }),

  undoDraftChange: defineOperation({
    name: 'undo_draft_change',
    summary: 'Take a change out of the draft',
    description:
      'Takes one change out of the draft. A later change that built on it may become outdated. A suggestion taken out is open again. Needs edit access.',
    method: 'POST',
    path: '/ideas/{idea}/draft/changes/{key}/undo',
    kind: 'write',
    input: z.strictObject({ idea: IdeaId, key: z.string().min(1).max(64) }),
    output: z.object({}),
  }),

  discardDraft: defineOperation({
    name: 'discard_draft',
    summary: 'Discard the draft',
    description: "Empties the idea's draft. Suggestions accepted into it are open again. Needs edit access.",
    method: 'POST',
    path: '/ideas/{idea}/draft/discard',
    kind: 'write',
    input: z.strictObject({ idea: IdeaId }),
    output: z.object({}),
  }),

  commitDraft: defineOperation({
    name: 'commit_draft',
    summary: 'Commit the draft',
    description:
      "Makes the draft one new version, a step for each command, and resolves the suggestions in it as accepted. Every change must still apply: if any is outdated, it's refused with conflict, naming them, and nothing changes. Needs edit access.",
    method: 'POST',
    path: '/ideas/{idea}/draft/commit',
    kind: 'write',
    input: z.strictObject({ idea: IdeaId }),
    output: VersionResult,
  }),

  listReviews: defineOperation({
    name: 'list_reviews',
    summary: "Read an idea's status and reviews",
    description:
      "The idea's status and every change of it (who, when, and why), and each reviewer's latest verdict: the version it was on, whether it counts as an approval (a person's, on the latest version) and whether it stands in the way of closing as accepted (a Request changes or Reject not withdrawn or dismissed).",
    method: 'GET',
    path: '/ideas/{idea}/reviews',
    kind: 'read',
    input: z.strictObject({ idea: IdeaId }),
    output: z.object({
      status: IdeaStatus,
      latest: z.number().int(),
      history: z.array(StatusChange),
      /** The people and groups asked to review it (set_reviewer). */
      reviewers: z.array(GrantSubject),
      reviews: z.array(Review),
    }),
  }),

  setStatus: defineOperation({
    name: 'set_status',
    summary: "Change an open idea's status",
    description:
      'Moves an open idea to draft, requesting review or changes in progress. A closed idea has to be reopened first. A verdict never moves it: people do. Needs edit access.',
    method: 'POST',
    path: '/ideas/{idea}/status',
    kind: 'write',
    input: z.strictObject({ idea: IdeaId, status: OpenStatus, note: z.string().trim().max(5000).optional() }),
    output: z.object({ status: IdeaStatus }),
  }),

  closeIdea: defineOperation({
    name: 'close_idea',
    summary: 'Close an idea',
    description:
      "Closes an idea as accepted (it goes ahead) or rejected (it doesn't), with an optional note. Closing as accepted is refused with blocked while any reviewer's Request changes or Reject stands (details: the objections): they change their verdict, or someone with edit access dismisses it. Needs edit access.",
    method: 'POST',
    path: '/ideas/{idea}/close',
    kind: 'write',
    input: z.strictObject({
      idea: IdeaId,
      reason: z.enum(['accepted', 'rejected']),
      note: z.string().trim().max(5000).optional(),
    }),
    output: z.object({ status: IdeaStatus }),
  }),

  reopenIdea: defineOperation({
    name: 'reopen_idea',
    summary: 'Reopen an idea',
    description: 'Opens a closed idea again, in the open status it had before it closed. Needs edit access.',
    method: 'POST',
    path: '/ideas/{idea}/reopen',
    kind: 'write',
    input: z.strictObject({ idea: IdeaId, note: z.string().trim().max(5000).optional() }),
    output: z.object({ status: IdeaStatus }),
  }),

  reviewIdea: defineOperation({
    name: 'review_idea',
    summary: 'Review an idea',
    description:
      "Gives your verdict on the latest version: approve, request changes or reject, with an optional summary. `version` is the one you read; if there's a newer one, it's refused with stale_version. Your new verdict replaces your last. Approvals count only on the latest version and only from people (a bot's shows, but never counts); a Request changes or Reject stands through later versions until you change it or it's dismissed. You can't review your own idea, or a closed one. Needs view access.",
    method: 'POST',
    path: '/ideas/{idea}/reviews',
    kind: 'write',
    input: z.strictObject({
      idea: IdeaId,
      version: z.number().int().positive(),
      verdict: Verdict,
      body: z.string().trim().max(20_000).optional(),
    }),
    output: Review,
  }),

  dismissReview: defineOperation({
    name: 'dismiss_review',
    summary: "Dismiss a reviewer's objection",
    description:
      "Dismisses a reviewer's standing Request changes or Reject (named as list_reviews names the reviewer), with a reason, so it no longer stops the idea closing as accepted. Their verdict still shows, as dismissed. Needs edit access.",
    method: 'POST',
    path: '/ideas/{idea}/reviews/{reviewer}/dismiss',
    kind: 'write',
    input: z.strictObject({
      idea: IdeaId,
      reviewer: z.string().min(1).max(300),
      reason: z.string().trim().min(1).max(5000),
    }),
    output: Review,
  }),

  ...directoryOperations,
} as const

export type Operations = typeof operations
export type OperationKey = keyof Operations

/** Error details, for the codes that carry them. */
export const ErrorDetails = {
  /** An edit's steps that no longer apply, or (accepting suggestions) the suggestions that don't. */
  conflict: z.object({
    conflicts: z.array(Conflict).optional(),
    skipped: z.array(Skipped).optional(),
    /** Committing the draft: its outdated changes. */
    changes: z.array(z.object({ key: z.string(), problem: z.string() })).optional(),
    /** Changing the draft: why the change is outdated. */
    problem: z.string().optional(),
  }),
  /** The draft's changes the version would make outdated. */
  draft_outdated: z.object({
    changes: z.array(z.object({ key: z.string(), change: DraftChange, by: Caller, problem: z.string() })),
  }),
  /** Closing as accepted: the reviewers' objections that stand. */
  blocked: z.object({ objections: z.array(Review) }),
  pull_first: z.object({
    latest: z.number().int(),
    files: z.array(z.object({ file: z.string(), path: z.string(), base: z.string().nullable(), latest: z.string() })),
  }),
}
