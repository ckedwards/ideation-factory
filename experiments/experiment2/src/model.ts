// PROTOTYPE: derived rules. Who is listening to what, and what's waiting on you.
import { ME, NOW, type ClosedReason, type Group, type Idea, type Notification, type Reason, type Requirements, type Rule, type Team, type WatchLevel } from './data'
import { useStore } from './store'

type State = ReturnType<typeof useStore>['state']

// Ideas in an archived team are archived: pseudo-closed, whatever their status.
const archivedCache = new WeakMap<object, Set<string>>()
function archivedTeams(s: State) {
  let set = archivedCache.get(s.teams)
  if (!set) archivedCache.set(s.teams, (set = new Set(s.teams.filter((t) => t.archivedAt).map((t) => t.id))))
  return set
}
export const isArchived = (s: State, i: Idea) => i.status !== 'closed' && archivedTeams(s).has(i.teamId)
export const isClosed = (s: State, i: Idea) => i.status === 'closed' || isArchived(s, i)
export const isOpen = (s: State, i: Idea) => !isClosed(s, i)
// "Active": open and out of draft. Active watchers hear about it until (and including) it closes.
export const isActive = (s: State, i: Idea) => isOpen(s, i) && i.status !== 'draft'

// ---------- roles ----------

type Membership = Team | Group
// Site admins are admins of everything.
export const canAdmin = (s: State, m: Membership) => s.siteAdmin || m.admins.includes(ME)
export const canMaintain = (s: State, m: Membership) => canAdmin(s, m) || m.maintainers.includes(ME)
// Your own role, ignoring site-admin powers. Use this for what's "yours" (home, lists).
export const ownAdmin = (m: Membership) => m.admins.includes(ME)
export const ownMaintain = (m: Membership) => ownAdmin(m) || m.maintainers.includes(ME)
// True when you can do something only because you're a site admin. These get called out in the UI.
export const adminViaSite = (s: State, m: Membership) => s.siteAdmin && !ownAdmin(m)
export const maintainViaSite = (s: State, m: Membership) => s.siteAdmin && !ownMaintain(m)
export function roleOf(m: Membership, userId: string): 'admin' | 'maintainer' | 'member' | null {
  if (m.admins.includes(userId)) return 'admin'
  if (m.maintainers.includes(userId)) return 'maintainer'
  return m.members.includes(userId) ? 'member' : null
}
export const liveGroups = (s: State) => s.groups.filter((g) => !g.deletedAt)
export const isInactive = (s: State, userId: string) => !!s.users[userId]?.inactive
// Teams or groups whose admins are all inactive: nobody can run them until a site admin steps in.
export const noActiveAdmin = (s: State, m: Membership) => m.admins.every((a) => isInactive(s, a))

export function watchLevel(s: State, teamId: string): WatchLevel {
  return s.watching[teamId] ?? 'participating'
}

export const WATCH_LEVELS: { id: WatchLevel; label: string; short: string; blurb: string }[] = [
  { id: 'participating', label: 'Participating and assigned', short: 'Participating', blurb: 'Only ideas you wrote, are asked to review (directly or through a group), or follow.' },
  { id: 'active', label: 'Active ideas', short: 'Active', blurb: 'Every idea once it’s out of draft, until it’s closed, including the close.' },
  { id: 'all', label: 'All ideas', short: 'All', blurb: 'Everything in this team, drafts included.' },
]

export function myGroups(s: State) {
  return s.groups.filter((g) => g.members.includes(ME))
}

// Real teams you're in (your personal "Your ideas" space isn't one of them).
export function myTeams(s: State) {
  return s.teams.filter((t) => t.members.includes(ME) && !t.personal)
}

// ---------- your ideas (a hidden, one-person team) ----------

export const isPersonal = (t: Team | undefined) => !!t?.personal
export const myPersonalTeam = (s: State) => s.teams.find((t) => t.personal === ME)
const personalCache = new WeakMap<object, Map<string, string>>()
function personalOwners(s: State) {
  let m = personalCache.get(s.teams)
  if (!m) personalCache.set(s.teams, (m = new Map(s.teams.filter((t) => t.personal).map((t) => [t.id, t.personal!]))))
  return m
}
const teamCache = new WeakMap<object, Map<string, Team>>()
export function teamById(s: State, id: string) {
  let m = teamCache.get(s.teams)
  if (!m) teamCache.set(s.teams, (m = new Map(s.teams.map((t) => [t.id, t]))))
  return m.get(id)
}

// Who can see an idea:
//   your ideas (personal): the owner, plus people they asked to review
//   locked team: its members only. Removing someone from the team revokes it.
//     If set to 'assigned', plain members only see ideas they wrote or review;
//     admins and maintainers still see them all.
//   any other team: everyone
// Notifications, subscriptions and lists all go through this.
export function canSee(s: State, i: Idea) {
  const owner = personalOwners(s).get(i.teamId)
  if (owner) return owner === ME || i.reviewers.some((r) => r.kind === 'user' && r.userId === ME)
  const t = teamById(s, i.teamId)
  if (t?.locked) {
    if (!t.members.includes(ME)) return false
    // admins and maintainers see every idea; members may only see the ones they're on
    if (t.memberSees !== 'assigned' || t.admins.includes(ME) || t.maintainers.includes(ME)) return true
    return onIdea(i)
  }
  return true
}
// You wrote it, or you're asked to review it.
export const onIdea = (i: Idea) => i.authorId === ME || i.reviewers.some((r) => r.kind === 'user' && r.userId === ME)
// In a locked team set to 'assigned', are you limited to the ideas you're on?
export const seesAssignedOnly = (t: Team) => !!t.locked && t.memberSees === 'assigned' && !t.admins.includes(ME) && !t.maintainers.includes(ME)
// Private teams (locked teams and Your ideas) can't use groups: no group
// reviewers and no group rules in their approval requirements (see usesGroups).
// Group membership doesn't line up with who can see the ideas, so it would
// complicate access too much.
// Can you see what's inside this team (its ideas, counts)?
export const canSeeInside = (t: Team) => !t.locked || t.members.includes(ME)
export const visibleIdeas = (s: State) => s.ideas.filter((i) => canSee(s, i))
// Teams that appear in lists and pickers.
export const listedTeams = (s: State) => s.teams.filter((t) => !t.personal)

// Every reason you hear about an idea. You listen if you wrote it, you were
// asked to review it (directly or through a group), you watch its team, or you
// followed it by hand.
// Your group ids, computed once per groups list (not once per idea).
const groupCache = new WeakMap<object, Set<string>>()
function myGroupIds(s: State) {
  let set = groupCache.get(s.groups)
  if (!set) groupCache.set(s.groups, (set = new Set(s.groups.filter((g) => g.members.includes(ME)).map((g) => g.id))))
  return set
}

export function reasonsFor(s: State, idea: Idea): Reason[] {
  const out: Reason[] = []
  if (idea.authorId === ME) out.push({ kind: 'author' })
  if (idea.reviewers.some((r) => r.kind === 'user' && r.userId === ME)) out.push({ kind: 'reviewer' })
  const mine = myGroupIds(s)
  for (const r of idea.reviewers) if (r.kind === 'group' && mine.has(r.groupId)) out.push({ kind: 'group', groupId: r.groupId })
  const level = watchLevel(s, idea.teamId)
  if (level === 'all' || (level === 'active' && isActive(s, idea))) out.push({ kind: 'team-watch', teamId: idea.teamId, level })
  if (s.subscribed.includes(idea.id)) out.push({ kind: 'subscribed' })
  return out
}

export function following(s: State) {
  return s.ideas
    .filter((idea) => canSee(s, idea))
    .map((idea) => ({ idea, reasons: reasonsFor(s, idea), muted: s.muted.includes(idea.id) }))
    .filter((f) => f.reasons.length > 0)
}

// Requesting review, and you (or a group you're in) are a reviewer.
export function waitingOnMe(s: State) {
  return s.ideas.filter(
    (i) =>
      i.status === 'requesting review' &&
      !isArchived(s, i) &&
      canSee(s, i) &&
      i.authorId !== ME &&
      reasonsFor(s, i).some((r) => r.kind === 'reviewer' || r.kind === 'group'),
  )
}

export function reasonText(s: State, r: Reason) {
  switch (r.kind) {
    case 'author':
      return 'You wrote this idea'
    case 'reviewer':
      return 'You’re a reviewer'
    case 'group':
      return `Via the ${s.groups.find((g) => g.id === r.groupId)?.name ?? 'a'} group`
    case 'team-watch':
      return `You’re watching ${s.teams.find((t) => t.id === r.teamId)?.name ?? 'a team'} (${r.level === 'all' ? 'all ideas' : 'active ideas'})`
    case 'subscribed':
      return 'You followed this idea'
  }
}

export function ago(iso: string) {
  const mins = Math.round((NOW - Date.parse(iso)) / 60000)
  if (mins <= 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 45) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en', { month: 'short', year: 'numeric' })
}

export function dayLabel(iso: string) {
  const days = Math.floor((Date.parse(new Date(NOW).toISOString().slice(0, 10)) - Date.parse(iso.slice(0, 10))) / 86_400_000)
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : new Date(iso).toLocaleDateString('en', { weekday: 'long', month: 'short', day: 'numeric' })
}

// ---------- approval requirements ----------

const groupName = (groups: Group[], id: string) => {
  const g = groups.find((x) => x.id === id)
  return g ? (g.deletedAt ? `${g.name} (deleted group)` : g.name) : `${id} (missing group)`
}
// Group ids a rule names that no longer exist.
export function deletedIn(groups: Group[], r: Rule) {
  return r.groupIds.filter((id) => !groups.find((g) => g.id === id) || groups.find((g) => g.id === id)!.deletedAt)
}

// A group rule is broken when a deleted group makes it impossible to meet:
//   'each' (and) → any of its groups is deleted
//   'any' (or)   → all of its groups are deleted
// "Any" with some groups left still works (a warning, not an error).
export function ruleBroken(groups: Group[], r: Rule) {
  const gone = deletedIn(groups, r)
  if (gone.length === 0) return false
  return r.kind === 'any' ? gone.length === r.groupIds.length : true
}
export function ruleWarning(groups: Group[], r: Rule) {
  return deletedIn(groups, r).length > 0 && !ruleBroken(groups, r)
}
const list = (names: string[], joiner: 'or' | 'and') =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} ${joiner} ${names[names.length - 1]}`

export function ruleText(groups: Group[], r: Rule) {
  const names = r.groupIds.map((g) => groupName(groups, g))
  if (names.length <= 1) return `One approval from ${names[0] ?? 'a group'}`
  return r.kind === 'any' ? `One approval from any of ${list(names, 'or')}` : `An approval from each of ${list(names, 'and')}`
}
export const minText = (n: number) => `At least ${n} approval${n === 1 ? '' : 's'} in total`
export const RESOLVED_TEXT = 'All discussions resolved'

export const hasRequirements = (r: Requirements) => r.minApprovals > 0 || r.groups.length > 0 || r.resolved
export const usesGroups = (t: Team) => t.requirements.groups.length > 0
export const usesGroup = (t: Team, groupId: string) => t.requirements.groups.filter((r) => r.groupIds.includes(groupId))

// Groups a team adds as reviewers automatically when an idea goes out for review
// (rules with autoAdd; deleted groups are skipped).
export function autoReviewerGroups(s: State, team: Team) {
  const ids = team.requirements.groups.filter((r) => r.autoAdd).flatMap((r) => r.groupIds)
  return [...new Set(ids)].filter((id) => s.groups.some((g) => g.id === id && !g.deletedAt))
}
// The groups that would be added to this idea (not already reviewing it).
export function autoAddFor(s: State, team: Team, idea: Idea) {
  return autoReviewerGroups(s, team).filter((gid) => !idea.reviewers.some((r) => r.kind === 'group' && r.groupId === gid))
}

// One line per requirement, in a fixed order: minimum approvals, group rules,
// discussions. With an idea, each says whether it's met (and how far along).
export type Check = { key: string; text: string; met: boolean; broken: boolean; warning: boolean; progress?: string; rule?: Rule }
export function requirementChecks(groups: Group[], req: Requirements, idea?: Idea): Check[] {
  // approvals from a deleted group's members never count toward its rules
  const inGroup = (gid: string) => {
    const g = groups.find((x) => x.id === gid)
    return !!idea && !!g && !g.deletedAt && idea.approvals.some((u) => g.members.includes(u))
  }
  const checks: Check[] = []
  if (req.minApprovals > 0) {
    const n = idea?.approvals.length ?? 0
    checks.push({ key: 'min', text: minText(req.minApprovals), met: n >= req.minApprovals, broken: false, warning: false, progress: idea && n < req.minApprovals ? `${n} so far` : undefined })
  }
  req.groups.forEach((rule, i) => {
    const met = rule.kind === 'any' ? rule.groupIds.some(inGroup) : rule.groupIds.every(inGroup)
    const have = rule.groupIds.filter(inGroup).length
    checks.push({
      key: `g${i}`,
      text: ruleText(groups, rule),
      met,
      broken: ruleBroken(groups, rule),
      warning: ruleWarning(groups, rule),
      progress: idea && !met && rule.kind === 'each' && rule.groupIds.length > 1 ? `${have} of ${rule.groupIds.length} groups so far` : undefined,
      rule,
    })
  })
  if (req.resolved) {
    const open = idea?.openThreads ?? 0
    checks.push({ key: 'resolved', text: RESOLVED_TEXT, met: open === 0, broken: false, warning: false, progress: idea && open > 0 ? `${open} open` : undefined })
  }
  return checks
}

// How an idea stands against its team's requirements.
export function evaluate(groups: Group[], team: Team, idea: Idea) {
  const checks = requirementChecks(groups, team.requirements, idea)
  return { checks, met: checks.filter((c) => c.met).length, total: checks.length, broken: checks.filter((c) => c.broken).length }
}

// The coarse state shown on notification rows: draft | in review (requirements
// not met) | in review (requirements met) | closed. "In review" covers requesting
// review, changes in progress and approved. Archived counts as closed.
export type CoarseState =
  | { kind: 'draft' }
  | { kind: 'review'; met: boolean; e?: ReturnType<typeof evaluate>; noRules?: boolean }
  | { kind: 'closed'; how: ClosedReason | 'archived' }
export function coarseState(s: State, i: Idea): CoarseState {
  if (isArchived(s, i)) return { kind: 'closed', how: 'archived' }
  if (i.status === 'closed') return { kind: 'closed', how: i.closedReason ?? 'accepted' }
  if (i.status === 'draft') return { kind: 'draft' }
  const team = teamById(s, i.teamId)
  // no requirements: nothing to meet, so it can be closed as accepted any time
  if (!team || !hasRequirements(team.requirements)) return { kind: 'review', met: true, noRules: true }
  const e = evaluate(s.groups, team, i)
  return { kind: 'review', met: e.broken === 0 && e.met === e.total, e }
}

// Look up an idea by id (cached per ideas list).
const ideaCache = new WeakMap<object, Map<string, Idea>>()
export function ideaById(s: State, id: string) {
  let m = ideaCache.get(s.ideas)
  if (!m) ideaCache.set(s.ideas, (m = new Map(s.ideas.map((i) => [i.id, i]))))
  return m.get(id)
}

// ---------- notification threads (one per idea, like GitHub) ----------

export type ThreadReason = 'review' | 'author' | 'reviewer' | 'group' | 'subscribed' | 'watching'
export type Thread = {
  idea: Idea
  ns: Notification[] // newest first
  latest: Notification
  unread: number
  reason: ThreadReason
  reasonLabel: string
  done: boolean
}

const REASON_ORDER: Reason['kind'][] = ['author', 'reviewer', 'group', 'subscribed', 'team-watch']

// Every idea you've had notifications about (ideas you unsubscribed from drop out).
export function threads(s: State): Thread[] {
  const byIdea = new Map<string, Notification[]>()
  for (const n of s.notifications) {
    if (s.muted.includes(n.ideaId)) continue
    byIdea.set(n.ideaId, [...(byIdea.get(n.ideaId) ?? []), n])
  }
  const out: Thread[] = []
  for (const [ideaId, list] of byIdea) {
    const idea = ideaById(s, ideaId)
    // no notifications from ideas you can't see (e.g. you left a locked team)
    if (!idea || !canSee(s, idea)) continue
    const ns = list.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    const kinds = new Set(ns.map((n) => n.reason.kind))
    const asked = ns.some((n) => n.kind === 'review-requested' && (n.reason.kind === 'reviewer' || n.reason.kind === 'group'))
    const top = REASON_ORDER.find((k) => kinds.has(k)) ?? 'team-watch'
    const reason: ThreadReason = asked ? 'review' : top === 'team-watch' ? 'watching' : top
    const r = ns.find((n) => n.reason.kind === top)!.reason
    const reasonLabel =
      reason === 'review'
        ? 'Review requested'
        : reason === 'author'
          ? 'Author'
          : reason === 'reviewer'
            ? 'Reviewer'
            : reason === 'group' && r.kind === 'group'
              ? `Via ${s.groups.find((g) => g.id === r.groupId)?.name ?? 'a group'}`
              : reason === 'subscribed'
                ? 'Subscribed'
                : `Watching ${s.teams.find((t) => t.id === idea.teamId)?.name ?? 'team'}`
    out.push({ idea, ns, latest: ns[0], unread: ns.filter((n) => !n.read).length, reason, reasonLabel, done: s.done.includes(ideaId) })
  }
  return out.sort((a, b) => Date.parse(b.latest.at) - Date.parse(a.latest.at))
}

// ---------- accounts ----------

// Handles: 2–39 characters, lowercase letters, digits, ".", "-" and "_",
// starting and ending with a letter or digit. Unique, and not a reserved word.
const RESERVED = new Set(['admin', 'administrator', 'api', 'bot', 'bots', 'groups', 'ideaf', 'ideas', 'me', 'new', 'notifications', 'settings', 'signup', 'support', 'system', 'teams', 'you'])
export function handleProblem(s: State, handle: string, self?: string) {
  if (handle.length < 2) return 'At least 2 characters.'
  if (handle.length > 39) return 'At most 39 characters.'
  if (!/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/.test(handle)) return 'Lowercase letters, numbers, and . - _ in the middle.'
  if (RESERVED.has(handle)) return `“${handle}” is reserved.`
  if (Object.values(s.users).some((u) => u.handle === handle && u.id !== self)) return `@${handle} is taken.`
  return null
}
// A free handle based on an email address (or a name).
export function suggestHandle(s: State, from: string) {
  const base =
    from
      .split('@')[0]
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '.')
      .replace(/^[._-]+|[._-]+$/g, '')
      .slice(0, 36) || 'user'
  const taken = new Set(Object.values(s.users).map((u) => u.handle))
  if (!taken.has(base) && !RESERVED.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base}${n}`)) return `${base}${n}`
}
export const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
export const userByEmail = (s: State, email: string) => Object.values(s.users).find((u) => u.email.toLowerCase() === email.trim().toLowerCase())
