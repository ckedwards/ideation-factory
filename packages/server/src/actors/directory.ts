// The directory actor: one for the deployment, a thin shell around
// SqlDirectory. Reads and writes are actions; writes stay correct when they run
// at once because the tables' keys and transactions make them so, not the
// actor's queue. Index updates and notifications from idea actors come through
// the queue instead, sent without waiting, and are applied in batches.
// Notification emails go on an alarm: when the next is due, the actor sends
// what's due and sets the next.
import { actor, queue, UserError } from 'rivetkit'
import { db } from 'rivetkit/db'
import type { Auth } from '../auth/config.ts'
import {
  authInDirectory,
  ensureCliClient,
  rotateSigningKeys,
  handleAuthRequest,
  migrateAuth,
  releaseHandle,
  setInactive,
  verifyPersonalToken,
  type WireRequest,
} from '../auth/in-directory.ts'
import { nodeDeps } from '../deps.ts'
import { notificationEmail } from '../mail/notification.ts'
import { migrateDirectory } from '../directory/schema.ts'
import { fts5Search } from '../directory/search.ts'
import { SqlDirectory } from '../directory/sql-directory.ts'
import { callRetrying, overloadedRetryMs, retryOverloaded } from '../sql/retry.ts'
import type {
  ContainerKind,
  CreatePolicy,
  Directory,
  GrantSubject,
  IdeaFilter,
  IdeaRow,
  IndexUpdate,
  MoveAdjustments,
  Result,
  Role,
  TeamDefaults,
  TeamRequirements,
  InboxFilter,
  NotificationSettings,
  NotifyBatch,
  WatchLevel,
} from '../directory/types.ts'

const search = fts5Search()

export type { IndexUpdate }

export const directory = actor({
  db: db({
    onMigrate: async (database) => {
      await migrateDirectory(database, [search.migrate])
      // Better Auth's own tables, by its own migrations (see auth/in-directory.ts)
      await migrateAuth(database, nodeDeps().auth)
    },
  }),
  // a notification is answered once it's applied (or couldn't be), so its idea's outbox knows to keep it or not
  queues: { index: queue<IndexUpdate>(), notify: queue<NotifyBatch, { ok: boolean }>() },
  createVars: () => ({ directory: null as Directory | null, auth: null as Auth | null, sending: false }),
  onWake: async (c) => {
    // the cli's OAuth client, there before anyone signs in with it
    await ensureCliClient(authOf(c), nodeDeps().auth)
    // emails left waiting (say, the node stopped before their alarm) get one
    await scheduleEmails(c)
  },
  run: async (c) => {
    const d = directoryOf(c)
    // that an email due has a live alarm: after a notification (it may have queued one), and every
    // EMAIL_CHECK_MS, busy or not, since an alarm can be lost (see scheduleEmails)
    let emailsCheckedAt = 0
    const checkEmails = async (now: boolean) => {
      if (!now && Date.now() - emailsCheckedAt < EMAIL_CHECK_MS) {
        return
      }
      emailsCheckedAt = Date.now()
      try {
        await scheduleEmails(c)
      } catch (error) {
        c.log.error({ msg: 'scheduling emails failed', error: String(error) })
      }
    }
    while (!c.aborted) {
      // completed only once applied: one taken off the queue but not applied is answered by no one, and its idea sends it again.
      // Reading the queue can fail while storage is busy (RivetKit's own queue table is in it): wait and read again,
      // rather than let the loop end, which left notifications unread until the actor restarted
      let batch: Awaited<ReturnType<typeof c.queue.nextBatch>>
      try {
        batch = await c.queue.nextBatch({ count: 50, completable: true, timeout: EMAIL_CHECK_MS })
      } catch (error) {
        if (c.aborted) {
          return
        }
        c.log.error({ msg: 'reading the queue failed; trying again', error: String(error) })
        await Bun.sleep(Math.min(overloadedRetryMs(error) ?? 500, 2_000))
        continue
      }
      if (batch.length === 0) {
        await checkEmails(false)
        continue
      }
      // a batch's notifications in one transaction, then its index updates in another:
      // each commit writes pages, and the writes are what SQLite can do least of
      const notifying = batch.filter((m) => m.name === 'notify')
      if (notifying.length > 0) {
        const notifications = notifying.map((m) => m.body as NotifyBatch)
        // all at once; should that fail, each on its own, so each is answered for itself (IDs make repeats harmless)
        const outcomes = await d
          .notify(notifications)
          .then(() => notifications.map(() => true))
          .catch(() =>
            Promise.all(
              notifications.map((n) =>
                d.notify(n).then(
                  () => true,
                  (error: unknown) => {
                    c.log.error({ msg: 'notifying failed', idea: n.idea, id: n.id, error: String(error) })
                    return false
                  },
                ),
              ),
            ),
          )
        for (const [i, message] of notifying.entries()) {
          await callRetrying(() => message.complete({ ok: outcomes[i]! }))
        }
        await checkEmails(true)
      }
      // only the newest update per idea matters
      const latest = new Map<string, IndexUpdate>()
      for (const message of batch) {
        if (message.name !== 'index') {
          continue
        }
        const u = message.body as IndexUpdate
        const seen = latest.get(u.id)
        if (!seen || seen.updatedAt <= u.updatedAt) {
          latest.set(u.id, u)
        }
      }
      if (latest.size > 0) {
        try {
          await d.updateIdea([...latest.values()])
        } catch (error) {
          c.log.error({ msg: 'index update failed', ideas: [...latest.keys()], error: String(error) })
        }
      }
      for (const message of batch) {
        if (message.name === 'index') {
          await callRetrying(() => message.complete())
        }
      }
      await checkEmails(false)
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
    setRequirements: (c, by: string, team: string, requirements: TeamRequirements) =>
      directoryOf(c).setRequirements(by, team, requirements),
    checkRequirements: (c, idea: string, approvers: string[], open: number) =>
      directoryOf(c).checkRequirements(idea, approvers, open),
    requestRuleGroups: (c, idea: string) => directoryOf(c).requestRuleGroups(idea),
    inbox: (c, user: string, filter?: InboxFilter, token?: string | null) => directoryOf(c).inbox(user, filter, token),
    unreadCount: (c, user: string, token?: string | null) => directoryOf(c).unreadCount(user, token),
    markInbox: (c, user: string, ideas: string[] | null, change: { read?: boolean; done?: boolean }) =>
      directoryOf(c).markInbox(user, ideas, change),
    subscription: (c, user: string, idea: string) => directoryOf(c).subscription(user, idea),
    setSubscription: (c, user: string, idea: string, subscribed: boolean) =>
      directoryOf(c).setSubscription(user, idea, subscribed),
    watch: (c, user: string, team: string) => directoryOf(c).watch(user, team),
    setWatch: (c, user: string, team: string, level: WatchLevel) => directoryOf(c).setWatch(user, team, level),
    notificationSettings: (c, user: string) => directoryOf(c).notificationSettings(user),
    setNotificationSettings: (c, user: string, settings: Partial<NotificationSettings>) =>
      directoryOf(c).setNotificationSettings(user, settings),
    /** Sends the emails due (the alarm scheduleEmails sets calls it), then sets the next alarm. */
    sendEmails: async (c) => {
      const email = nodeDeps().email
      if (!email || c.vars.sending) {
        return
      }
      c.vars.sending = true
      let failed = false
      try {
        const { baseURL, secret } = nodeDeps().auth
        for (;;) {
          const due = await directoryOf(c).dueEmails(email.timing)
          for (const message of due) {
            try {
              await email.sender.send(notificationEmail(message, { baseURL, secret }))
              await directoryOf(c).emailSent(message)
            } catch (error) {
              failed = true
              c.log.error({ msg: 'sending an email failed', user: message.to.id, error: String(error) })
            }
          }
          // a full run may have left more due; a failure waits for the next alarm
          if (failed || due.length < 50) {
            break
          }
        }
      } finally {
        c.vars.sending = false
      }
      await scheduleEmails(c, failed ? email.timing.quietMs : 0)
    },
    updateTeam: (
      c,
      by: string,
      team: string,
      changes: {
        createPolicy?: CreatePolicy
        defaults?: TeamDefaults
        handle?: string
        name?: string
        description?: string
      },
    ) => directoryOf(c).updateTeam(by, team, changes),
    /** A site admin frees a handle (admin.ts): `@riley` a person's, `mobile` a team's. */
    releaseHandle: (c, handle: string) => releaseHandle(authOf(c), directoryOf(c), handle),
    parkedUntil: (c, kind: 'user' | 'team', handle: string, requester: string | null) =>
      directoryOf(c).parkedUntil(kind, handle, requester),
    members: (c, kind: ContainerKind, id: string, options?: { cursor?: string; limit?: number }) =>
      directoryOf(c).members(kind, id, options),
    addMember: (c, by: string, kind: ContainerKind, id: string, user: string, role?: Role) =>
      directoryOf(c).addMember(by, kind, id, user, role),
    memberships: (c, user: string) => directoryOf(c).memberships(user),
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
    registerIdea: (c, row: Omit<IdeaRow, 'number' | 'openComments'>) => directoryOf(c).registerIdea(row),
    updateIdea: (c, row: IndexUpdate) => directoryOf(c).updateIdea(row),
    idea: (c, id: string) => directoryOf(c).idea(id),
    placeOf: (c, id: string) => directoryOf(c).placeOf(id),
    ideaFor: (c, id: string, user: string, token?: string | null) => directoryOf(c).ideaFor(id, user, token),
    findIdeaFor: (c, place: string, number: number, user: string, token?: string | null) =>
      directoryOf(c).findIdeaFor(place, number, user, token),
    users: (c, ids: string[]) => directoryOf(c).users(ids),
    findIdea: (c, place: string, number: number) => directoryOf(c).findIdea(place, number),
    permission: (c, idea: string, user: string, token?: string | null) => directoryOf(c).permission(idea, user, token),
    grants: (c, idea: string) => directoryOf(c).grants(idea),
    setReviewer: (c, by: string, idea: string, subject: GrantSubject, reviewer: boolean) =>
      directoryOf(c).setReviewer(by, idea, subject, reviewer),
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
  vars: { directory: Directory | null; auth: Auth | null; sending: boolean }
}

type Scheduling = DirectoryContext & {
  schedule: {
    at(timestamp: number, action: string, ...args: unknown[]): Promise<string>
    list(): Promise<Array<{ id: string; action: string; runAt: number }>>
    cancel(id: string): Promise<boolean>
  }
}

/**
 * How late an alarm may be before it counts as lost. Alarms fire on time, give
 * or take a busy moment; setting one again that was only late is harmless, as
 * sendEmails runs one at a time and sends only what's still due.
 */
const LOST_ALARM_MS = 2_000
/** How often the queue loop makes sure an email due has a live alarm (two reads, when one is due). */
const EMAIL_CHECK_MS = 2_000

/**
 * Sets an alarm for when the next email is due (no sooner than `wait` from
 * now), unless one is set for then or sooner already.
 */
async function scheduleEmails(c: Scheduling, wait = 0): Promise<void> {
  const email = nodeDeps().email
  if (!email) {
    return
  }
  const next = await directoryOf(c).nextEmailAt(email.timing)
  if (next === null) {
    return
  }
  const now = Date.now()
  const at = Math.max(next, now + wait)
  const alarms = (await c.schedule.list()).filter((e) => e.action === 'sendEmails')
  // an alarm well past its time was lost (its storage was busy when it was due): it no longer counts, and goes
  for (const lost of alarms.filter((e) => e.runAt < now - LOST_ALARM_MS)) {
    await c.schedule.cancel(lost.id)
  }
  const set = alarms.some((e) => e.runAt >= now - LOST_ALARM_MS && e.runAt <= at)
  if (!set) {
    await c.schedule.at(at, 'sendEmails')
  }
}

/** Better Auth for this wake-up, on the actor's database. */
function authOf(c: DirectoryContext): Auth {
  // Better Auth's transactions stay open across its calls, so only its statements outside one are retried
  c.vars.auth ??= authInDirectory(retryOverloaded(c.db, { transactions: false }), nodeDeps().auth, directoryOf(c))
  return c.vars.auth
}

function directoryOf(c: DirectoryContext): Directory {
  if (!c.vars.directory) {
    // the engine refuses writes for a moment when storage is busy: wait and retry
    c.vars.directory = new SqlDirectory({ sql: retryOverloaded(c.db), search, email: nodeDeps().email !== null })
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
