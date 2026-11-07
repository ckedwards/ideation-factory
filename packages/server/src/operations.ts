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
  isApiErrorCode,
  type Operations,
  type TokenScope,
} from '@ideaf/api'
import type { Client } from 'rivetkit/client'
import { DIRECTORY_KEY } from './actors/directory.ts'
import type { ContainerKind, Permission, Result } from './directory/types.ts'
import type { IdeaWrite, WriteResult, WriteValue } from './idea/service.ts'
import type { Registry } from './registry.ts'

const WRITE_TIMEOUT_MS = 60_000

type Need = 'view' | 'edit' | 'share'

export function createHandlers(actors: Client<Registry>): Handlers<Operations> {
  const ideaOf = (id: string) => actors.idea.getOrCreate([id])
  const directory = () => actors.directory.getOrCreate(DIRECTORY_KEY)

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

  /** Sends a write through the idea's queue, keyed per caller so two callers' keys can't collide. */
  const write = async <T>(
    id: string,
    context: Context,
    body: IdeaWrite,
    pick: (value: WriteValue) => T,
  ): Promise<HandlerResult<T>> => {
    const key = `${context.caller.user}:${context.key ?? crypto.randomUUID()}`
    const sent = await ideaOf(id).send(
      'writes',
      { key, caller: context.caller, write: body },
      { wait: true, timeout: WRITE_TIMEOUT_MS },
    )
    if (sent.status !== 'completed' || !sent.response) {
      return {
        ok: false,
        error: { code: 'timed_out', message: 'the write timed out; retry it with the same idempotency key' },
      }
    }
    const result: WriteResult = sent.response
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
      const teamId = input.team ? ((await directory().team(input.team))?.id ?? null) : null
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
      // registering is safe to repeat, so a retry after a failure here fixes it
      const now = Date.now()
      await directory().registerIdea({
        id,
        title: input.title,
        team: teamId,
        owner: context.caller.user,
        status: 'draft',
        latest: 1,
        createdAt: now,
        updatedAt: now,
      })
      return created
    },

    getIdea: async (input, { caller, token }) => {
      const checked = await access(input.idea, { caller, token }, 'view')
      if (!checked.ok) {
        return { ok: false, error: checked.error }
      }
      return read(async () => {
        const [summary, row] = await Promise.all([ideaOf(input.idea).summary(), directory().idea(input.idea)])
        return summary
          ? { ...summary, team: row?.team ?? null, you: checked.permission }
          : notFound("this idea doesn't exist")
      })
    },

    showBlocks: (input, { caller, token }) =>
      withAccess(input.idea, { caller, token }, 'view', () =>
        read(async () => {
          const idea = ideaOf(input.idea)
          const v = input.version ?? (await idea.summary())?.latest ?? notFound("this idea doesn't exist")
          const [files, comments] = await Promise.all([idea.outline(v), idea.comments(v)])
          return { version: v, files, comments: comments.filter((c) => !c.resolved && c.state !== 'outdated') }
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
        write(input.idea, context, { type: 'edit', batch: input.batch }, version),
      ),

    listComments: (input, { caller, token }) =>
      withAccess(input.idea, { caller, token }, 'view', () => read(() => ideaOf(input.idea).comments(input.version))),

    addComment: (input, context) =>
      withAccess(input.idea, context, 'view', () =>
        write(
          input.idea,
          context,
          { type: 'comment', version: input.version, anchor: input.anchor, body: input.body },
          comment,
        ),
      ),

    reply: (input, context) =>
      withAccess(input.idea, context, 'view', () =>
        write(input.idea, context, { type: 'reply', parent: input.comment, body: input.body }, comment),
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

    me: (_input, { caller }) =>
      read(async () => {
        const user = await directory().user(caller.user)
        return user ?? notFound('unknown user')
      }),

    findUsers: (input) => read(async () => ({ items: await directory().findUsers(input.q, input.limit) })),
    getUser: (input) =>
      read(async () => (await directory().user(input.user)) ?? notFound(`no one is called ${input.user}`)),

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
        return directory().listIdeas(
          caller.user,
          {
            ...(team ? { team: team.id } : {}),
            ...(owner ? { owner: owner.id } : {}),
            ...(input.status ? { status: input.status } : {}),
            ...(input.cursor ? { cursor: input.cursor } : {}),
            ...(input.limit ? { limit: input.limit } : {}),
          },
          token?.id ?? null,
        )
      }),

    searchIdeas: (input, { caller, token }) =>
      read(() => directory().searchIdeas(caller.user, input.q, input.limit, token?.id ?? null)),

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
        }),
      ),
    listTeamMembers: team.members,
    addTeamMember: team.addMember,
    removeTeamMember: team.removeMember,
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
