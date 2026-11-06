// Example data for the stories: the people, teams and groups from the
// prototypes, plus the awkward cases (long names, inactive people, crowds).
import type { Person } from '../people/person.ts'
import type { Actor } from '../people/ActorLabel.tsx'
import type { IdeaInfo, RequirementCheck } from '../ideas/idea.ts'

// "Now" in every story (see .storybook/preview.tsx), so times read the same
export const NOW = Date.parse('2026-10-24T15:00:00Z')
const hoursAgo = (hours: number) => NOW - hours * 3_600_000

export const riley: Person = { id: 'u-riley', name: 'Riley Park', handle: 'riley' }
export const maya: Person = { id: 'u-maya', name: 'Maya Ortiz', handle: 'maya' }
export const devon: Person = { id: 'u-devon', name: 'Devon Fox', handle: 'dfox' }
export const sam: Person = { id: 'u-sam', name: 'Sam Achebe', handle: 'sam' }
export const priya: Person = { id: 'u-priya', name: 'Priya Raman', handle: 'priya' }
export const jonas: Person = { id: 'u-jonas', name: 'Jonas Weber', handle: 'jweber', inactive: true }
export const longName: Person = {
  id: 'u-long',
  name: 'Maximiliana Alexandra Bartholomew-Featherstonehaugh',
  handle: 'maximiliana.featherstonehaugh',
}

// A picture, inline so the stories need no network
export const withPicture: Person = {
  id: 'u-alex',
  name: 'Alex Kim',
  handle: 'alex',
  avatarUrl:
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#3d6b8f"/><circle cx="32" cy="25" r="12" fill="#f2d6b8"/><path d="M10 64c2-14 11-21 22-21s20 7 22 21z" fill="#f2d6b8"/></svg>',
    ),
}

export const everyone: Person[] = [riley, maya, devon, sam, priya, jonas]

// A crowd, for "+N more"
export const crowd: Person[] = Array.from({ length: 40 }, (_, i) => ({
  id: `u-crowd-${i}`,
  name: `${['Ada', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fay', 'Gus', 'Hana'][i % 8]} ${['Lee', 'Moss', 'Noor', 'Okafor', 'Park'][i % 5]}`,
}))

export const actors = {
  person: { kind: 'person', person: riley },
  botForPerson: { kind: 'bot-for-person', bot: 'planbot', person: riley },
  bot: { kind: 'bot', bot: 'archbot' },
  inactivePerson: { kind: 'person', person: jonas },
  botForInactive: { kind: 'bot-for-person', bot: 'typobot', person: jonas },
  longNames: { kind: 'bot-for-person', bot: 'requirements-consistency-checker', person: longName },
} satisfies Record<string, Actor>

export const requirements = {
  oneOfTwo: [
    { text: 'At least 1 approval in total', met: true },
    { text: 'All discussions resolved', met: false, progress: '2 open' },
  ],
  allMet: [
    { text: 'At least 2 approvals in total', met: true },
    { text: 'An approval from Platform team', met: true },
  ],
  broken: [
    { text: 'At least 1 approval in total', met: true },
    { text: 'An approval from Architecture council (deleted)', met: false, broken: true },
  ],
  none: [],
} satisfies Record<string, RequirementCheck[]>

// The offline-sync idea from the prototypes, in review
export const offlineSync: IdeaInfo = {
  id: 'idea-142',
  title: 'Offline-first sync for the field app',
  description: 'Let field technicians keep working without signal, and sync their changes when they reconnect.',
  href: '#ideas/idea-142',
  team: { name: 'Mobile', href: '#teams/mobile' },
  author: riley,
  status: 'requesting review',
  version: 3,
  updatedAt: hoursAgo(5),
  openThreads: 2,
  approvals: [maya],
  reviewers: [
    { kind: 'person', person: maya },
    { kind: 'person', person: devon },
    { kind: 'group', id: 'g-platform', group: { name: 'Platform team' }, href: '#groups/platform' },
  ],
  requirements: requirements.oneOfTwo,
}

export const ideas = {
  inReview: offlineSync,
  requirementsMet: {
    ...offlineSync,
    id: 'idea-143',
    title: 'Retry payments that fail on a timeout',
    description: 'Card payments that time out are retried once, with the same idempotency key.',
    team: { name: 'Payments', href: '#teams/payments' },
    author: maya,
    status: 'approved',
    approvals: [devon, sam],
    openThreads: 0,
    requirements: requirements.allMet,
  },
  brokenRequirements: { ...offlineSync, id: 'idea-144', requirements: requirements.broken },
  noRequirements: {
    ...offlineSync,
    id: 'idea-145',
    title: 'A shared glossary for the docs',
    team: { name: 'Docs', href: '#teams/docs' },
    approvals: [],
    requirements: requirements.none,
  },
  draft: {
    ...offlineSync,
    id: 'idea-146',
    title: 'Dark mode for the field app',
    description: 'Follow the system setting, for technicians working at night.',
    status: 'draft',
    version: 1,
    openThreads: 0,
    approvals: [],
    reviewers: [],
  },
  private: {
    ...offlineSync,
    id: 'idea-147',
    title: 'Notes on our on-call rota',
    description: 'Thinking out loud before I bring this to the team.',
    team: { name: 'Your ideas', personal: true, href: '#teams/me' },
    status: 'draft',
    reviewers: [],
    approvals: [],
  },
  locked: {
    ...offlineSync,
    id: 'idea-148',
    title: 'Rotate the signing keys yearly',
    team: { name: 'Security', locked: true, href: '#teams/security' },
  },
  accepted: {
    ...offlineSync,
    id: 'idea-149',
    status: 'closed',
    closedReason: 'accepted',
    updatedAt: hoursAgo(24 * 9),
  },
  rejected: {
    ...offlineSync,
    id: 'idea-150',
    title: 'Rewrite the app in a new framework',
    status: 'closed',
    closedReason: 'rejected',
    updatedAt: hoursAgo(24 * 60),
  },
  archived: {
    ...offlineSync,
    id: 'idea-151',
    title: 'Quarterly payments report',
    team: { name: 'Payments (2024)', archived: true },
    status: 'changes in progress',
    archived: true,
  },
  inactiveAuthor: { ...offlineSync, id: 'idea-152', author: jonas },
  long: {
    ...offlineSync,
    id: 'idea-153',
    title:
      'Consolidate the notification, inbox and email digest pipelines into one event stream with per-team routing rules',
    description:
      'Today three systems decide who hears about what, and they disagree. This proposes one stream of events, one place where routing rules live, and a migration that runs the old and new side by side until they agree for a month. '.repeat(
        2,
      ),
    team: { name: 'Platform Reliability, Observability and Developer Experience', href: '#teams/platform' },
    author: longName,
    reviewers: [
      ...crowd.slice(0, 6).map((person) => ({ kind: 'person' as const, person })),
      { kind: 'group', id: 'g-arch', group: { name: 'Architecture council' } },
      { kind: 'group', id: 'g-old', group: { name: 'Old review board', deleted: true } },
    ],
  },
} satisfies Record<string, IdeaInfo>

// An uploaded image, inline so the stories need no network: the sync flow, and
// a later version of it with a retry step
const flow = (steps: string[]) =>
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${steps.length * 130} 70"><style>text{font:14px sans-serif}</style>${steps
      .map(
        (step, i) =>
          `<rect x="${i * 130 + 5}" y="15" width="110" height="40" rx="8" fill="#dcebe4" stroke="#2b6b5a"/><text x="${i * 130 + 60}" y="40" text-anchor="middle">${step}</text>`,
      )
      .join('')}</svg>`,
  )
export const syncFlow = {
  v1: flow(['Queue', 'Sync', 'Server']),
  v2: flow(['Queue', 'Sync', 'Retry', 'Server']),
}
