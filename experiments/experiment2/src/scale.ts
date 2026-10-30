// PROTOTYPE: generated data at a realistic scale, so the UI is designed against
// thousands of people, hundreds of teams and groups, and thousands of ideas
// instead of a hand-picked dozen. Deterministic (seeded), so it's the same on
// every reload. The hand-written story data in data.ts sits on top of it.
import { NO_REQUIREMENTS, type Access, type Actor, type ClosedReason, type Group, type Idea, type IdeaStatus, type Notification, type NotificationKind, type Reason, type Reviewer, type Rule, type Team, type User, type WatchLevel } from './data'

export const SCALE = { users: 3000, teams: 240, groups: 600, ideas: 6000, myNotifications: 420 }

function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FIRST = 'Aaliyah Aaron Abby Adam Adrian Ahmed Aisha Alex Alice Amara Amir Ana Andre Anika Anton Ari Asha Ben Bianca Bo Caleb Camila Carlos Chen Chloe Chris Dana Daniel Dara Deepa Diego Elena Eli Emil Emma Eva Farah Felix Fiona Gabe Grace Hana Hiro Ian Ines Isaac Ivy Jae Jamal Jana Jin Jonas Jordan Jose Julia Kai Kara Karim Kenji Kim Lars Lea Leo Lina Luca Lucia Maria Mark Mateo Maya Mei Mila Nadia Nate Nia Nico Nina Noah Nora Omar Owen Paula Pedro Priya Quinn Rafael Rana Ravi Rosa Ruth Sam Sara Selin Sofia Tara Theo Tomas Uma Vera Victor Wen Yara Yusuf Zane Zoe'.split(' ')
const LAST = 'Abbott Adeyemi Ahmed Alvarez Andersen Bauer Becker Bianchi Brooks Chen Choi Cohen Costa Cruz Das Diaz Dubois Edwards Evans Fischer Fong Garcia Gomez Gupta Haddad Hansen Hughes Ibrahim Ito Jensen Johnson Kaur Kim Kowalski Kumar Lee Lewis Lim Lopez Martin Meyer Miller Moreau Murphy Nakamura Nguyen Novak Okafor Olsen Ortiz Park Patel Perez Petrov Reyes Rossi Saito Santos Schmidt Shah Silva Singh Smith Suzuki Tanaka Taylor Torres Wagner Wang Weber Wilson Wu Yamada Young Zhang'.split(' ')
const AREA = 'Billing Search Checkout Onboarding Identity Notifications Reporting Inventory Scheduling Routing Pricing Catalog Messaging Analytics Payroll Compliance Fleet Support Docs Storage Gateway Mobile Web Desktop Data Infra Observability Release Growth Partner Ads Maps Media Ledger Fraud Trust Accessibility Localization Hardware Field'.split(' ')
const KIND = 'Core|Platform|Experience|Tools|Insights|Infra|Quality|API|Apps|Ops'.split('|')
const VERB = 'Migrate|Replace|Introduce|Retire|Split|Cache|Batch|Rate-limit|Shard|Version|Audit|Simplify|Rewrite|Deprecate|Standardize|Encrypt|Backfill|Throttle|Index|Document'.split('|')
const THING = 'the invoice pipeline|session tokens|search indexing|webhook delivery|the job scheduler|feature flags|the CSV exporter|audit logs|image thumbnails|the permissions model|email templates|the pricing engine|offline caching|the reporting warehouse|push notifications|the onboarding checklist|address validation|the dispatch queue|currency conversion|the admin console|API pagination|retry policies|tenant isolation|file uploads|the help center|map tiles|the release train|error budgets|dark mode tokens|the plugin API'.split('|')
const WHY = 'to cut p95 latency in half|so on-call stops getting paged for it|before the contract renewal|to unblock the EU launch|so agents can use it safely|to remove a single point of failure|to halve the infra bill|because the current approach does not scale past 10k tenants|so support can self-serve|ahead of the SOC 2 audit'.split('|')

export type Generated = {
  users: Record<string, User>
  teams: Team[]
  groups: Group[]
  ideas: Idea[]
  notifications: Notification[]
  myTeams: string[]
  myWatching: Record<string, WatchLevel>
}

export function generate(me: string, storyTeams: Team[], storyGroups: Group[]): Generated {
  const r = rng(424242)
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]
  const between = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
  const sample = <T,>(a: T[], n: number) => {
    const out = new Set<T>()
    while (out.size < Math.min(n, a.length)) out.add(pick(a))
    return [...out]
  }

  // admins: the creator (sometimes one more); a few maintainers; a quarter are invite only
  const roles = (members: string[]): Access => {
    const invite = r() < 0.25
    return {
      admins: members.slice(0, r() < 0.3 ? 2 : 1),
      maintainers: members.slice(2, 2 + between(0, 2)),
      joinPolicy: invite ? 'invite' : 'open',
      requests: invite && r() < 0.4 ? sample(userIds, between(1, 3)).filter((u) => !members.includes(u)).map((userId) => ({ userId, at: new Date(Date.parse('2026-10-24T12:00:00Z') - r() * 6 * 86_400_000).toISOString() })) : [],
    }
  }

  // people: names collide on purpose (e.g. several "Alex Kim"), handles don't
  const users: Record<string, User> = {}
  const handles = new Set<string>()
  for (let i = 0; i < SCALE.users; i++) {
    const first = pick(FIRST)
    const last = pick(LAST)
    let handle = `${first}.${last}`.toLowerCase()
    for (let n = 2; handles.has(handle); n++) handle = `${first}.${last}${n}`.toLowerCase()
    handles.add(handle)
    const id = `u${i}`
    users[id] = { id, name: `${first} ${last}`, initials: (first[0] + last[0]).toUpperCase(), handle, email: `${handle}@acme.dev` }
  }
  const userIds = Object.keys(users)

  // teams: names are unique; sizes vary a lot (a few huge teams, many small ones)
  const teams: Team[] = []
  const names = new Set(storyTeams.map((t) => t.name))
  for (let i = 0; teams.length < SCALE.teams; i++) {
    const name = `${pick(AREA)} ${pick(KIND)}`
    if (names.has(name)) continue
    names.add(name)
    const size = r() < 0.08 ? between(80, 220) : between(4, 30)
    const members = sample(userIds, size)
    teams.push({
      id: `t${i}`,
      name,
      description: `${name.split(' ')[0]} work owned by the ${name} team.`,
      members,
      createdBy: members[0],
      createdAt: new Date(Date.UTC(2023, 0, 1) + r() * 1000 * 86_400_000).toISOString(),
      requirements: NO_REQUIREMENTS,
      ...roles(members),
    })
  }

  // groups: reviewer groups, guilds, champions; some include story people
  const groups: Group[] = []
  const gnames = new Set(storyGroups.map((g) => g.name))
  for (let i = 0; groups.length < SCALE.groups; i++) {
    const team = pick(teams)
    const style = r()
    const name = style < 0.5 ? `${team.name} reviewers` : style < 0.75 ? `${pick(AREA)} guild` : `${pick(AREA)} champions ${between(1, 9)}`
    if (gnames.has(name)) continue
    gnames.add(name)
    const members = sample(style < 0.5 ? team.members : userIds, between(3, style < 0.5 ? 12 : 45))
    groups.push({ id: `g${i}`, name, description: '', members, createdBy: members[0], createdAt: team.createdAt, ...roles(members) })
  }
  // Riley is in a handful of generated groups too
  for (const g of sample(groups, 6)) g.members.push(me)

  // requirements for about half the teams, built from their groups
  for (const t of teams) {
    const own = groups.filter((g) => g.name === `${t.name} reviewers`)
    if (r() < 0.5) continue
    const rules: Rule[] = []
    if (own[0]) rules.push({ kind: 'any', groupIds: [own[0].id] })
    if (r() < 0.15) rules.push({ kind: r() < 0.5 ? 'any' : 'each', groupIds: sample(groups, 2).map((g) => g.id) })
    t.requirements = { minApprovals: r() < 0.6 ? between(1, 3) : 0, groups: rules, resolved: r() < 0.3 }
  }

  // Riley joins four generated teams and watches one of them
  const myTeams = sample(teams.filter((t) => t.members.length < 40), 4).map((t) => t.id)
  for (const id of myTeams) teams.find((t) => t.id === id)!.members.push(me)
  const busy = teams.filter((t) => t.members.length >= 80)
  const myWatching: Record<string, WatchLevel> = { [myTeams[0]]: 'active', [busy[0].id]: 'all' }

  // ideas: most are closed; open ones skew recent
  const STATUS: [IdeaStatus, ClosedReason | undefined, number][] = [
    ['draft', undefined, 0.08],
    ['requesting review', undefined, 0.14],
    ['changes in progress', undefined, 0.07],
    ['approved', undefined, 0.04],
    ['closed', 'accepted', 0.5],
    ['closed', 'rejected', 0.17],
  ]
  const ideas: Idea[] = []
  for (let i = 0; i < SCALE.ideas; i++) {
    const mine = pick(myTeams)
    const team = r() < 0.06 ? teams.find((t) => t.id === mine)! : pick(teams)
    let x = r()
    const [status, closedReason] = STATUS.find(([, , p]) => (x -= p) < 0) ?? STATUS[4]
    const open = status !== 'closed'
    const ageDays = open ? r() * 45 : 20 + r() * 700
    const reviewers: Reviewer[] = sample(team.members, between(1, 3)).map((userId) => ({ kind: 'user', userId }))
    if (r() < 0.35) {
      const g = groups.find((g) => g.name === `${team.name} reviewers`) ?? pick(groups)
      reviewers.push({ kind: 'group', groupId: g.id })
    }
    if (r() < 0.03) reviewers.push({ kind: 'user', userId: me })
    const thing = pick(THING)
    ideas.push({
      id: `idea-${10_000 + i}`,
      title: `${pick(VERB)} ${thing}`,
      description: `${pick(VERB)} ${thing} ${pick(WHY)}.`,
      teamId: team.id,
      authorId: pick(team.members),
      status,
      closedReason,
      reviewers: status === 'draft' ? [] : reviewers,
      approvals: status === 'approved' || closedReason === 'accepted' ? sample(team.members, between(1, 3)) : r() < 0.4 ? sample(team.members, 1) : [],
      version: between(1, 7),
      openThreads: open && status !== 'draft' ? between(0, 14) : 0,
      updatedAt: new Date(Date.parse('2026-10-24T14:00:00Z') - ageDays * 86_400_000).toISOString(),
    })
  }

  // Riley's notifications from ideas Riley listens to, over the last 30 days
  const watchingTeam = (i: Idea): Reason | null => {
    const level = myWatching[i.teamId]
    return level === 'all' || (level === 'active' && i.status !== 'draft') ? { kind: 'team-watch', teamId: i.teamId, level } : null
  }
  const myGroupIds = new Set(groups.filter((g) => g.members.includes(me)).map((g) => g.id))
  const listening = ideas
    .map((i) => {
      const reason: Reason | null = i.reviewers.some((v) => v.kind === 'user' && v.userId === me)
        ? { kind: 'reviewer' }
        : (() => {
            const g = i.reviewers.find((v) => v.kind === 'group' && myGroupIds.has(v.groupId))
            return g && g.kind === 'group' ? { kind: 'group', groupId: g.groupId } : watchingTeam(i)
          })()
      return reason && Date.parse(i.updatedAt) > Date.parse('2026-09-24T00:00:00Z') ? { i, reason } : null
    })
    .filter((x): x is { i: Idea; reason: Reason } => !!x)

  const KINDS: [NotificationKind, string, number][] = [
    ['comment', 'commented', 0.45],
    ['version', 'uploaded a new version', 0.15],
    ['review-requested', 'requested review', 0.12],
    ['status', 'changed the status', 0.1],
    ['suggestion', 'suggested an edit', 0.08],
    ['approved', 'approved it', 0.06],
    ['closed', 'closed it', 0.04],
  ]
  const BOTS: Actor[] = [{ kind: 'bot', bot: 'archbot' }, { kind: 'bot', bot: 'secbot' }, { kind: 'bot', bot: 'lintbot' }]
  const notifications: Notification[] = []
  for (let n = 0; n < SCALE.myNotifications && listening.length; n++) {
    const { i, reason } = pick(listening)
    let x = r()
    const [kind, text] = KINDS.find(([, , p]) => (x -= p) < 0) ?? KINDS[0]
    const team = teams.find((t) => t.id === i.teamId)!
    const who = pick(team.members.filter((m) => m !== me))
    const actor: Actor = r() < 0.12 ? pick(BOTS) : r() < 0.1 ? { kind: 'userbot', bot: 'planbot', userId: who } : { kind: 'user', userId: who }
    const at = new Date(Date.parse(i.updatedAt) - r() * 6 * 86_400_000)
    notifications.push({
      id: `gn${n}`,
      at: at.toISOString(),
      ideaId: i.id,
      kind,
      actor,
      text: kind === 'review-requested' && reason.kind === 'reviewer' ? 'requested your review' : kind === 'closed' ? `closed it as ${i.closedReason ?? 'accepted'}` : text,
      reason,
      read: at.getTime() < Date.parse('2026-10-22T00:00:00Z'),
    })
  }

  return { users, teams, groups, ideas, notifications, myTeams, myWatching }
}
