// PROTOTYPE: in-memory state for experiment 2. Only the theme persists.
import { createContext, useContext, useEffect, useReducer, type ReactNode } from 'react'
import {
  ME,
  NOW,
  initialDeployment,
  initialPasskeys,
  NO_REQUIREMENTS,
  type Passkey,
  initialGroups,
  initialIdeas,
  initialMuted,
  initialNotifications,
  initialSubscribed,
  initialTeams,
  initialTokens,
  initialUsers,
  initialWatching,
  type Deployment,
  type Group,
  type Idea,
  type Notification,
  type Requirements,
  type Team,
  type Token,
  type TokenPurpose,
  type User,
  type WatchLevel,
} from './data'
// model and store import each other; fine, since these are only called at runtime
import { autoAddFor } from './model'

export type Theme = 'system' | 'light' | 'dark' | 'contrast'

type State = {
  users: Record<string, User>
  ideas: Idea[]
  avatars: Record<string, string> // userId -> object URL of an uploaded picture
  teams: Team[]
  watching: Record<string, WatchLevel> // per team; missing = 'participating'
  groups: Group[]
  notifications: Notification[]
  subscribed: string[] // idea ids followed by hand
  muted: string[] // idea ids unsubscribed from
  done: string[] // idea ids marked Done in the inbox (like GitHub)
  tokens: Token[]
  toast: string | null
  deployment: Deployment // site admin settings for the whole deployment
  passkeys: Passkey[] // yours
  siteAdmin: boolean // dev switch: act as a site admin (admin of every team and group)
  theme: Theme
  clock: number
}

type Action =
  | { type: 'setProfile'; name: string; avatar: string | null | undefined }
  | { type: 'membership'; entity: Entity; id: string; op: 'join' | 'leave' | 'request' | 'cancel'; note?: string }
  | { type: 'decide'; entity: Entity; id: string; userId: string; approve: boolean }
  | { type: 'addMember'; entity: Entity; id: string; userId: string }
  | { type: 'removeMember'; entity: Entity; id: string; userId: string }
  | { type: 'setRole'; entity: Entity; id: string; userId: string; role: Role }
  | { type: 'updateInfo'; entity: Entity; id: string; name: string; description: string; joinPolicy: 'open' | 'invite'; locked?: boolean; memberSees?: 'all' | 'assigned' }
  | { type: 'deleteGroup'; id: string }
  | { type: 'archiveTeam'; id: string; archived: boolean }
  | { type: 'deleteTeam'; id: string }
  | { type: 'moveIdea'; ideaId: string; teamId: string }
  | { type: 'setInactive'; userId: string; inactive: boolean }
  | { type: 'setSiteAdmin'; on: boolean }
  | { type: 'setDeployment'; deployment: Deployment }
  | { type: 'removePasskey'; id: string }
  | { type: 'setWatch'; teamId: string; level: WatchLevel }
  | { type: 'setRequirements'; teamId: string; requirements: Requirements }
  | { type: 'createGroup'; id: string; name: string; description: string; joinPolicy: 'open' | 'invite' }
  | { type: 'createTeam'; id: string; name: string; description: string; joinPolicy: 'open' | 'invite'; locked: boolean; memberSees: 'all' | 'assigned' }
  | { type: 'markRead'; id: string; read: boolean }
  | { type: 'markAllRead' }
  | { type: 'markIdeasRead'; ideaIds: string[]; read: boolean }
  | { type: 'markDone'; ideaIds: string[]; done: boolean }
  | { type: 'toggleMute'; ideaId: string }
  | { type: 'toggleSubscribe'; ideaId: string }
  | { type: 'createToken'; token: Token }
  | { type: 'revokeToken'; id: string }
  | { type: 'toast'; text: string | null }
  | { type: 'setTheme'; theme: Theme }

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?'
}

export type Entity = 'team' | 'group'
export type Role = 'member' | 'maintainer' | 'admin'
type Membership = Team | Group

const now = (s: State) => new Date(s.clock).toISOString()

// Apply a change to one team or group.
function patch(s: State, entity: Entity, id: string, fn: (m: Membership) => Membership): State {
  if (entity === 'team') return { ...s, teams: s.teams.map((t) => (t.id === id ? (fn(t) as Team) : t)) }
  return { ...s, groups: s.groups.map((g) => (g.id === id ? (fn(g) as Group) : g)) }
}
const without = (list: string[], id: string) => list.filter((x) => x !== id)

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'setProfile': {
      const avatars = { ...s.avatars }
      if (a.avatar === null) delete avatars[ME]
      else if (a.avatar) avatars[ME] = a.avatar
      return { ...s, avatars, users: { ...s.users, [ME]: { ...s.users[ME], name: a.name, initials: initials(a.name) } } }
    }
    case 'membership':
      return patch(s, a.entity, a.id, (m) => {
        switch (a.op) {
          case 'join':
            return { ...m, members: [...without(m.members, ME), ME] }
          case 'leave':
            return { ...m, members: without(m.members, ME), maintainers: without(m.maintainers, ME), admins: without(m.admins, ME) }
          case 'request':
            return { ...m, requests: [...m.requests.filter((r) => r.userId !== ME), { userId: ME, at: now(s), note: a.note }] }
          case 'cancel':
            return { ...m, requests: m.requests.filter((r) => r.userId !== ME) }
        }
      })
    case 'decide':
      return patch(s, a.entity, a.id, (m) => ({
        ...m,
        requests: m.requests.filter((r) => r.userId !== a.userId),
        members: a.approve ? [...without(m.members, a.userId), a.userId] : m.members,
      }))
    case 'addMember':
      return patch(s, a.entity, a.id, (m) => ({ ...m, members: [...without(m.members, a.userId), a.userId], requests: m.requests.filter((r) => r.userId !== a.userId) }))
    case 'removeMember':
      return patch(s, a.entity, a.id, (m) => ({
        ...m,
        members: without(m.members, a.userId),
        maintainers: without(m.maintainers, a.userId),
        admins: without(m.admins, a.userId),
      }))
    case 'setRole':
      return patch(s, a.entity, a.id, (m) => ({
        ...m,
        admins: a.role === 'admin' ? [...without(m.admins, a.userId), a.userId] : without(m.admins, a.userId),
        maintainers: a.role === 'maintainer' ? [...without(m.maintainers, a.userId), a.userId] : without(m.maintainers, a.userId),
      }))
    case 'updateInfo': {
      const locking = a.entity === 'team' && a.locked && !s.teams.find((t) => t.id === a.id)?.locked
      // locked teams don't take groups as reviewers, so locking drops group review requests
      const s2 = locking
        ? { ...s, ideas: s.ideas.map((i) => (i.teamId === a.id && i.reviewers.some((r) => r.kind === 'group') ? { ...i, reviewers: i.reviewers.filter((r) => r.kind !== 'group') } : i)) }
        : s
      return patch(s2, a.entity, a.id, (m) => ({
        ...m,
        name: a.name,
        description: a.description,
        // locked teams are always invite only
        joinPolicy: a.locked ? 'invite' : a.joinPolicy,
        ...(a.entity === 'team' ? { locked: a.locked || undefined, memberSees: a.locked ? a.memberSees : undefined } : {}),
      }))
    }
    case 'deleteGroup':
      return patch(s, 'group', a.id, (m) => ({ ...m, deletedAt: now(s), deletedBy: ME }))
    case 'archiveTeam':
      return { ...s, teams: s.teams.map((t) => (t.id === a.id ? { ...t, archivedAt: a.archived ? now(s) : undefined, archivedBy: a.archived ? ME : undefined } : t)) }
    case 'deleteTeam': {
      // permanent: the team, every idea in it, and everything pointing at those ideas
      const gone = new Set(s.ideas.filter((i) => i.teamId === a.id).map((i) => i.id))
      const watching = { ...s.watching }
      delete watching[a.id]
      return {
        ...s,
        teams: s.teams.filter((t) => t.id !== a.id),
        ideas: s.ideas.filter((i) => !gone.has(i.id)),
        notifications: s.notifications.filter((n) => !gone.has(n.ideaId)),
        muted: s.muted.filter((id) => !gone.has(id)),
        subscribed: s.subscribed.filter((id) => !gone.has(id)),
        watching,
      }
    }
    case 'moveIdea': {
      // moving an idea that's already out of draft into a team counts as it going
      // out for review there, so the team's auto-added groups join its reviewers
      const team = s.teams.find((t) => t.id === a.teamId)
      return {
        ...s,
        ideas: s.ideas.map((i) => {
          if (i.id !== a.ideaId) return i
          const add = team && i.status !== 'draft' && i.status !== 'closed' ? autoAddFor(s, team, i) : []
          return { ...i, teamId: a.teamId, reviewers: [...i.reviewers, ...add.map((groupId) => ({ kind: 'group' as const, groupId }))] }
        }),
      }
    }
    case 'setInactive':
      return {
        ...s,
        users: { ...s.users, [a.userId]: { ...s.users[a.userId], inactive: a.inactive ? { since: now(s), by: ME } : undefined } },
      }
    case 'setDeployment':
      return { ...s, deployment: a.deployment }
    case 'removePasskey':
      return { ...s, passkeys: s.passkeys.filter((p) => p.id !== a.id) }
    case 'setSiteAdmin':
      return { ...s, siteAdmin: a.on }
    case 'setWatch': {
      const watching = { ...s.watching }
      if (a.level === 'participating') delete watching[a.teamId]
      else watching[a.teamId] = a.level
      return { ...s, watching }
    }
    case 'setRequirements':
      return { ...s, teams: s.teams.map((t) => (t.id === a.teamId ? { ...t, requirements: a.requirements } : t)) }
    case 'createTeam': {
      // the creator is its first member and admin; no requirements until set
      const clock = s.clock + 60_000
      return {
        ...s,
        clock,
        teams: [
          ...s.teams,
          {
            id: a.id,
            name: a.name,
            description: a.description,
            members: [ME],
            createdBy: ME,
            createdAt: new Date(clock).toISOString(),
            requirements: NO_REQUIREMENTS,
            admins: [ME],
            maintainers: [],
            joinPolicy: a.locked ? 'invite' : a.joinPolicy,
            requests: [],
            ...(a.locked ? { locked: true, memberSees: a.memberSees } : {}),
          },
        ],
      }
    }
    case 'createGroup': {
      // the creator is its first member and admin; members are added in settings
      const clock = s.clock + 60_000
      return {
        ...s,
        clock,
        groups: [
          ...s.groups,
          { id: a.id, name: a.name, description: a.description, members: [ME], createdBy: ME, createdAt: new Date(clock).toISOString(), admins: [ME], maintainers: [], joinPolicy: a.joinPolicy, requests: [] },
        ],
      }
    }
    case 'markRead':
      return { ...s, notifications: s.notifications.map((n) => (n.id === a.id ? { ...n, read: a.read } : n)) }
    case 'markAllRead':
      return { ...s, notifications: s.notifications.map((n) => ({ ...n, read: true })) }
    case 'markIdeasRead': {
      const ids = new Set(a.ideaIds)
      return { ...s, notifications: s.notifications.map((n) => (ids.has(n.ideaId) ? { ...n, read: a.read } : n)) }
    }
    case 'markDone': {
      const ids = new Set(a.ideaIds)
      // Done also marks read, like GitHub
      return {
        ...s,
        done: a.done ? [...new Set([...s.done, ...a.ideaIds])] : s.done.filter((id) => !ids.has(id)),
        notifications: a.done ? s.notifications.map((n) => (ids.has(n.ideaId) ? { ...n, read: true } : n)) : s.notifications,
      }
    }
    case 'toggleMute':
      return { ...s, muted: s.muted.includes(a.ideaId) ? s.muted.filter((i) => i !== a.ideaId) : [...s.muted, a.ideaId] }
    case 'toggleSubscribe':
      return { ...s, subscribed: s.subscribed.includes(a.ideaId) ? s.subscribed.filter((i) => i !== a.ideaId) : [...s.subscribed, a.ideaId] }
    case 'createToken':
      return { ...s, tokens: [a.token, ...s.tokens] }
    case 'revokeToken':
      return { ...s, tokens: s.tokens.filter((t) => t.id !== a.id) }
    case 'toast':
      return { ...s, toast: a.text }
    case 'setTheme':
      return { ...s, theme: a.theme }
  }
}

function loadTheme(): Theme {
  try {
    return (localStorage.getItem('ideaf-proto-theme') as Theme) || 'system'
  } catch {
    return 'system'
  }
}

const Ctx = createContext<{ state: State; dispatch: (a: Action) => void } | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    users: initialUsers,
    ideas: initialIdeas,
    avatars: {},
    teams: initialTeams,
    watching: initialWatching,
    groups: initialGroups,
    notifications: initialNotifications,
    subscribed: initialSubscribed,
    muted: initialMuted,
    done: [],
    tokens: initialTokens,
    toast: null,
    deployment: initialDeployment,
    passkeys: initialPasskeys,
    siteAdmin: false,
    theme: loadTheme(),
    clock: NOW,
  }))

  useEffect(() => {
    const root = document.documentElement
    if (state.theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', state.theme)
    try {
      localStorage.setItem('ideaf-proto-theme', state.theme)
    } catch {
      /* private mode */
    }
  }, [state.theme])

  // toasts clear themselves
  useEffect(() => {
    if (!state.toast) return
    const t = setTimeout(() => dispatch({ type: 'toast', text: null }), 3200)
    return () => clearTimeout(t)
  }, [state.toast])

  return <Ctx.Provider value={{ state, dispatch }}>{children}</Ctx.Provider>
}

export function useStore() {
  const v = useContext(Ctx)
  if (!v) throw new Error('StoreProvider missing')
  return v
}

// Random token for the "shown once" screen. Prefix encodes the purpose.
export function newTokenValue(purpose: TokenPurpose | 'site-admin') {
  const prefix = purpose === 'site-admin' ? 'ideaf_sa_' : purpose === 'me' ? 'ideaf_u_' : purpose === 'userbot' ? 'ideaf_ub_' : 'ideaf_b_'
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  let body = ''
  for (let i = 0; i < 36; i++) body += chars[Math.floor(Math.random() * chars.length)]
  return prefix + body
}
