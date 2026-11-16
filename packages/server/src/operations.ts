// The server's implementation of each operation in @ideaf/api, on the idea
// actors and the directory actor. Handlers are typed by the operations'
// schemas, so a response that drifts from what's published doesn't compile.
//
// Access: every idea operation checks the caller's permission in the directory
// first (view to read or comment, edit to change, share to change access). An
// idea you can't view is "not found", so its existence isn't revealed.
import {
  type Caller,
  type Context,
  type HandlerResult,
  type Handlers,
  type IdeaStatus,
  isApiErrorCode,
  type Operations,
  type TokenScope,
} from '@ideaf/api'
import type { Client } from 'rivetkit/client'
import { directoryOf, ideaOf as ideaActor } from './actors/pools.ts'
import { nodeDeps } from './deps.ts'
import type {
  ContainerKind,
  Grant,
  IdeaListing,
  MemberSort,
  Permission,
  RequirementCheck,
  Result,
} from './directory/types.ts'
import { reviewerOf } from './idea/reviewer.ts'
import type { IdeaWrite, WriteResult, WriteValue } from './idea/service.ts'
import type { Registry } from './registry.ts'

/** Whether an actor call failed with this code: RivetKit's own (an action that ran too long is timed_out), or an action's. */
const isRivetCode = (error: unknown, code: string) =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code

/** Whether this deployment sends notification emails (otherwise nobody sees email settings). */
const emailAvailable = () => nodeDeps().email !== null

type Need = 'view' | 'edit' | 'share'

export function createHandlers(actors: Client<Registry>): Handlers<Operations> {
  const ideaOf = (id: string) => ideaActor(actors, id)
  const directory = () => directoryOf(actors)

  /** The caller's permission on an idea, or the error to return if it isn't enough. */
  /** The caller, and their token's grant if it has one (which narrows what they can do). */
  type Who = { caller: Caller; token: TokenScope | null }

  const access = async (
    idea: string,
    { caller, token }: Who,
    need: Need,
  ): Promise<
    { ok: true; permission: Permission } | { ok: false; error: { code: 'not_found' | 'forbidden'; message: string } }
  > => {
    const permission = await directory().permission(idea, caller.user, token?.id ?? null)
    if (!permission.view) {
      return { ok: false, error: { code: 'not_found', message: "this idea doesn't exist, or you can't see it" } }
    }
    if (need === 'edit' && !permission.edit) {
      return {
        ok: false,
        error: { code: 'forbidden', message: 'you can view and comment on this idea, but not edit it' },
      }
    }
    if (need === 'share' && !permission.share) {
      return {
        ok: false,
        error: { code: 'forbidden', message: 'you need share access to change who can see this idea' },
      }
    }
    return { ok: true, permission }
  }

  /** Runs `fn` only if the caller has `need` on the idea. */
  const withAccess = async <T>(
    idea: string,
    who: Who,
    need: Need,
    fn: () => Promise<HandlerResult<T>>,
  ): Promise<HandlerResult<T>> => {
    const checked = await access(idea, who, need)
    return checked.ok ? fn() : { ok: false, error: checked.error }
  }

  /** Sends a write to the idea's actor, keyed per caller so two callers' keys can't collide. */
  const write = async <T>(
    id: string,
    context: Context,
    body: IdeaWrite,
    pick: (value: WriteValue) => T,
  ): Promise<HandlerResult<T>> => {
    const key = `${context.caller.user}:${context.key ?? crypto.randomUUID()}`
    let result: WriteResult
    try {
      result = await ideaOf(id).write({ key, caller: context.caller, write: body })
    } catch (error) {
      // the idea's actor took too long, or is busy with writes waiting: the same key returns the same answer
      if (isRivetCode(error, 'timed_out') || isRivetCode(error, 'busy')) {
        return {
          ok: false,
          error: { code: 'timed_out', message: 'the write timed out; retry it with the same idempotency key' },
        }
      }
      throw error
    }
    if (!result.ok) {
      return { ok: false, error: result.error }
    }
    return { ok: true, value: pick(result.value) }
  }

  const version = (value: WriteValue) => {
    if (value.kind !== 'version') {
      throw new Error(`expected a new version, got ${value.kind}`)
    }
    return { version: value.version, comments: value.comments, steps: value.steps }
  }
  const status = (value: WriteValue) => {
    if (value.kind !== 'status') {
      throw new Error(`expected a status, got ${value.kind}`)
    }
    return { status: value.status, from: value.from }
  }

  /** The idea's team's requirements, checked against its reviews now. */
  const requirementsOf = async (idea: string, viewer: string | null = null) => {
    const reviews = await ideaOf(idea).reviews(viewer)
    const approvers = reviews.reviews.filter((r) => r.counts).map((r) => r.by.user)
    return { reviews, check: await directory().checkRequirements(idea, approvers, reviews.openThreads) }
  }
  /** An idea's reviews as list_reviews gives them, its grants already read. */
  const reviewsWith = async (idea: string, viewer: string | null, grants: Grant[]) => {
    const { reviews, check } = await requirementsOf(idea, viewer)
    const { openThreads: _open, ...rest } = reviews
    return { ...rest, reviewers: grants.filter((g) => g.reviewer).map((g) => g.subject), requirements: check }
  }
  /** A version's comments as show_blocks lists them: the open ones. */
  const openThreads = <C extends { resolved: boolean; state: string }>(comments: C[]) =>
    comments.filter((c) => !c.resolved && c.state !== 'outdated')
  const review = (value: WriteValue) => {
    if (value.kind !== 'review') {
      throw new Error(`expected a review, got ${value.kind}`)
    }
    return { review: value.review, published: value.published }
  }
  const pendingGone = (value: WriteValue) => {
    if (value.kind !== 'pending') {
      throw new Error(`expected pending comments, got ${value.kind}`)
    }
    return { deleted: value.comments }
  }
  const comment = (value: WriteValue) => {
    if (value.kind !== 'comment') {
      throw new Error(`expected a comment, got ${value.kind}`)
    }
    return { comment: value.comment }
  }

  /** A person, by ID or handle, or a not-found error. */
  const person = async (
    ref: string,
  ): Promise<{ ok: true; id: string } | { ok: false; error: { code: 'not_found'; message: string } }> => {
    const user = await directory().user(ref)
    return user
      ? { ok: true, id: user.id }
      : { ok: false, error: { code: 'not_found', message: `no one is called ${ref}` } }
  }

  const membership = (kind: ContainerKind) => ({
    members: (input: Record<string, unknown>) =>
      read(async () => {
        const c =
          kind === 'team' ? await directory().team(String(input[kind])) : await directory().group(String(input[kind]))
        if (!c) {
          return notFound(`no ${kind} ${String(input[kind])}`)
        }
        return directory().members(kind, c.id, {
          ...(input.cursor ? { cursor: String(input.cursor) } : {}),
          ...(input.limit ? { limit: Number(input.limit) } : {}),
          ...(input.q ? { query: String(input.q) } : {}),
          ...(input.sort ? { sort: input.sort as MemberSort } : {}),
          ...(input.order ? { order: input.order as 'asc' | 'desc' } : {}),
        })
      }),
    addMember: async (input: Record<string, unknown>, context: Context) => {
      const who = await person(String(input.user))
      if (!who.ok) {
        return who
      }
      return fromResult(
        await directory().addMember(
          context.caller.user,
          kind,
          String(input[kind]),
          who.id,
          input.role as 'admin' | 'maintainer' | 'member' | undefined,
        ),
      )
    },
    removeMember: async (input: Record<string, unknown>, context: Context) => {
      const who = await person(String(input.user))
      if (!who.ok) {
        return who
      }
      const removed = await directory().removeMember(context.caller.user, kind, String(input[kind]), who.id)
      return removed.ok ? { ok: true as const, value: { removed: true } } : removed
    },
    requestToJoin: async (input: Record<string, unknown>, context: Context) =>
      fromResult(await directory().requestToJoin(context.caller.user, kind, String(input[kind]))),
    joinRequests: async (input: Record<string, unknown>, context: Context) => {
      const requests = await directory().joinRequests(context.caller.user, kind, String(input[kind]))
      return requests.ok ? { ok: true as const, value: { items: requests.value } } : requests
    },
    decide: async (input: Record<string, unknown>, context: Context) => {
      const who = await person(String(input.user))
      if (!who.ok) {
        return who
      }
      const decided = await directory().decide(
        context.caller.user,
        kind,
        String(input[kind]),
        who.id,
        Boolean(input.approve),
      )
      return decided.ok ? { ok: true as const, value: { approved: Boolean(input.approve) } } : decided
    },
  })
  const team = membership('team')
  const group = membership('group')

  return {
    // --- ideas ---------------------------------------------------------------------

    createIdea: async (input, context) => {
      const allowed = await directory().canCreateIdea(
        context.caller.user,
        input.team ?? null,
        context.token?.id ?? null,
      )
      if (!allowed.ok) {
        return allowed
      }
      // two directory calls in all, each reusing what it read: every statement in the directory counts against
      // everyone's requests (packages/load measured creating ideas at about 15 statements each over four calls)
      const teamId = allowed.value.team
      // the ID comes from the caller and the idempotency key, so a retried create finds the same idea
      const key = context.key ?? crypto.randomUUID()
      const id = await ideaIdFor(context.caller, key)
      const created = await write(
        id,
        { ...context, key },
        {
          type: 'create',
          title: input.title,
          ...(input.description !== undefined ? { description: input.description } : {}),
          files: input.files,
          ...(input.gitHint ? { gitHint: input.gitHint } : {}),
          ...(input.status ? { status: input.status } : {}),
        },
        (value) => {
          if (value.kind !== 'created') {
            throw new Error(`expected a new idea, got ${value.kind}`)
          }
          return { idea: id, version: value.version }
        },
      )
      if (!created.ok) {
        return created
      }
      const now = Date.now()
      // batched in the directory, so ideas created at once share a commit: one each held the directory
      // for everyone else's reads (packages/load). Registering is safe to repeat: a retry finds the same place.
      const answer = await directory().register({
        id,
        title: input.title,
        description: input.description ?? '',
        team: teamId,
        owner: context.caller.user,
        status: input.status ?? 'draft',
        latest: 1,
        createdAt: now,
        updatedAt: now,
      })
      if (!answer.ok) {
        throw new Error(`registering idea ${id} didn't finish; retry with the same idempotency key`)
      }
      const place = answer.place
      if (input.status === 'requesting-review') {
        await directory().requestRuleGroups(id)
      }
      return { ok: true, value: { ...created.value, place: place.place, number: place.number } }
    },

    // one directory call for what get_idea needs from it: the access check, the team and the address
    getIdea: (input, { caller, token }) =>
      read(async () => {
        const [summary, found] = await Promise.all([
          ideaOf(input.idea).summary(),
          directory().ideaFor(input.idea, caller.user, token?.id ?? null),
        ])
        if (!found?.permission.view) {
          return notFound("this idea doesn't exist, or you can't see it")
        }
        return summary
          ? {
              ...summary,
              team: found.team,
              place: found.place.place,
              number: found.place.number,
              you: found.permission,
            }
          : notFound("this idea doesn't exist")
      }),

    // an idea's page in one read: one directory call for access, grants, team and subscription where the
    // separate reads made eight or ten, each waiting its turn (packages/load measured the directory saturating)
    openIdea: (input, { caller, token }) =>
      read(async () => {
        const idea = ideaOf(input.idea)
        const [page, summary] = await Promise.all([
          directory().ideaPage(input.idea, caller.user, token?.id ?? null),
          idea.summary(),
        ])
        if (!page?.access.permission.view) {
          return notFound("this idea doesn't exist, or you can't see it")
        }
        if (!summary) {
          return notFound("this idea doesn't exist")
        }
        const version = input.version ?? summary.latest
        const viewer = reviewerOf(caller)
        const [files, outline, comments, reviews] = await Promise.all([
          idea.pull(version),
          idea.outline(version),
          idea.comments(version, viewer),
          reviewsWith(input.idea, viewer, page.grants),
        ])
        return {
          idea: {
            ...summary,
            team: page.access.team,
            place: page.access.place.place,
            number: page.access.place.number,
            you: page.access.permission,
          },
          files,
          outline: { version, files: outline, comments: openThreads(comments) },
          comments,
          reviews,
          subscription: page.subscription,
          team: page.team,
        }
      }),

    findIdea: (input, { caller, token }) =>
      read(
        async () =>
          (await directory().findIdeaFor(input.place, input.number, caller.user, token?.id ?? null)) ??
          notFound(`there's no ${input.place}/idea/${input.number}, or you can't see it`),
      ),

    listReviews: (input, { caller, token }) =>
      withAccess(input.idea, { caller, token }, 'view', () =>
        read(async () => reviewsWith(input.idea, reviewerOf(caller), await directory().grants(input.idea))),
      ),

    setStatus: (input, context) =>
      withAccess(input.idea, context, 'edit', async () => {
        const done = await write(
          input.idea,
          context,
          { type: 'status', status: input.status, ...(input.note ? { note: input.note } : {}) },
          status,
        )
        if (!done.ok) {
          return done
        }
        // out of draft: the team's rules ask their groups to review
        if (done.value.from === 'draft' && done.value.status !== 'draft') {
          await directory().requestRuleGroups(input.idea)
        }
        return { ok: true, value: { status: done.value.status } }
      }),

    closeIdea: (input, context) =>
      withAccess(input.idea, context, 'edit', async () => {
        if (input.reason === 'accepted') {
          // the requirements, checked here; the objections, by the idea as it closes
          const { check } = await requirementsOf(input.idea)
          if (!check.met) {
            const unmet = check.checks.filter((c) => !c.met)
            return {
              ok: false,
              error: {
                code: 'blocked',
                message: `its team's approval requirements aren't met yet: ${unmet.map(describeCheck).join('; ')}`,
                details: { unmet },
              },
            }
          }
        }
        const done = await write(
          input.idea,
          context,
          { type: 'close', reason: input.reason, ...(input.note ? { note: input.note } : {}) },
          status,
        )
        return done.ok ? { ok: true, value: { status: done.value.status } } : done
      }),

    reopenIdea: (input, context) =>
      withAccess(input.idea, context, 'edit', async () => {
        const done = await write(
          input.idea,
          context,
          { type: 'reopen', ...(input.note ? { note: input.note } : {}) },
          status,
        )
        return done.ok ? { ok: true, value: { status: done.value.status } } : done
      }),

    reviewIdea: (input, context) =>
      withAccess(input.idea, context, 'view', () =>
        write(
          input.idea,
          context,
          {
            type: 'review',
            version: input.version,
            ...(input.verdict ? { verdict: input.verdict } : {}),
            ...(input.body ? { body: input.body } : {}),
          },
          review,
        ),
      ),

    dismissReview: (input, context) =>
      withAccess(input.idea, context, 'edit', () =>
        write(input.idea, context, { type: 'dismiss', reviewer: input.reviewer, reason: input.reason }, (value) => {
          const done = review(value)
          if (!done.review) {
            throw new Error('a dismissed verdict is missing')
          }
          return done.review
        }),
      ),

    editPendingComment: (input, context) =>
      withAccess(input.idea, context, 'view', () =>
        write(input.idea, context, { type: 'amend', comment: input.comment, body: input.body }, () => ({
          comment: input.comment,
        })),
      ),

    deletePendingComment: (input, context) =>
      withAccess(input.idea, context, 'view', () =>
        write(input.idea, context, { type: 'drop', comment: input.comment }, pendingGone),
      ),

    discardReview: (input, context) =>
      withAccess(input.idea, context, 'view', () => write(input.idea, context, { type: 'unreview' }, pendingGone)),

    showBlocks: (input, { caller, token }) =>
      withAccess(input.idea, { caller, token }, 'view', () =>
        read(async () => {
          const idea = ideaOf(input.idea)
          const v = input.version ?? (await idea.summary())?.latest ?? notFound("this idea doesn't exist")
          const [files, comments] = await Promise.all([idea.outline(v), idea.comments(v, reviewerOf(caller))])
          return { version: v, files, comments: openThreads(comments) }
        }),
      ),

    pull: (input, { caller, token }) =>
      withAccess(input.idea, { caller, token }, 'view', () => read(() => ideaOf(input.idea).pull(input.version))),

    sync: (input, context) =>
      withAccess(input.idea, context, 'edit', () =>
        write(
          input.idea,
          context,
          {
            type: 'upload',
            files: input.files,
            ...(input.deleted ? { deleted: input.deleted } : {}),
            ...(input.force !== undefined ? { force: input.force } : {}),
            ...(input.outdateDraft ? { outdateDraft: true } : {}),
            ...(input.gitHint ? { gitHint: input.gitHint } : {}),
          },
          version,
        ),
      ),

    previewEdit: (input, { caller, token }) =>
      withAccess(input.idea, { caller, token }, 'edit', async () => {
        const result = await read(() => ideaOf(input.idea).preview(input.batch))
        if (!result.ok) {
          return result
        }
        return result.value.ok ? { ok: true, value: result.value } : { ok: false, error: result.value.error }
      }),

    edit: (input, context) =>
      withAccess(input.idea, context, 'edit', () =>
        write(
          input.idea,
          context,
          { type: 'edit', batch: input.batch, ...(input.outdateDraft ? { outdateDraft: true } : {}) },
          version,
        ),
      ),

    listComments: (input, { caller, token }) =>
      withAccess(input.idea, { caller, token }, 'view', () =>
        read(() => ideaOf(input.idea).comments(input.version, reviewerOf(caller))),
      ),

    addComment: (input, context) =>
      withAccess(input.idea, context, 'view', () =>
        write(
          input.idea,
          context,
          {
            type: 'comment',
            version: input.version,
            anchor: input.anchor,
            body: input.body,
            ...(input.pending ? { pending: true } : {}),
          },
          comment,
        ),
      ),

    reply: (input, context) =>
      withAccess(input.idea, context, 'view', () =>
        write(
          input.idea,
          context,
          { type: 'reply', parent: input.comment, body: input.body, ...(input.pending ? { pending: true } : {}) },
          comment,
        ),
      ),

    resolveComment: (input, context) =>
      withAccess(input.idea, context, 'view', () =>
        write(input.idea, context, { type: 'resolve', comment: input.comment, resolved: input.resolved }, (value) => {
          if (value.kind !== 'resolved') {
            throw new Error(`expected a resolved comment, got ${value.kind}`)
          }
          return { comment: value.comment, resolved: value.resolved }
        }),
      ),

    suggestEdit: (input, context) =>
      withAccess(input.idea, context, 'view', () =>
        write(
          input.idea,
          context,
          {
            type: 'suggest',
            version: input.version,
            anchor: input.anchor,
            new: input.new,
            body: input.body ?? '',
            ...(input.pending ? { pending: true } : {}),
          },
          (value) => {
            if (value.kind !== 'suggestion') {
              throw new Error(`expected a suggestion, got ${value.kind}`)
            }
            return { comment: value.comment, old: value.old }
          },
        ),
      ),

    suggestionSource: (input, { caller, token }) =>
      withAccess(input.idea, { caller, token }, 'view', () =>
        read(() => ideaOf(input.idea).suggestionSource(input.file, input.start, input.end)),
      ),

    acceptSuggestions: (input, context) =>
      withAccess(input.idea, context, 'edit', () =>
        write(
          input.idea,
          context,
          {
            type: 'accept',
            suggestions: input.suggestions,
            ...(input.into ? { into: input.into } : {}),
            ...(input.outdateDraft ? { outdateDraft: true } : {}),
          },
          (value) =>
            value.kind === 'drafted'
              ? { version: null, accepted: value.accepted, skipped: value.skipped }
              : {
                  version: version(value).version,
                  accepted: value.kind === 'version' ? (value.accepted ?? []) : [],
                  skipped: value.kind === 'version' ? (value.skipped ?? []) : [],
                },
        ),
      ),

    getDraft: (input, { caller, token }) =>
      withAccess(input.idea, { caller, token }, 'edit', () => read(() => ideaOf(input.idea).draft())),

    changeDraft: (input, context) =>
      withAccess(input.idea, context, 'edit', () =>
        write(input.idea, context, { type: 'draft', change: input.change }, (value) => ({
          key: value.kind === 'draft' ? (value.key ?? '') : '',
        })),
      ),

    undoDraftChange: (input, context) =>
      withAccess(input.idea, context, 'edit', () =>
        write(input.idea, context, { type: 'undraft', key: input.key }, () => ({})),
      ),

    discardDraft: (input, context) =>
      withAccess(input.idea, context, 'edit', () => write(input.idea, context, { type: 'discard' }, () => ({}))),

    commitDraft: (input, context) =>
      withAccess(input.idea, context, 'edit', () => write(input.idea, context, { type: 'commit' }, version)),

    rejectSuggestion: (input, context) =>
      withAccess(input.idea, context, 'edit', () =>
        write(input.idea, context, { type: 'reject', suggestion: input.comment }, (value) => {
          if (value.kind !== 'rejected') {
            throw new Error(`expected a rejected suggestion, got ${value.kind}`)
          }
          return { comment: value.comment }
        }),
      ),

    // --- access --------------------------------------------------------------------

    getAccess: (input, { caller, token }) =>
      read(async () => {
        const checked = await access(input.idea, { caller, token }, 'view')
        if (!checked.ok) {
          return notFound(checked.error.message)
        }
        return { you: checked.permission, grants: await directory().grants(input.idea) }
      }),

    setAccess: async (input, { caller, token }) => {
      const checked = await access(input.idea, { caller, token }, 'view')
      if (!checked.ok) {
        return { ok: false, error: checked.error }
      }
      let subject = input.subject
      if (subject.kind === 'user') {
        const who = await person(subject.id)
        if (!who.ok) {
          return who
        }
        subject = { kind: 'user', id: who.id }
      }
      const set = await directory().setGrant(caller.user, input.idea, subject, input.access)
      return set.ok ? { ok: true, value: { grants: set.value } } : set
    },

    setReviewer: async (input, { caller, token }) => {
      const checked = await access(input.idea, { caller, token }, 'view')
      if (!checked.ok) {
        return { ok: false, error: checked.error }
      }
      let subject = input.subject
      if (subject.kind === 'user') {
        const who = await person(subject.id)
        if (!who.ok) {
          return who
        }
        subject = { kind: 'user', id: who.id }
      }
      const set = await directory().setReviewer(caller.user, input.idea, subject, input.reviewer)
      return set.ok ? { ok: true, value: { grants: set.value } } : set
    },

    previewMove: async (input, { caller }) =>
      fromResult(
        await directory().previewMove(caller.user, input.idea, input.team, {
          ...(input.keep ? { keep: input.keep } : {}),
          ...(input.skip ? { skip: input.skip } : {}),
        }),
      ),

    moveIdea: async (input, { caller }) =>
      fromResult(
        await directory().moveIdea(caller.user, input.idea, input.team, {
          ...(input.keep ? { keep: input.keep } : {}),
          ...(input.skip ? { skip: input.skip } : {}),
        }),
      ),

    // --- the directory ---------------------------------------------------------------

    myMemberships: (_input, { caller }) => read(() => directory().memberships(caller.user)),

    me: (_input, { caller }) =>
      read(async () => {
        const user = await directory().user(caller.user)
        return user ?? notFound('unknown user')
      }),

    findUsers: (input) => read(async () => ({ items: await directory().findUsers(input.q, input.limit) })),
    getUser: (input) =>
      read(async () => (await directory().user(input.user)) ?? notFound(`no one is called ${input.user}`)),

    getPeople: (input) => read(async () => ({ items: await directory().users(input.ids) })),

    // --- the inbox --------------------------------------------------------------------

    listNotifications: (input, { caller, token }) =>
      read(async () => {
        const page = await directory().inbox(
          caller.user,
          {
            ...(input.done ? { done: true } : {}),
            ...(input.reason ? { reason: input.reason } : {}),
            ...(input.unread ? { unread: true } : {}),
            ...(input.cursor ? { cursor: input.cursor } : {}),
            ...(input.limit ? { limit: input.limit } : {}),
          },
          token?.id ?? null,
        )
        return { items: page.items.map((row) => ({ ...row, idea: listed(row.idea) })), next: page.next }
      }),

    unreadNotifications: (_input, { caller, token }) =>
      read(async () => ({ count: await directory().unreadCount(caller.user, token?.id ?? null) })),

    markNotifications: async (input, { caller }) =>
      read(async () => ({
        changed: await directory().markInbox(caller.user, input.ideas ?? null, {
          ...(input.read ? { read: true } : {}),
          ...(input.done !== undefined ? { done: input.done } : {}),
        }),
      })),

    getSubscription: (input, { caller, token }) =>
      withAccess(input.idea, { caller, token }, 'view', () =>
        read(() => directory().subscription(caller.user, input.idea)),
      ),

    setSubscription: async (input, { caller, token }) => {
      const checked = await access(input.idea, { caller, token }, 'view')
      if (!checked.ok) {
        return { ok: false, error: checked.error }
      }
      return fromResult(await directory().setSubscription(caller.user, input.idea, input.subscribed))
    },

    getTeamWatch: (input, { caller }) =>
      read(async () => {
        const team = await directory().team(input.team)
        return team ? { level: await directory().watch(caller.user, team.id) } : notFound(`no team ${input.team}`)
      }),

    setTeamWatch: async (input, { caller }) => {
      const set = await directory().setWatch(caller.user, input.team, input.level)
      return set.ok ? { ok: true, value: { level: set.value } } : set
    },

    getNotificationSettings: (_input, { caller }) =>
      read(async () => ({
        ...(await directory().notificationSettings(caller.user)),
        emailAvailable: emailAvailable(),
      })),

    setNotificationSettings: async (input, { caller }) => {
      const changes = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined))
      const set = await directory().setNotificationSettings(caller.user, changes)
      return set.ok ? { ok: true, value: { ...set.value, emailAvailable: emailAvailable() } } : set
    },

    listIdeas: (input, { caller, token }) =>
      read(async () => {
        const team = input.team ? await directory().team(input.team) : null
        if (input.team && !team) {
          return notFound(`no team ${input.team}`)
        }
        const owner = input.owner ? await directory().user(input.owner) : null
        if (input.owner && !owner) {
          return notFound(`no one is called ${input.owner}`)
        }
        const page = await directory().listIdeas(
          caller.user,
          {
            ...(team ? { team: team.id } : {}),
            ...(owner ? { owner: owner.id } : {}),
            ...(input.status ? { status: input.status } : {}),
            ...(input.state ? { state: input.state } : {}),
            ...(input.cursor ? { cursor: input.cursor } : {}),
            ...(input.limit ? { limit: input.limit } : {}),
          },
          token?.id ?? null,
        )
        return { items: page.items.map(listed), next: page.next }
      }),

    searchIdeas: (input, { caller, token }) =>
      read(async () => {
        const found = await directory().searchIdeas(caller.user, input.q, input.limit, token?.id ?? null)
        return { items: found.items.map(listed), incomplete: found.incomplete }
      }),

    currentToken: (_input, { caller, token }) =>
      read(async () => {
        const user = await directory().user(caller.user)
        if (!user) {
          return notFound('unknown user')
        }
        const grant = token ? await directory().tokenGrant(token.id) : null
        const limits = grant?.limits
          ? {
              teams: await Promise.all(
                grant.limits.teams.map(async (id) => ({ id, handle: (await directory().team(id))?.handle ?? id })),
              ),
              ideas: grant.limits.ideas,
              noTeam: grant.limits.noTeam,
            }
          : null
        return {
          user,
          purpose: caller.purpose,
          bot: caller.bot,
          readOnly: token?.readOnly ?? false,
          limits,
          grant: token?.id ?? null,
        }
      }),

    revokeToken: async (_input, { caller, token }) => {
      if (!token) {
        return {
          ok: false,
          error: { code: 'invalid', message: 'this token has no grant to revoke (sign out of a browser instead)' },
        }
      }
      const revoked = await directory().revokeTokenGrant(caller.user, token.id)
      return revoked.ok ? { ok: true, value: { revoked: true } } : revoked
    },

    createTeam: async (input, { caller }) => fromResult(await directory().createTeam(caller.user, container(input))),
    getTeam: (input) => read(async () => (await directory().team(input.team)) ?? notFound(`no team ${input.team}`)),
    listTeams: (input) =>
      read(() =>
        directory().teams({
          ...(input.q ? { query: input.q } : {}),
          ...(input.cursor ? { cursor: input.cursor } : {}),
          ...(input.limit ? { limit: input.limit } : {}),
        }),
      ),
    updateTeam: async (input, { caller }) =>
      fromResult(
        await directory().updateTeam(caller.user, input.team, {
          ...(input.createPolicy ? { createPolicy: input.createPolicy } : {}),
          ...(input.defaults ? { defaults: input.defaults } : {}),
          ...(input.handle !== undefined ? { handle: input.handle } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        }),
      ),
    setTeamRequirements: async (input, { caller }) =>
      fromResult(await directory().setRequirements(caller.user, input.team, input.requirements)),
    listTeamMembers: team.members,
    addTeamMember: team.addMember,
    removeTeamMember: team.removeMember,
    listTeamGroups: async (input) => {
      const groups = await directory().teamGroups(input.team)
      return groups.ok ? { ok: true as const, value: { items: groups.value } } : groups
    },
    addTeamGroup: async (input, { caller }) =>
      fromResult(await directory().addTeamGroup(caller.user, input.team, input.group, input.role)),
    removeTeamGroup: async (input, { caller }) => {
      const removed = await directory().removeTeamGroup(caller.user, input.team, input.group)
      return removed.ok ? { ok: true as const, value: { removed: true } } : removed
    },
    listGroupTeams: async (input) => {
      const teams = await directory().groupTeams(input.group)
      return teams.ok ? { ok: true as const, value: { items: teams.value } } : teams
    },
    requestToJoinTeam: team.requestToJoin,
    listTeamJoinRequests: team.joinRequests,
    decideTeamJoinRequest: team.decide,

    createGroup: async (input, { caller }) => fromResult(await directory().createGroup(caller.user, container(input))),
    getGroup: (input) =>
      read(async () => (await directory().group(input.group)) ?? notFound(`no group ${input.group}`)),
    listGroups: (input) =>
      read(() =>
        directory().groups({
          ...(input.q ? { query: input.q } : {}),
          ...(input.cursor ? { cursor: input.cursor } : {}),
          ...(input.limit ? { limit: input.limit } : {}),
        }),
      ),
    listGroupMembers: group.members,
    addGroupMember: group.addMember,
    removeGroupMember: group.removeMember,
    requestToJoinGroup: group.requestToJoin,
    listGroupJoinRequests: group.joinRequests,
    decideGroupJoinRequest: group.decide,
  }
}

const fromResult = <T>(result: Result<T>): HandlerResult<T> => result

const container = (input: { handle: string; name: string; description?: string | undefined }) => ({
  handle: input.handle,
  name: input.name,
  ...(input.description !== undefined ? { description: input.description } : {}),
})

class NotFound extends Error {}
/** A listing as the API gives it: its team and owner by name in place of their IDs. */
/** A requirement that isn't met, in words. */
function describeCheck(check: RequirementCheck): string {
  if (check.kind === 'approvals') {
    return `${check.have} of ${check.need} approvals`
  }
  if (check.kind === 'resolved') {
    return `${check.open} open ${check.open === 1 ? 'thread' : 'threads'}`
  }
  const names = check.groups.map((g) => g.handle).join(', ')
  if (check.broken) {
    return `a rule names a deleted group (${names}): a maintainer has to fix it`
  }
  return check.mode === 'each' ? `an approval from each of ${names}` : `an approval from any of ${names}`
}

function listed({ teamInfo, ownerInfo, team: _team, owner: _owner, approvers: _approvers, ...idea }: IdeaListing) {
  // the index holds what ideas send it: one of their statuses
  return { ...idea, status: idea.status as IdeaStatus, team: teamInfo, owner: ownerInfo }
}

const notFound = (message: string): never => {
  throw new NotFound(message)
}

/** Runs an actor read, turning the idea's refusals (UserErrors with our codes) into error results. */
async function read<T>(fn: () => Promise<T>): Promise<HandlerResult<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (error) {
    if (error instanceof NotFound) {
      return { ok: false, error: { code: 'not_found', message: error.message } }
    }
    const { code, message, metadata } = error as { code?: unknown; message?: string; metadata?: unknown }
    if (isApiErrorCode(code) && code !== 'internal') {
      return {
        ok: false,
        error: { code, message: message ?? code, ...(metadata === undefined ? {} : { details: metadata }) },
      }
    }
    throw error
  }
}

/** A stable idea ID for a create: the same caller and key always give the same ID. */
export async function ideaIdFor(caller: Caller, key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${caller.user}\n${key}`))
  return `i${[...new Uint8Array(digest)]
    .slice(0, 10)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`
}
