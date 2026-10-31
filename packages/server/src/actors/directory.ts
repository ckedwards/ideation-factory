// The directory actor: one for the deployment, a thin shell around
// SqlDirectory. Reads and writes are actions; writes stay correct when they run
// at once because the tables' keys and transactions make them so, not the
// actor's queue. Index updates from idea actors come through the queue instead,
// sent without waiting, and are applied in batches.
import { actor, queue, UserError } from 'rivetkit'
import { db } from 'rivetkit/db'
import { migrateDirectory } from '../directory/schema.ts'
import { fts5Search } from '../directory/search.ts'
import { SqlDirectory } from '../directory/sql-directory.ts'
import type { ContainerKind, CreatePolicy, Directory, GrantSubject, IdeaFilter, IdeaRow, Result, Role, TeamDefaults } from '../directory/types.ts'

const search = fts5Search()

export type IndexUpdate = Pick<IdeaRow, 'id' | 'title' | 'status' | 'latest' | 'updatedAt'>

export const directory = actor({
  db: db({ onMigrate: (database) => migrateDirectory(database, [search.migrate]) }),
  queues: { index: queue<IndexUpdate>() },
  createVars: () => ({ directory: null as Directory | null }),
  run: async (c) => {
    const d = directoryOf(c)
    for (;;) {
      const batch = await c.queue.nextBatch({ count: 50 })
      // only the newest update per idea matters
      const latest = new Map<string, IndexUpdate>()
      for (const message of batch) {
        const u = message.body as IndexUpdate
        const seen = latest.get(u.id)
        if (!seen || seen.updatedAt <= u.updatedAt) latest.set(u.id, u)
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
    ensureUser: (c, user: { id: string; handle: string; name: string; email?: string }) => directoryOf(c).ensureUser(user),
    user: (c, id: string) => directoryOf(c).user(id),
    findUsers: (c, query: string, limit?: number) => directoryOf(c).findUsers(query, limit),
    createTeam: (c, by: string, input: { handle: string; name: string; description?: string }) => directoryOf(c).createTeam(by, input),
    createGroup: (c, by: string, input: { handle: string; name: string; description?: string }) => directoryOf(c).createGroup(by, input),
    team: (c, id: string) => directoryOf(c).team(id),
    group: (c, id: string) => directoryOf(c).group(id),
    teams: (c, options?: { query?: string; cursor?: string; limit?: number }) => directoryOf(c).teams(options),
    groups: (c, options?: { query?: string; cursor?: string; limit?: number }) => directoryOf(c).groups(options),
    updateTeam: (c, by: string, team: string, changes: { createPolicy?: CreatePolicy; defaults?: TeamDefaults }) => directoryOf(c).updateTeam(by, team, changes),
    members: (c, kind: ContainerKind, id: string, options?: { cursor?: string; limit?: number }) => directoryOf(c).members(kind, id, options),
    addMember: (c, by: string, kind: ContainerKind, id: string, user: string, role?: Role) => directoryOf(c).addMember(by, kind, id, user, role),
    removeMember: (c, by: string, kind: ContainerKind, id: string, user: string) => directoryOf(c).removeMember(by, kind, id, user),
    requestToJoin: (c, by: string, kind: ContainerKind, id: string) => directoryOf(c).requestToJoin(by, kind, id),
    joinRequests: (c, by: string, kind: ContainerKind, id: string) => directoryOf(c).joinRequests(by, kind, id),
    decide: (c, by: string, kind: ContainerKind, id: string, user: string, approve: boolean) => directoryOf(c).decide(by, kind, id, user, approve),
    canCreateIdea: (c, by: string, team: string | null) => directoryOf(c).canCreateIdea(by, team),
    registerIdea: (c, row: IdeaRow) => directoryOf(c).registerIdea(row),
    updateIdea: (c, row: IndexUpdate) => directoryOf(c).updateIdea(row),
    idea: (c, id: string) => directoryOf(c).idea(id),
    permission: (c, idea: string, user: string) => directoryOf(c).permission(idea, user),
    grants: (c, idea: string) => directoryOf(c).grants(idea),
    setGrant: (c, by: string, idea: string, subject: GrantSubject, access: { edit: boolean; share: boolean } | null) => directoryOf(c).setGrant(by, idea, subject, access),
    listIdeas: (c, by: string, filter?: IdeaFilter) => directoryOf(c).listIdeas(by, filter),
    searchIdeas: (c, by: string, query: string, limit?: number) => directoryOf(c).searchIdeas(by, query, limit),
  },
})

function directoryOf(c: { db: Parameters<typeof migrateDirectory>[0]; vars: { directory: Directory | null } }): Directory {
  if (!c.vars.directory) c.vars.directory = new SqlDirectory({ sql: c.db, search })
  return c.vars.directory
}

/** For callers that want a Result's failure as an error. */
export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new UserError(result.error.message, { code: result.error.code })
  return result.value
}

export const DIRECTORY_KEY = ['main']
