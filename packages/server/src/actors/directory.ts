// The directory actor: one for the deployment, a thin shell around
// SqlDirectory. Reads and writes are actions; writes stay correct when they run
// at once because the tables' keys and transactions make them so, not the
// actor's queue. Index updates from idea actors come through the queue instead,
// sent without waiting, and are applied in batches.
import { actor, queue, UserError } from 'rivetkit'
import { db } from 'rivetkit/db'
import type { Auth } from '../auth/config.ts'
import {
  authInDirectory,
  ensureCliClient,
  rotateSigningKeys,
  handleAuthRequest,
  migrateAuth,
  setInactive,
  verifyPersonalToken,
  type WireRequest,
} from '../auth/in-directory.ts'
import { nodeDeps } from '../deps.ts'
import { migrateDirectory } from '../directory/schema.ts'
import { fts5Search } from '../directory/search.ts'
import { SqlDirectory } from '../directory/sql-directory.ts'
import type {
  ContainerKind,
  CreatePolicy,
  Directory,
  GrantSubject,
  IdeaFilter,
  IdeaRow,
  MoveAdjustments,
  Result,
  Role,
  TeamDefaults,
} from '../directory/types.ts'

const search = fts5Search()

export type IndexUpdate = Pick<IdeaRow, 'id' | 'title' | 'status' | 'latest' | 'updatedAt'>

export const directory = actor({
  db: db({
    onMigrate: async (database) => {
      await migrateDirectory(database, [search.migrate])
      // Better Auth's own tables, by its own migrations (see auth/in-directory.ts)
      await migrateAuth(database, nodeDeps().auth)
    },
  }),
  queues: { index: queue<IndexUpdate>() },
  createVars: () => ({ directory: null as Directory | null, auth: null as Auth | null }),
  // the cli's OAuth client, there before anyone signs in with it
  onWake: (c) => ensureCliClient(authOf(c), nodeDeps().auth),
  run: async (c) => {
    const d = directoryOf(c)
    for (;;) {
      const batch = await c.queue.nextBatch({ count: 50 })
      // only the newest update per idea matters
      const latest = new Map<string, IndexUpdate>()
      for (const message of batch) {
        const u = message.body as IndexUpdate
        const seen = latest.get(u.id)
        if (!seen || seen.updatedAt <= u.updatedAt) {
          latest.set(u.id, u)
        }
      }
      for (const update of latest.values()) {
        try {
          await d.updateIdea(update)
        } catch (error) {
          c.log.error({ msg: 'index update failed', idea: update.id, error: String(error) })
        }
      }
    }
  },
  actions: {
    // sign-in: forwarded requests, personal tokens, and status
    auth: (c, request: WireRequest) => handleAuthRequest(authOf(c), request),
    /** Replaces the token signing key (see rotateSigningKeys); `bun packages/server/src/admin.ts` calls it. */
    rotateSigningKeys: (c, emergency: boolean) => rotateSigningKeys(authOf(c), emergency),
    verifyToken: (c, token: string) => verifyPersonalToken(authOf(c), nodeDeps().auth, directoryOf(c), token),
    setInactive: (c, id: string, inactive: boolean) => setInactive(authOf(c), id, inactive),

    ensureUser: (c, user: { id: string; handle: string; name: string; email?: string }) =>
      directoryOf(c).ensureUser(user),
    user: (c, id: string) => directoryOf(c).user(id),
    findUsers: (c, query: string, limit?: number) => directoryOf(c).findUsers(query, limit),
    createTeam: (c, by: string, input: { handle: string; name: string; description?: string }) =>
      directoryOf(c).createTeam(by, input),
    createGroup: (c, by: string, input: { handle: string; name: string; description?: string }) =>
      directoryOf(c).createGroup(by, input),
    team: (c, id: string) => directoryOf(c).team(id),
    group: (c, id: string) => directoryOf(c).group(id),
    teams: (c, options?: { query?: string; cursor?: string; limit?: number }) => directoryOf(c).teams(options),
    groups: (c, options?: { query?: string; cursor?: string; limit?: number }) => directoryOf(c).groups(options),
    updateTeam: (c, by: string, team: string, changes: { createPolicy?: CreatePolicy; defaults?: TeamDefaults }) =>
      directoryOf(c).updateTeam(by, team, changes),
    members: (c, kind: ContainerKind, id: string, options?: { cursor?: string; limit?: number }) =>
      directoryOf(c).members(kind, id, options),
    addMember: (c, by: string, kind: ContainerKind, id: string, user: string, role?: Role) =>
      directoryOf(c).addMember(by, kind, id, user, role),
    removeMember: (c, by: string, kind: ContainerKind, id: string, user: string) =>
      directoryOf(c).removeMember(by, kind, id, user),
    requestToJoin: (c, by: string, kind: ContainerKind, id: string) => directoryOf(c).requestToJoin(by, kind, id),
    joinRequests: (c, by: string, kind: ContainerKind, id: string) => directoryOf(c).joinRequests(by, kind, id),
    decide: (c, by: string, kind: ContainerKind, id: string, user: string, approve: boolean) =>
      directoryOf(c).decide(by, kind, id, user, approve),
    canCreateIdea: (c, by: string, team: string | null, token?: string | null) =>
      directoryOf(c).canCreateIdea(by, team, token),
    tokenGrant: (c, id: string) => directoryOf(c).tokenGrant(id),
    revokeTokenGrant: (c, by: string, id: string) => directoryOf(c).revokeTokenGrant(by, id),
    registerIdea: (c, row: IdeaRow) => directoryOf(c).registerIdea(row),
    updateIdea: (c, row: IndexUpdate) => directoryOf(c).updateIdea(row),
    idea: (c, id: string) => directoryOf(c).idea(id),
    permission: (c, idea: string, user: string, token?: string | null) => directoryOf(c).permission(idea, user, token),
    grants: (c, idea: string) => directoryOf(c).grants(idea),
    setGrant: (c, by: string, idea: string, subject: GrantSubject, access: { edit: boolean; share: boolean } | null) =>
      directoryOf(c).setGrant(by, idea, subject, access),
    previewMove: (c, by: string, idea: string, to: string | null, adjustments?: MoveAdjustments) =>
      directoryOf(c).previewMove(by, idea, to, adjustments),
    moveIdea: (c, by: string, idea: string, to: string | null, adjustments?: MoveAdjustments) =>
      directoryOf(c).moveIdea(by, idea, to, adjustments),
    listIdeas: (c, by: string, filter?: IdeaFilter, token?: string | null) =>
      directoryOf(c).listIdeas(by, filter, token),
    searchIdeas: (c, by: string, query: string, limit?: number, token?: string | null) =>
      directoryOf(c).searchIdeas(by, query, limit, token),
  },
})

type DirectoryContext = {
  db: Parameters<typeof migrateDirectory>[0]
  vars: { directory: Directory | null; auth: Auth | null }
}

/** Better Auth for this wake-up, on the actor's database. */
function authOf(c: DirectoryContext): Auth {
  c.vars.auth ??= authInDirectory(c.db, nodeDeps().auth, directoryOf(c))
  return c.vars.auth
}

function directoryOf(c: DirectoryContext): Directory {
  if (!c.vars.directory) {
    c.vars.directory = new SqlDirectory({ sql: c.db, search })
  }
  return c.vars.directory
}

/** For callers that want a Result's failure as an error. */
export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new UserError(result.error.message, { code: result.error.code })
  }
  return result.value
}

export const DIRECTORY_KEY = ['main']
