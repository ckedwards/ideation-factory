// A medium-sized company for scripts/test-ui.sh seed medium: the small organization in
// test-ui-data.ts, and around it about 150 people in ten teams, fifteen groups (some dense, like
// all of engineering; some sparse, like Legal's two) and about 120 ideas, most with a comment or
// two. It's generated the same way every time, from a fixed seed, so a page looks the same after a
// wipe; nothing in it is hand-picked, which the small organization is for.
import type { GroupSeed, IdeaSeed, PersonSeed, TeamSeed } from './test-ui-data.ts'

type Data = {
  people: PersonSeed[]
  groups: GroupSeed[]
  teams: TeamSeed[]
  joinRequests: Array<{ by: string; team?: string; group?: string }>
  ideas: IdeaSeed[]
}

/** A fixed sequence of numbers in [0, 1): the same company every time. */
function random(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FIRST = [
  'Ada',
  'Amir',
  'Ana',
  'Arjun',
  'Bea',
  'Carlos',
  'Chen',
  'Dana',
  'Elif',
  'Emeka',
  'Erik',
  'Fatima',
  'Grace',
  'Hana',
  'Hugo',
  'Ines',
  'Ivan',
  'Jae',
  'Jonas',
  'Kofi',
  'Lara',
  'Leo',
  'Lucia',
  'Malik',
  'Mei',
  'Mira',
  'Nadia',
  'Nico',
  'Olu',
  'Omar',
  'Paula',
  'Quinn',
  'Rosa',
  'Ravi',
  'Sara',
  'Sven',
  'Tara',
  'Uma',
  'Victor',
  'Wen',
  'Yara',
  'Yusuf',
]
const LAST = [
  'Adeyemi',
  'Andersson',
  'Bauer',
  'Costa',
  'Dubois',
  'Eriksen',
  'Ferreira',
  'Garcia',
  'Haas',
  'Ito',
  'Jensen',
  'Khan',
  'Kim',
  'Larsen',
  'Lopez',
  'Moreau',
  'Mensah',
  'Novak',
  'Okeke',
  'Park',
  'Quist',
  'Rossi',
  'Sato',
  'Schmidt',
  'Singh',
  'Tanaka',
  'Usman',
  'Varga',
  'Weber',
  'Yilmaz',
  'Zhang',
]

/** The teams added, with how many people each has: from a crowd to a handful. */
const TEAMS: Array<{ handle: string; name: string; description: string; size: number; topics: string[] }> = [
  {
    handle: 'infra',
    name: 'Infrastructure',
    description: 'Clusters, networks, deploys and the bill for them.',
    size: 30,
    topics: [
      'the deploy pipeline',
      'cluster autoscaling',
      'database backups',
      'TLS certificates',
      'the load balancers',
      'log retention',
      'staging environments',
      'secrets rotation',
    ],
  },
  {
    handle: 'web',
    name: 'Web',
    description: 'The web app, from the sign-in page in.',
    size: 25,
    topics: [
      'the settings pages',
      'keyboard shortcuts',
      'the editor toolbar',
      'page load times',
      'dark mode',
      'the onboarding tour',
      'form validation',
      'the empty states',
    ],
  },
  {
    handle: 'data',
    name: 'Data',
    description: 'The warehouse, the pipelines into it, and the dashboards on it.',
    size: 18,
    topics: [
      'the nightly export',
      'event tracking',
      'the revenue dashboard',
      'data retention',
      'the warehouse schema',
      'late events',
    ],
  },
  {
    handle: 'payments',
    name: 'Payments',
    description: 'Billing, invoices, refunds and the payment providers.',
    size: 14,
    topics: ['failed card payments', 'invoice emails', 'refunds', 'tax rates', 'annual plans', 'payment retries'],
  },
  {
    handle: 'discovery',
    name: 'Discovery',
    description: 'Finding things: the index, ranking and the search box.',
    size: 10,
    topics: ['typo tolerance', 'search ranking', 'the index rebuild', 'search filters'],
  },
  {
    handle: 'growth',
    name: 'Growth',
    description: 'Sign-ups, trials and what makes people stay.',
    size: 8,
    topics: ['the trial length', 'referral credits', 'the pricing page', 'welcome emails'],
  },
  {
    handle: 'support',
    name: 'Support',
    description: 'Helping customers, and telling the rest of us what hurts.',
    size: 5,
    topics: ['the help centre', 'ticket tags', 'canned replies'],
  },
]

/** The groups added: dense ones (the size of a department) and sparse ones (two or three people). */
const GROUPS: Array<{ handle: string; name: string; description: string; size: number }> = [
  { handle: 'engineering', name: 'All engineering', description: 'Everyone who writes code here.', size: 70 },
  { handle: 'on-call', name: 'On call', description: 'Everyone on an on-call rotation.', size: 40 },
  { handle: 'api-review', name: 'API review', description: 'Reviews changes to the public API.', size: 24 },
  { handle: 'managers', name: 'Managers', description: 'Engineering and product managers.', size: 20 },
  { handle: 'architecture', name: 'Architecture council', description: 'Decisions that span teams.', size: 6 },
  {
    handle: 'data-stewards',
    name: 'Data stewards',
    description: 'Who decides what data we keep, and for how long.',
    size: 5,
  },
  { handle: 'interns', name: 'Interns', description: 'This summer’s interns.', size: 4 },
  { handle: 'brand', name: 'Brand', description: 'The logo, the voice and the website.', size: 3 },
  { handle: 'privacy', name: 'Privacy', description: 'Personal data, consent and requests to delete it.', size: 3 },
  { handle: 'legal', name: 'Legal', description: 'Contracts, terms and anything a lawyer should see.', size: 2 },
  {
    handle: 'accessibility',
    name: 'Accessibility',
    description: 'Checks that everything works with a keyboard and a screen reader.',
    size: 2,
  },
  { handle: 'docs', name: 'Docs', description: 'The public documentation.', size: 2 },
]

const VERBS = [
  'Rethink',
  'Simplify',
  'Speed up',
  'Monitor',
  'Document',
  'Automate',
  'Replace',
  'Split up',
  'Test',
  'Clean up',
]
const PROBLEMS = [
  'It breaks about once a month, and each time someone loses an afternoon to it.',
  'Nobody owns it, so changes to it wait weeks for a review.',
  'Customers ask about it in about one support ticket in twenty.',
  'It was built for a tenth of the traffic it sees now.',
  'Every team does it differently, and the differences cause bugs at the seams.',
  'It costs more each month than anything else in its area.',
]
const PROPOSALS = [
  'Move it behind one small service with a clear owner and an on-call rotation.',
  'Write down how it works today, then remove the half nobody uses.',
  'Measure it for two weeks first, then change the slowest part.',
  'Replace it with the managed service we already pay for elsewhere.',
  'Give it a weekly report, so problems show before customers see them.',
  'Make it a library every team uses, instead of five copies.',
]
const RISKS = [
  'The migration needs a freeze of about a day.',
  'Two other teams depend on its current behaviour.',
  'It may cost more for the first quarter.',
  'There is no rollback once the old data is deleted.',
]
const REMARKS = [
  'Do we have numbers for how often this happens?',
  'Who would own this afterwards?',
  'This overlaps with what the Platform team is doing. Worth a chat.',
  'Looks good to me.',
  'Can we try it on one service first?',
  'What happens to the existing data?',
  'I like this. The rollout section could say more.',
  'How long would the freeze be, in practice?',
]
const REPLIES = [
  'Good point, adding it.',
  'About twice a week, from the logs.',
  'Agreed.',
  'Let’s talk at planning.',
  'Yes, that’s the plan.',
]

export function medium(small: Data): Data {
  const next = random(20261116)
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!
  /** `n` different items from `list`, in a fixed but shuffled order. */
  const some = <T>(list: readonly T[], n: number): T[] => {
    const copy = [...list]
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1))
      ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
    }
    return copy.slice(0, Math.min(n, copy.length))
  }

  // people: names nobody in the small organization has, until there are 150
  const people: PersonSeed[] = []
  const taken = new Set(small.people.map((p) => p.handle))
  while (small.people.length + people.length < 150) {
    const first = pick(FIRST)
    const last = pick(LAST)
    const handle = `${first}-${last}`.toLowerCase()
    if (!taken.has(handle)) {
      taken.add(handle)
      people.push({ handle, name: `${first} ${last}`, email: `${handle}@example.com` })
    }
  }
  const handles = people.map((p) => p.handle)

  // groups: each made by its first member
  const groups: GroupSeed[] = GROUPS.map((g) => {
    const [admin, ...rest] = some(handles, g.size)
    return {
      handle: g.handle,
      name: g.name,
      description: g.description,
      admin: admin!,
      members: Object.fromEntries(rest.map((h, i) => [h, i === 0 ? 'maintainer' : 'member'] as const)),
    }
  })

  // teams: everyone in at least one; a few groups part of a team, or asked to review its ideas
  const teams: TeamSeed[] = TEAMS.map((t) => {
    const [admin, ...rest] = some(handles, t.size)
    return {
      handle: t.handle,
      name: t.name,
      description: t.description,
      admin: admin!,
      members: Object.fromEntries(rest.map((h, i) => [h, i < 2 ? 'maintainer' : 'member'] as const)),
      ...(t.handle === 'infra' ? { groups: { 'on-call': 'member' as const } } : {}),
      ...(t.handle === 'web' ? { groups: { accessibility: 'member' as const } } : {}),
      ...(t.handle === 'growth' ? { sharedWith: ['managers'] } : {}),
      // some teams work in the open, as many companies' do: their new ideas are everyone's to read
      ...(t.handle === 'web' || t.handle === 'data' || t.handle === 'growth' ? { public: true } : {}),
      requirements:
        t.handle === 'payments'
          ? { approvals: 1, anyOf: ['legal', 'privacy'], resolved: true }
          : t.handle === 'discovery' || t.handle === 'data'
            ? { approvals: 1, anyOf: ['api-review'], resolved: false }
            : { approvals: t.size > 15 ? 1 : 0, resolved: false },
    }
  })
  // the site admin, who test-ui.sh says to sign in as, is in a few of them, as someone would be
  for (const t of teams.filter((t) => ['infra', 'payments', 'discovery'].includes(t.handle))) {
    t.members[small.people[0]!.handle] = 'member'
  }
  const membersOf = (t: TeamSeed) => [t.admin, ...Object.keys(t.members)]

  // ideas: about one for every one and a fifth people in a team, at every stage, most with a remark or two
  const ideas: IdeaSeed[] = []
  for (const [i, t] of TEAMS.entries()) {
    const team = teams[i]!
    const members = membersOf(team)
    const titles = new Set<string>()
    const count = Math.round(t.size / 1.2)
    while (titles.size < count) {
      titles.add(`${pick(VERBS)} ${pick(t.topics)}`)
    }
    for (const title of titles) {
      ideas.push(generated(title, team, members))
    }
  }
  // and a few people's own, shared with a colleague or two
  for (const by of some(handles, 8)) {
    ideas.push({
      ...generated(`Notes: ${pick(VERBS).toLowerCase()} ${pick(pick(TEAMS).topics)}`, undefined, [by]),
      share: some(
        handles.filter((h) => h !== by),
        2,
      ).map((h) => ({ to: `@${h}` })),
    })
  }

  function generated(title: string, team: TeamSeed | undefined, members: string[]): IdeaSeed {
    const [by, ...others] = some(members, members.length)
    const problem = pick(PROBLEMS)
    const proposal = pick(PROPOSALS)
    const stage = next()
    const remarks = stage < 0.4 ? 0 : stage < 0.7 ? 1 : 2 + Math.floor(next() * 2)
    const review = team !== undefined && stage > 0.3
    const closed = review && next() < 0.3
    const approved = review && others.length > 0 && next() < 0.6
    // accepted only where its team's requirements would let it close so; rejected otherwise
    const rules = team?.requirements
    const acceptable = !rules?.anyOf && (rules?.approvals ?? 0) <= (approved ? 1 : 0) && next() < 0.75
    return {
      by: by!,
      ...(team ? { team: team.handle } : {}),
      title,
      description: problem,
      ...(review ? { review: true } : {}),
      files: {
        [`${title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')}.md`]: `# ${title}

## Problem

${problem}

## Proposal

${proposal} ${pick(PROPOSALS)}

## Risks

${pick(RISKS)}
`,
      },
      discussion: others.slice(0, remarks).map((who, n) => ({
        by: who,
        // the first on a sentence of the proposal, the rest on the whole file
        ...(n === 0 ? { on: proposal.split(/[,.]/)[0]! } : {}),
        body: pick(REMARKS),
        ...(next() < 0.4 ? { replies: [{ by: by!, body: pick(REPLIES) }] } : {}),
        ...(closed ? { resolved: true } : {}),
      })),
      ...(approved ? { reviews: [{ by: others.at(-1)!, verdict: 'approve' as const }] } : {}),
      ...(closed ? { ends: { close: acceptable ? ('accepted' as const) : ('rejected' as const) } } : {}),
    }
  }

  // a few asking to join a team or group they're not in
  const joinRequests = some(handles, 6).flatMap((by, i) => {
    const outside: Data['joinRequests'] =
      i % 2 === 0
        ? teams.filter((t) => !membersOf(t).includes(by)).map((t) => ({ by, team: t.handle }))
        : groups.filter((g) => g.admin !== by && !(by in g.members)).map((g) => ({ by, group: g.handle }))
    return outside.length > 0 ? [pick(outside)] : []
  })

  return {
    people: [...small.people, ...people],
    groups: [...small.groups, ...groups],
    teams: [...small.teams, ...teams],
    joinRequests: [...small.joinRequests, ...joinRequests],
    ideas: [...small.ideas, ...ideas],
  }
}
