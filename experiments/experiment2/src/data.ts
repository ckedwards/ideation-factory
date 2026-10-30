// PROTOTYPE: example data for experiment 2 (the rest of the site): a small
// hand-written story (Riley, Mobile, Payments, …) on top of generated data at a
// realistic scale (see scale.ts).
import { SCALE, generate } from './scale'

export const NOW = Date.parse('2026-10-24T15:00:00Z')

// handle is unique, names aren't. An inactive person (e.g. they left the
// company) is read-only: they can't act, their tokens are suspended, and they're
// marked inactive wherever they appear. Set by a site admin.
// An account: a display name (changeable), a handle chosen at sign-up (unique;
// used for @mentions and in the cli), and a primary email, which is what the
// account ultimately is: sign-in codes go there, and single sign-on matches on it.
// The primary email can't be changed in the built-in flow: whoever controls it
// controls the account, so a hijacked session must not be able to move it.
export type User = { id: string; name: string; initials: string; handle: string; email: string; inactive?: { since: string; by: string } }

// Passkeys registered for your account (built-in sign-in only).
export type Passkey = { id: string; name: string; createdAt: string; lastUsedAt?: string }

// How people sign in, for the whole deployment:
//   builtin: a code sent to their primary email, or a passkey. No passwords.
//   sso: the organization's identity provider (SAML or OIDC). Accounts match on
//     primary email; autoCreate makes one for anyone the provider vouches for who
//     doesn't have one yet (name and email from the provider, handle suggested
//     from the email). Email codes and passkeys are off.
export type SignIn =
  | { mode: 'builtin' }
  | { mode: 'sso'; protocol: 'saml' | 'oidc'; provider: string; autoCreate: boolean; domains: string[] }

// Same three token purposes as idea.md: me, a bot associated with me, a bot.
export type Actor =
  | { kind: 'user'; userId: string }
  | { kind: 'userbot'; bot: string; userId: string }
  | { kind: 'bot'; bot: string }

// Open: draft → requesting review ⇄ changes in progress → approved.
// Closed: with a reason, accepted or rejected.
export type IdeaStatus = 'draft' | 'requesting review' | 'changes in progress' | 'approved' | 'closed'
export type ClosedReason = 'accepted' | 'rejected'

// A group rule: 'any' = one approval from any of these groups (or),
// 'each' = an approval from every one of them (and). With a single group the
// two mean the same thing, so there's no separate "one group" kind.
// autoAdd: add the rule's groups to an idea's reviewers when it goes out for
// review: created ready for review, or moved out of draft. Drafts don't pull
// groups in. Ideas already in review when it's turned on aren't changed.
export type Rule = { kind: 'any' | 'each'; groupIds: string[]; autoAdd?: boolean }

// What a team requires before an idea counts as approved. Everything must hold:
//   minApprovals: at least this many approvals in total (0 = no minimum)
//   groups: every group rule
//   resolved: every discussion (comment thread) on the idea is resolved
export type Requirements = { minApprovals: number; groups: Rule[]; resolved: boolean }
export const NO_REQUIREMENTS: Requirements = { minApprovals: 0, groups: [], resolved: false }

// Who runs a team or group, and how people get in.
//   admins: everything, including settings, roles and deleting
//   maintainers: approve or deny join requests, add or remove members, and (on
//     teams) change approval requirements
//   joinPolicy: 'open' (anyone joins) or 'invite' (people ask, or are added)
// A deleted team or group is kept as a record (deletedAt), so anything still
// pointing at it can say so instead of silently breaking.
export type JoinRequest = { userId: string; at: string; note?: string }
export type Access = {
  admins: string[]
  maintainers: string[]
  joinPolicy: 'open' | 'invite'
  requests: JoinRequest[]
  deletedAt?: string
  deletedBy?: string
}

export type Team = {
  id: string
  name: string
  description: string
  members: string[]
  createdBy: string
  createdAt: string
  requirements: Requirements
  // Teams are never deleted, only archived. An archived team can't start ideas
  // or change the state of its active ones; those ideas count as archived, a
  // pseudo-closed state, whatever their own status says.
  archivedAt?: string
  archivedBy?: string
  // "Your ideas": every person has a hidden, one-person team for ideas that
  // aren't in any team. It never shows in team lists, nobody can join or watch
  // it, and its ideas are private to the owner (and anyone they ask to review).
  personal?: string // owner's user id
  // Locked: listed and selectable like any team, but only its members can see
  // its ideas (and get notifications about them). Removing someone revokes access.
  // Always invite only.
  locked?: boolean
  // Locked teams only: what plain members see. 'all' (the default): every idea
  // in the team. 'assigned': only ideas they wrote or are asked to review.
  // Admins and maintainers always see every idea.
  memberSees?: 'all' | 'assigned'
} & Access

// How much of a team you hear about.
//   participating: only ideas you wrote, review (directly or via a group), or follow
//   active: every idea once it's out of draft, through to when it's closed
//   all: every idea, drafts included
export type WatchLevel = 'participating' | 'active' | 'all'

export type Group = { id: string; name: string; description: string; members: string[]; createdBy: string; createdAt: string } & Access

export type Reviewer = { kind: 'user'; userId: string } | { kind: 'group'; groupId: string }

export type Idea = {
  id: string
  title: string
  description: string
  teamId: string
  authorId: string
  status: IdeaStatus
  closedReason?: ClosedReason
  reviewers: Reviewer[]
  approvals: string[] // user ids who approved the current version
  version: number
  openThreads: number
  updatedAt: string
}

export type NotificationKind = 'review-requested' | 'comment' | 'suggestion' | 'version' | 'status' | 'new-idea' | 'approved' | 'closed'

// Why you got a notification: the thing that makes you a listener.
export type Reason =
  | { kind: 'author' }
  | { kind: 'reviewer' }
  | { kind: 'group'; groupId: string }
  | { kind: 'team-watch'; teamId: string; level: 'active' | 'all' }
  | { kind: 'subscribed' }

export type Notification = {
  id: string
  at: string
  ideaId: string
  kind: NotificationKind
  actor: Actor
  text: string // what happened, after the actor's name
  excerpt?: string
  reason: Reason
  read: boolean
}

export type TokenPurpose = 'me' | 'userbot' | 'bot'

export type Token = {
  id: string
  name: string
  // 'site-admin' tokens are separate from personal ones: only site admins can make
  // them, they can do anything a site admin can, and they're short-lived.
  // Personal tokens never carry site admin access, even for a site admin.
  scope: 'personal' | 'site-admin'
  reason?: string // required for site admin tokens; logged
  purpose: TokenPurpose
  bot?: string
  prefix: string // the visible start of the token; the rest is only shown once
  createdAt: string
  lastUsedAt?: string
  expiresAt: string // required: personal tokens last at most a year, site admin tokens 30 days
}

// Deployment-wide settings, chosen by site admins (not per team or per user).
export type ExternalImages = 'click' | 'always' | 'never'
export type Deployment = { externalImages: ExternalImages; maxImageMB: number; signIn: SignIn }
export const initialDeployment: Deployment = { externalImages: 'click', maxImageMB: 10, signIn: { mode: 'builtin' } }
export const EMAIL_DOMAIN = 'acme.dev'

export const initialPasskeys: Passkey[] = [
  { id: 'pk1', name: 'MacBook Pro (Touch ID)', createdAt: '2025-03-01T10:00:00Z', lastUsedAt: '2026-10-24T08:02:00Z' },
  { id: 'pk2', name: 'iPhone', createdAt: '2025-06-12T10:00:00Z', lastUsedAt: '2026-10-19T19:30:00Z' },
]

export const ME = 'riley'

const storyUsers: Record<string, Omit<User, 'email'>> = {
  riley: { id: 'riley', name: 'Riley Park', initials: 'RP', handle: 'riley.park' },
  maya: { id: 'maya', name: 'Maya Ortiz', initials: 'MO', handle: 'maya.ortiz' },
  devon: { id: 'devon', name: 'Devon Fox', initials: 'DF', handle: 'devon.fox' },
  sam: { id: 'sam', name: 'Sam Achebe', initials: 'SA', handle: 'sam.achebe' },
  priya: { id: 'priya', name: 'Priya Natarajan', initials: 'PN', handle: 'priya.natarajan' },
  jordan: { id: 'jordan', name: 'Jordan Lee', initials: 'JL', handle: 'jordan.lee' },
  alex: { id: 'alex', name: 'Alex Kim', initials: 'AK', handle: 'alex.kim' },
  noor: { id: 'noor', name: 'Noor Haddad', initials: 'NH', handle: 'noor.haddad' },
  tomas: { id: 'tomas', name: 'Tomás Silva', initials: 'TS', handle: 'tomas.silva', inactive: { since: '2026-10-15T17:00:00Z', by: 'sam' } },
  grace: { id: 'grace', name: 'Grace Wu', initials: 'GW', handle: 'grace.wu' },
  ben: { id: 'ben', name: 'Ben Okafor', initials: 'BO', handle: 'ben.okafor' },
  lena: { id: 'lena', name: 'Lena Fischer', initials: 'LF', handle: 'lena.fischer' },
}

const storyTeamsBase: Omit<Team, keyof Access>[] = [
  // Dogfood: Ideation Factory's own plans, reviewed in Ideation Factory. Its idea
  // opens the real mvp/ docs on the idea page (experiment 1, ?idea=mvp).
  { id: 'dogfood', name: 'Dogfood', description: 'Ideation Factory’s own plans, reviewed in Ideation Factory.', members: ['riley', 'maya', 'sam', 'devon'], createdBy: 'riley', createdAt: '2026-10-26T14:00:00Z', requirements: { minApprovals: 1, groups: [], resolved: false } },
  { id: 'mobile', name: 'Mobile', description: 'The field app and technician tools.', members: ['riley', 'maya', 'devon', 'alex'], createdBy: 'maya', createdAt: '2025-03-04T10:00:00Z', requirements: { minApprovals: 1, groups: [{ kind: 'any', groupIds: ['mobile-leads'], autoAdd: true }], resolved: false } },
  { id: 'platform', name: 'Platform', description: 'APIs, sync, and shared infrastructure.', members: ['sam', 'riley', 'priya', 'ben'], createdBy: 'sam', createdAt: '2025-02-11T10:00:00Z', requirements: { minApprovals: 2, groups: [{ kind: 'any', groupIds: ['platform-reviewers', 'api-reviewers'] }], resolved: false } },
  { id: 'payments', name: 'Payments', description: 'Billing, invoices, and payment providers.', members: ['jordan', 'noor', 'tomas'], createdBy: 'jordan', createdAt: '2025-05-20T10:00:00Z', requirements: { minApprovals: 2, groups: [{ kind: 'any', groupIds: ['security-champions'] }], resolved: true } },
  { id: 'data', name: 'Data', description: 'Warehouse, reporting, and ML features.', members: ['grace', 'lena', 'priya'], createdBy: 'grace', createdAt: '2025-06-01T10:00:00Z', requirements: { minApprovals: 1, groups: [{ kind: 'any', groupIds: ['data-stewards'] }], resolved: false } },
  { id: 'design-systems', name: 'Design Systems', description: 'Shared UI components, tokens, and themes.', members: ['alex', 'maya', 'grace'], createdBy: 'alex', createdAt: '2025-07-15T10:00:00Z', requirements: { minApprovals: 0, groups: [{ kind: 'any', groupIds: ['design-crit'] }], resolved: false } },
  { id: 'security', name: 'Security', description: 'AppSec reviews, auth, and secrets.', members: ['ben', 'noor'], createdBy: 'ben', createdAt: '2025-04-09T10:00:00Z', requirements: { minApprovals: 0, groups: [{ kind: 'each', groupIds: ['security-champions', 'platform-reviewers'], autoAdd: true }], resolved: true } },
  { id: 'dispatch', name: 'Dispatch', description: 'Scheduling and the dispatcher console.', members: ['tomas', 'devon', 'jordan'], createdBy: 'tomas', createdAt: '2025-08-22T10:00:00Z', requirements: { minApprovals: 2, groups: [], resolved: false } },
  { id: 'personal-riley', name: 'Your ideas', description: 'Ideas that aren’t in any team yet.', members: ['riley'], createdBy: 'riley', createdAt: '2025-03-01T10:00:00Z', requirements: NO_REQUIREMENTS, personal: 'riley' },
  { id: 'incident-response', name: 'Incident Response', description: 'Post-incident reviews and security fixes before they’re public.', members: ['ben', 'noor', 'sam'], createdBy: 'ben', createdAt: '2025-11-10T10:00:00Z', requirements: { minApprovals: 2, groups: [], resolved: true }, locked: true },
  { id: 'board-prep', name: 'Board Prep', description: 'Proposals for the next board meeting, before anyone outside the room sees them.', members: ['jordan', 'sam', 'riley', 'priya', 'noor'], createdBy: 'jordan', createdAt: '2026-08-15T10:00:00Z', requirements: { minApprovals: 1, groups: [], resolved: false }, locked: true, memberSees: 'assigned' },
  { id: 'project-kite', name: 'Project Kite', description: 'Integration plans for an acquisition that isn’t announced yet.', members: ['sam', 'riley', 'priya', 'jordan'], createdBy: 'sam', createdAt: '2026-09-01T10:00:00Z', requirements: { minApprovals: 2, groups: [], resolved: false }, locked: true },
]

// Riley's watch level per team (anything not listed is 'participating').
const storyWatching: Record<string, WatchLevel> = { platform: 'all', payments: 'active' }

const storyGroupsBase: Omit<Group, keyof Access>[] = [
  { id: 'platform-reviewers', name: 'Platform reviewers', description: 'Second pair of eyes for anything touching shared services.', members: ['sam', 'priya', 'ben'], createdBy: 'sam', createdAt: '2025-09-01T10:00:00Z' },
  { id: 'api-reviewers', name: 'API reviewers', description: 'Anyone adding or changing a public endpoint.', members: ['sam', 'priya', 'jordan', 'riley'], createdBy: 'sam', createdAt: '2025-09-12T10:00:00Z' },
  { id: 'mobile-leads', name: 'Mobile leads', description: '', members: ['maya', 'riley'], createdBy: 'maya', createdAt: '2025-10-03T10:00:00Z' },
  { id: 'security-champions', name: 'Security champions', description: 'One person per team who knows the threat model.', members: ['ben', 'noor', 'devon'], createdBy: 'ben', createdAt: '2026-01-14T10:00:00Z' },
  { id: 'data-stewards', name: 'Data stewards', description: 'Owners of shared datasets.', members: ['grace', 'lena'], createdBy: 'grace', createdAt: '2025-11-02T10:00:00Z' },
  { id: 'design-crit', name: 'Design crit', description: 'Weekly design critique crew.', members: ['alex', 'grace', 'maya'], createdBy: 'alex', createdAt: '2026-02-02T10:00:00Z' },
]

const u = (userId: string): Reviewer => ({ kind: 'user', userId })
const g = (groupId: string): Reviewer => ({ kind: 'group', groupId })

// Roles, join policy and pending requests for the story's teams and groups.
const access = (a: Partial<Access> & Pick<Access, 'admins'>): Access => ({ maintainers: [], joinPolicy: 'open', requests: [], ...a })
const storyTeamAccess: Record<string, Access> = {
  dogfood: access({ admins: ['riley'], maintainers: ['maya'] }),
  mobile: access({
    admins: ['maya'],
    maintainers: ['riley'],
    joinPolicy: 'invite',
    requests: [
      { userId: 'u12', at: '2026-10-24T09:10:00Z', note: 'Joining the field app squad next sprint.' },
      { userId: 'u87', at: '2026-10-23T16:40:00Z' },
    ],
  }),
  platform: access({ admins: ['sam'], maintainers: ['priya'] }),
  payments: access({ admins: ['jordan'], maintainers: ['noor'], joinPolicy: 'invite' }),
  data: access({ admins: ['grace'], maintainers: ['lena'] }),
  'design-systems': access({ admins: ['alex'], maintainers: ['maya'] }),
  security: access({ admins: ['ben'], maintainers: ['noor'], joinPolicy: 'invite' }),
  dispatch: access({ admins: ['tomas'] }),
  'personal-riley': access({ admins: ['riley'], joinPolicy: 'invite' }),
  'incident-response': access({ admins: ['ben'], maintainers: ['noor'], joinPolicy: 'invite' }),
  'board-prep': access({ admins: ['jordan'], maintainers: ['sam'], joinPolicy: 'invite' }),
  'project-kite': access({ admins: ['sam', 'riley'], maintainers: ['priya'], joinPolicy: 'invite', requests: [{ userId: 'devon', at: '2026-10-24T08:20:00Z', note: 'Asked to help with the dispatch integration.' }] }),
}
const storyGroupAccess: Record<string, Access> = {
  'platform-reviewers': access({ admins: ['sam'], maintainers: ['priya'], joinPolicy: 'invite' }),
  'api-reviewers': access({ admins: ['sam'] }),
  'mobile-leads': access({ admins: ['maya', 'riley'], joinPolicy: 'invite', requests: [{ userId: 'alex', at: '2026-10-22T13:00:00Z', note: 'I lead the maps work.' }] }),
  'security-champions': access({ admins: ['ben'], maintainers: ['noor'], joinPolicy: 'invite' }),
  'data-stewards': access({ admins: ['grace'], deletedAt: '2026-10-23T10:00:00Z', deletedBy: 'grace' }),
  'design-crit': access({ admins: ['alex'] }),
}
const storyTeams: Team[] = storyTeamsBase.map((t) => ({ ...t, ...storyTeamAccess[t.id] }))
const storyGroups: Group[] = storyGroupsBase.map((g) => ({ ...g, ...storyGroupAccess[g.id] }))

const storyIdeas: Idea[] = [
  { id: 'idea-mvp', title: 'Ideation Factory MVP architecture', description: 'The pitch for the minimum viable product: the high-level design and tech stack, then the front end, the back end, and the cli and skills.', teamId: 'dogfood', authorId: 'riley', status: 'requesting review', reviewers: [u('maya'), u('sam')], approvals: [], version: 1, openThreads: 3, updatedAt: '2026-10-26T17:02:00Z' },
  { id: 'idea-142', title: 'Offline-first sync for the field app', description: 'Let technicians finish work orders with no signal, and sync in the background when they reconnect.', teamId: 'mobile', authorId: 'riley', status: 'requesting review', reviewers: [u('maya'), u('devon'), g('platform-reviewers')], approvals: [], version: 3, openThreads: 11, updatedAt: '2026-10-24T12:05:00Z' },
  { id: 'idea-151', title: 'Batch endpoint for sync', description: 'A single /sync endpoint that accepts batches of operations and returns remote changes.', teamId: 'platform', authorId: 'sam', status: 'draft', reviewers: [], approvals: [], version: 1, openThreads: 0, updatedAt: '2026-10-24T08:30:00Z' },
  { id: 'idea-139', title: 'Retry budget for outbound webhooks', description: 'Cap retries per customer so one broken endpoint cannot starve the delivery queue.', teamId: 'platform', authorId: 'priya', status: 'requesting review', reviewers: [u('riley'), u('ben'), g('api-reviewers')], approvals: ['ben'], version: 2, openThreads: 4, updatedAt: '2026-10-24T10:40:00Z' },
  { id: 'idea-147', title: 'Photo uploads on metered connections', description: 'Queue large photo uploads until Wi-Fi, with a per-device override.', teamId: 'mobile', authorId: 'devon', status: 'changes in progress', reviewers: [u('riley'), u('alex')], approvals: [], version: 2, openThreads: 3, updatedAt: '2026-10-23T16:20:00Z' },
  { id: 'idea-133', title: 'Split invoices across payment methods', description: 'Let a customer pay one invoice with two cards, or a card and a bank transfer.', teamId: 'payments', authorId: 'jordan', status: 'requesting review', reviewers: [u('noor'), u('tomas')], approvals: ['noor'], version: 3, openThreads: 6, updatedAt: '2026-10-24T13:10:00Z' },
  { id: 'idea-150', title: 'Refund idempotency keys', description: 'Require an idempotency key on refunds so retries never refund twice.', teamId: 'payments', authorId: 'noor', status: 'approved', reviewers: [u('jordan'), g('security-champions')], approvals: ['jordan', 'ben'], version: 2, openThreads: 0, updatedAt: '2026-10-24T14:10:00Z' },
  { id: 'idea-145', title: 'Payment provider failover', description: 'Route card payments to a secondary provider when the primary is degraded.', teamId: 'payments', authorId: 'tomas', status: 'requesting review', reviewers: [u('noor'), u('jordan'), g('api-reviewers')], approvals: ['jordan'], version: 2, openThreads: 5, updatedAt: '2026-10-22T15:45:00Z' },
  { id: 'idea-128', title: 'Retire the legacy reporting cron', description: 'Move the nightly reports to the warehouse scheduler and delete the old cron box.', teamId: 'data', authorId: 'grace', status: 'changes in progress', reviewers: [u('lena'), u('priya')], approvals: [], version: 4, openThreads: 1, updatedAt: '2026-10-21T09:15:00Z' },
  { id: 'idea-144', title: 'Feature store for ETA predictions', description: 'Shared features for arrival-time models, computed once and served to both batch and online.', teamId: 'data', authorId: 'lena', status: 'requesting review', reviewers: [u('grace'), u('priya'), u('riley')], approvals: [], version: 1, openThreads: 3, updatedAt: '2026-10-22T10:30:00Z' },
  { id: 'idea-149', title: 'Dark mode tokens for the console', description: 'Semantic color tokens so the dispatcher console can ship a dark theme.', teamId: 'design-systems', authorId: 'alex', status: 'requesting review', reviewers: [u('maya'), u('grace'), g('design-crit')], approvals: [], version: 2, openThreads: 7, updatedAt: '2026-10-24T09:50:00Z' },
  { id: 'idea-136', title: 'Button density scale', description: 'Compact, default, and comfortable sizes for every button variant.', teamId: 'design-systems', authorId: 'maya', status: 'draft', reviewers: [], approvals: [], version: 1, openThreads: 0, updatedAt: '2026-10-20T14:00:00Z' },
  { id: 'idea-146', title: 'Rotate service tokens automatically', description: 'Short-lived service tokens, rotated by the platform instead of by hand.', teamId: 'security', authorId: 'ben', status: 'requesting review', reviewers: [u('noor'), g('security-champions'), u('riley')], approvals: ['noor'], version: 2, openThreads: 4, updatedAt: '2026-10-24T11:25:00Z' },
  { id: 'idea-141', title: 'Dispatcher drag-and-drop scheduling', description: 'Drag work orders onto technicians in the dispatcher console.', teamId: 'dispatch', authorId: 'tomas', status: 'approved', reviewers: [u('devon'), u('jordan')], approvals: ['devon', 'jordan'], version: 2, openThreads: 0, updatedAt: '2026-10-23T13:40:00Z' },
  { id: 'idea-152', title: 'SLA timers for the dispatch queue', description: 'Show how long each work order has waited against its SLA.', teamId: 'dispatch', authorId: 'jordan', status: 'draft', reviewers: [], approvals: [], version: 1, openThreads: 0, updatedAt: '2026-10-24T07:10:00Z' },
  { id: 'idea-138', title: 'Sync conflict banner copy', description: 'Wording for the banner technicians see when two edits conflict.', teamId: 'mobile', authorId: 'maya', status: 'requesting review', reviewers: [u('riley'), u('devon')], approvals: [], version: 1, openThreads: 2, updatedAt: '2026-10-23T17:05:00Z' },
  { id: 'idea-140', title: 'Offline maps cache size', description: 'How much map data to keep on the device, and when to evict it.', teamId: 'mobile', authorId: 'alex', status: 'changes in progress', reviewers: [u('maya')], approvals: [], version: 3, openThreads: 1, updatedAt: '2026-10-19T12:00:00Z' },
  // locked teams: only members see these
  { id: 'idea-170', title: 'Rotate the leaked CI deploy key', description: 'Contain and rotate the deploy key exposed in last week’s incident.', teamId: 'incident-response', authorId: 'ben', status: 'requesting review', reviewers: [u('noor'), u('sam')], approvals: ['noor'], version: 2, openThreads: 3, updatedAt: '2026-10-24T11:40:00Z' },
  { id: 'idea-171', title: 'Postmortem: payments outage on Oct 18', description: 'Timeline, root cause and follow-ups for the 47-minute card payments outage.', teamId: 'incident-response', authorId: 'noor', status: 'draft', reviewers: [], approvals: [], version: 1, openThreads: 0, updatedAt: '2026-10-23T09:00:00Z' },
  { id: 'idea-172', title: 'Merge Kite’s customer accounts into ours', description: 'Map Kite accounts onto existing customers without breaking either login.', teamId: 'project-kite', authorId: 'sam', status: 'requesting review', reviewers: [u('riley'), u('priya')], approvals: [], version: 1, openThreads: 4, updatedAt: '2026-10-24T13:30:00Z' },
  { id: 'idea-173', title: 'Kite field app: keep or retire?', description: 'Whether Kite’s technicians move to our field app on day one or after six months.', teamId: 'project-kite', authorId: 'riley', status: 'draft', reviewers: [], approvals: [], version: 1, openThreads: 0, updatedAt: '2026-10-22T18:00:00Z' },
  // Board Prep shows members only the ideas they're on: Riley (a member) sees 175 and 176, not 177
  { id: 'idea-175', title: 'Field app numbers for the board deck', description: 'Adoption, sync reliability and support tickets since the offline launch.', teamId: 'board-prep', authorId: 'riley', status: 'draft', reviewers: [], approvals: [], version: 1, openThreads: 0, updatedAt: '2026-10-23T15:00:00Z' },
  { id: 'idea-176', title: 'Next year’s platform budget', description: 'Where the platform spend goes next year, and what we stop doing.', teamId: 'board-prep', authorId: 'jordan', status: 'requesting review', reviewers: [u('riley'), u('sam')], approvals: ['sam'], version: 2, openThreads: 2, updatedAt: '2026-10-24T10:10:00Z' },
  { id: 'idea-177', title: 'Reorg of the support team', description: 'Merging the two support queues and who leads them.', teamId: 'board-prep', authorId: 'sam', status: 'requesting review', reviewers: [u('priya'), u('noor')], approvals: [], version: 1, openThreads: 1, updatedAt: '2026-10-24T09:30:00Z' },
  // Riley's own ideas, not in any team
  { id: 'idea-160', title: 'Team-level SLOs for internal tools', description: 'Rough notes on giving internal tools the same SLOs as customer-facing ones.', teamId: 'personal-riley', authorId: 'riley', status: 'draft', reviewers: [], approvals: [], version: 1, openThreads: 0, updatedAt: '2026-10-24T07:30:00Z' },
  { id: 'idea-161', title: 'Keep cli tokens in the OS keychain', description: 'Store ideaf tokens in the macOS Keychain / libsecret instead of a dotfile.', teamId: 'personal-riley', authorId: 'riley', status: 'requesting review', reviewers: [u('maya')], approvals: [], version: 2, openThreads: 1, updatedAt: '2026-10-23T20:15:00Z' },
  { id: 'idea-157', title: 'An ADR template we’d actually use', description: 'Shorter than the old one: context, decision, consequences, and who decided.', teamId: 'personal-riley', authorId: 'riley', status: 'closed', closedReason: 'accepted', reviewers: [], approvals: [], version: 3, openThreads: 0, updatedAt: '2026-10-12T16:00:00Z' },
  // closed
  { id: 'idea-131', title: 'Card-on-file migration', description: 'Move stored cards to the new vault without asking customers to re-enter them.', teamId: 'payments', authorId: 'jordan', status: 'closed', closedReason: 'accepted', reviewers: [u('noor'), g('security-champions')], approvals: ['noor', 'ben'], version: 4, openThreads: 0, updatedAt: '2026-10-23T09:00:00Z' },
  { id: 'idea-125', title: 'GraphQL gateway for partner APIs', description: 'A single GraphQL endpoint in front of the partner REST APIs.', teamId: 'platform', authorId: 'priya', status: 'closed', closedReason: 'rejected', reviewers: [u('sam'), g('api-reviewers')], approvals: [], version: 2, openThreads: 0, updatedAt: '2026-10-18T16:30:00Z' },
  { id: 'idea-119', title: 'Kotlin rewrite of the photo pipeline', description: 'Replace the photo capture and compression pipeline with a native Kotlin module.', teamId: 'mobile', authorId: 'devon', status: 'closed', closedReason: 'rejected', reviewers: [u('riley'), u('alex')], approvals: [], version: 2, openThreads: 0, updatedAt: '2026-09-30T11:00:00Z' },
  { id: 'idea-122', title: 'Shared date picker component', description: 'One accessible date picker for every app, with range and time support.', teamId: 'design-systems', authorId: 'grace', status: 'closed', closedReason: 'accepted', reviewers: [u('alex'), g('design-crit')], approvals: ['alex'], version: 3, openThreads: 0, updatedAt: '2026-10-10T10:00:00Z' },
  { id: 'idea-127', title: 'Nightly backup verification', description: 'Restore last night’s backups into a scratch database and check them automatically.', teamId: 'security', authorId: 'noor', status: 'closed', closedReason: 'accepted', reviewers: [u('ben'), g('platform-reviewers')], approvals: ['ben', 'sam'], version: 2, openThreads: 0, updatedAt: '2026-10-14T15:00:00Z' },
  { id: 'idea-134', title: 'Route optimization v2', description: 'Re-plan technician routes every 15 minutes using live traffic.', teamId: 'dispatch', authorId: 'tomas', status: 'closed', closedReason: 'accepted', reviewers: [u('devon'), u('jordan')], approvals: ['devon', 'jordan'], version: 5, openThreads: 0, updatedAt: '2026-10-20T12:00:00Z' },
]

const storyNotifications: Notification[] = [
  { id: 'n-mvp', at: '2026-10-26T16:45:00Z', ideaId: 'idea-mvp', kind: 'comment', actor: { kind: 'user', userId: 'sam' }, text: 'commented on “One Durable Object per idea.”', reason: { kind: 'author' }, read: false },
  { id: 'n1', at: '2026-10-24T12:05:00Z', ideaId: 'idea-142', kind: 'comment', actor: { kind: 'user', userId: 'sam' }, text: 'commented on § Conflicts', excerpt: 'Per-field merging means the server needs a field-level schema for every record type…', reason: { kind: 'author' }, read: false },
  { id: 'n2', at: '2026-10-24T13:10:00Z', ideaId: 'idea-133', kind: 'version', actor: { kind: 'user', userId: 'jordan' }, text: 'uploaded v3', excerpt: '“Handle partial refunds across methods”', reason: { kind: 'team-watch', teamId: 'payments', level: 'active' }, read: false },
  { id: 'n3', at: '2026-10-24T11:25:00Z', ideaId: 'idea-146', kind: 'comment', actor: { kind: 'bot', bot: 'secbot' }, text: 'commented on § Token lifetime', excerpt: 'Proposed TTL of 30 days is above the policy maximum of 7 days. (Automated check: token-policy)', reason: { kind: 'reviewer' }, read: false },
  { id: 'n4', at: '2026-10-24T10:40:00Z', ideaId: 'idea-139', kind: 'review-requested', actor: { kind: 'user', userId: 'priya' }, text: 'requested your review', reason: { kind: 'reviewer' }, read: false },
  { id: 'n5', at: '2026-10-24T09:20:00Z', ideaId: 'idea-142', kind: 'comment', actor: { kind: 'user', userId: 'maya' }, text: 'commented on the whole file', excerpt: 'Overall this reads well. I’d like one pass from someone on the Platform team…', reason: { kind: 'author' }, read: false },
  { id: 'n6', at: '2026-10-24T08:30:00Z', ideaId: 'idea-151', kind: 'new-idea', actor: { kind: 'userbot', bot: 'planbot', userId: 'sam' }, text: 'created a draft idea', reason: { kind: 'team-watch', teamId: 'platform', level: 'all' }, read: true },
  { id: 'n7', at: '2026-10-24T08:01:00Z', ideaId: 'idea-142', kind: 'suggestion', actor: { kind: 'userbot', bot: 'typobot', userId: 'devon' }, text: 'suggested an edit in conflict-resolution.md', excerpt: 'colleage’s → colleague’s', reason: { kind: 'author' }, read: true },
  { id: 'n8', at: '2026-10-23T17:05:00Z', ideaId: 'idea-138', kind: 'review-requested', actor: { kind: 'user', userId: 'maya' }, text: 'requested your review', reason: { kind: 'reviewer' }, read: true },
  { id: 'n9', at: '2026-10-23T16:20:00Z', ideaId: 'idea-147', kind: 'status', actor: { kind: 'user', userId: 'devon' }, text: 'changed the status to Changes in progress', reason: { kind: 'reviewer' }, read: true },
  { id: 'n10', at: '2026-10-23T11:00:00Z', ideaId: 'idea-150', kind: 'new-idea', actor: { kind: 'user', userId: 'noor' }, text: 'asked for review', reason: { kind: 'team-watch', teamId: 'payments', level: 'active' }, read: true },
  { id: 'n11', at: '2026-10-22T15:45:00Z', ideaId: 'idea-145', kind: 'review-requested', actor: { kind: 'user', userId: 'tomas' }, text: 'requested review from API reviewers', reason: { kind: 'group', groupId: 'api-reviewers' }, read: true },
  { id: 'n13', at: '2026-10-24T14:10:00Z', ideaId: 'idea-150', kind: 'approved', actor: { kind: 'user', userId: 'ben' }, text: 'approved it, and all of Payments’ requirements are now met', reason: { kind: 'team-watch', teamId: 'payments', level: 'active' }, read: false },
  { id: 'n14', at: '2026-10-23T09:00:00Z', ideaId: 'idea-131', kind: 'closed', actor: { kind: 'user', userId: 'jordan' }, text: 'closed it as accepted', reason: { kind: 'team-watch', teamId: 'payments', level: 'active' }, read: true },
  { id: 'n15', at: '2026-10-18T16:30:00Z', ideaId: 'idea-125', kind: 'closed', actor: { kind: 'user', userId: 'priya' }, text: 'closed it as rejected', excerpt: 'We’ll keep the REST APIs and invest in better client SDKs instead.', reason: { kind: 'team-watch', teamId: 'platform', level: 'all' }, read: true },
  { id: 'n16', at: '2026-10-24T13:30:00Z', ideaId: 'idea-172', kind: 'review-requested', actor: { kind: 'user', userId: 'sam' }, text: 'requested your review', reason: { kind: 'reviewer' }, read: false },
  { id: 'n12', at: '2026-10-22T10:30:00Z', ideaId: 'idea-144', kind: 'review-requested', actor: { kind: 'user', userId: 'lena' }, text: 'requested your review', reason: { kind: 'reviewer' }, read: true },
]

// Ideas Riley follows by hand (the bell on an idea), on top of the automatic reasons.
export const initialSubscribed: string[] = []
export const initialMuted: string[] = []

export const initialTokens: Token[] = [
  { id: 't1', name: 'Laptop CLI', scope: 'personal', purpose: 'me', prefix: 'ideaf_u_7Hq2', createdAt: '2026-09-02T09:00:00Z', lastUsedAt: '2026-10-24T13:00:00Z', expiresAt: '2026-12-01T09:00:00Z' },
  { id: 't2', name: 'Claude Code planning agent', scope: 'personal', purpose: 'userbot', bot: 'planbot', prefix: 'ideaf_ub_Kx91', createdAt: '2026-09-15T09:00:00Z', lastUsedAt: '2026-10-23T18:40:00Z', expiresAt: '2027-09-15T09:00:00Z' },
  { id: 't3', name: 'CI architecture checks', scope: 'personal', purpose: 'bot', bot: 'archbot', prefix: 'ideaf_b_m3Ze', createdAt: '2026-08-01T09:00:00Z', lastUsedAt: '2026-10-23T18:44:00Z', expiresAt: '2027-08-01T09:00:00Z' },
  { id: 't4', name: 'Offboarding sync', scope: 'site-admin', reason: 'Marks people inactive from the HR leavers feed', purpose: 'me', prefix: 'ideaf_sa_Q8r1', createdAt: '2026-10-20T09:00:00Z', lastUsedAt: '2026-10-24T06:00:00Z', expiresAt: '2026-10-27T09:00:00Z' },
]

// ---------- merge the story with generated data ----------

const gen = generate(ME, storyTeams, storyGroups)

export { SCALE }
export const initialUsers: Record<string, User> = {
  ...gen.users,
  ...Object.fromEntries(Object.entries(storyUsers).map(([id, u]) => [id, { ...u, email: `${u.handle}@${EMAIL_DOMAIN}` }])),
}
export const initialTeams: Team[] = [...storyTeams, ...gen.teams]
export const initialGroups: Group[] = [...storyGroups, ...gen.groups]
export const initialWatching: Record<string, WatchLevel> = { ...gen.myWatching, ...storyWatching }
export const initialIdeas: Idea[] = [...storyIdeas, ...gen.ideas]
export const initialNotifications: Notification[] = [...storyNotifications, ...gen.notifications].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
