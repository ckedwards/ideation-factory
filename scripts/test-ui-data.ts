// The sample data scripts/test-ui.sh seed loads: a small organization a few weeks into using
// Ideation Factory. Thirteen people in four teams and three groups (one of them part of a team),
// and twenty-three ideas at every stage, from private notes to closed, with discussions, suggested
// edits, reviews and a join request or two: among them one with five versions by two people, a
// handbook page with eighteen threads, and the Comments team's five, made for trying out comments
// (scripts/test-ui-comments.ts). scripts/test-ui-medium.ts grows it into a medium-sized
// company. Everyone's email is @example.com, which Mailpit
// catches, so anyone can be signed in as.
import type { Verdict } from '@ideaf/api'
import { commentIdeas, commentsTeam } from './test-ui-comments.ts'

export interface PersonSeed {
  handle: string
  name: string
  email: string
}

/** `riley` is the site admin, admin@example.com: who test-ui.sh says to sign in as. */
export const people: PersonSeed[] = [
  { handle: 'riley', name: 'Riley Chen', email: 'admin@example.com' },
  { handle: 'maya', name: 'Maya Patel', email: 'maya@example.com' },
  { handle: 'sam', name: 'Sam Okafor', email: 'sam@example.com' },
  { handle: 'devon', name: 'Devon Brooks', email: 'devon@example.com' },
  { handle: 'ben', name: 'Ben Fischer', email: 'ben@example.com' },
  { handle: 'kai', name: 'Kai Nakamura', email: 'kai@example.com' },
  { handle: 'priya', name: 'Priya Natarajan', email: 'priya@example.com' },
  { handle: 'jordan', name: 'Jordan Lee', email: 'jordan@example.com' },
  { handle: 'alex', name: 'Alex Romero', email: 'alex@example.com' },
  { handle: 'zoe', name: 'Zoe Martin', email: 'zoe@example.com' },
  { handle: 'noor', name: 'Noor Haddad', email: 'noor@example.com' },
  { handle: 'lena', name: 'Lena Kowalski', email: 'lena@example.com' },
  { handle: 'tomas', name: 'Tomás Silva', email: 'tomas@example.com' },
]

type Role = 'member' | 'maintainer' | 'admin'

export interface GroupSeed {
  handle: string
  name: string
  description: string
  /** Its first admin, who makes it. */
  admin: string
  members: Record<string, Role>
}

export const groups: GroupSeed[] = [
  {
    handle: 'security',
    name: 'Security',
    description: 'Reviews anything that touches sign-in, data or secrets.',
    admin: 'sam',
    members: { ben: 'member', kai: 'maintainer' },
  },
  {
    handle: 'design',
    name: 'Design',
    description: 'Product and interaction design.',
    admin: 'lena',
    members: { tomas: 'member', noor: 'member' },
  },
  {
    handle: 'leads',
    name: 'Leads',
    description: 'Engineering and product leads.',
    admin: 'riley',
    members: { priya: 'member', noor: 'member' },
  },
  {
    handle: 'pager',
    name: 'Pager',
    description: 'Who carries the pager this month.',
    admin: 'devon',
    // riley is taken out at the end (lastChanges); it reviews nothing, so being in it changes nothing else
    members: { sam: 'member', riley: 'member' },
  },
]

export interface TeamSeed {
  handle: string
  name: string
  description: string
  /** Its first admin, who makes it. */
  admin: string
  members: Record<string, Role>
  /** Groups that are part of it, and their role. */
  groups?: Record<string, 'member' | 'maintainer'>
  /** The groups its new ideas are shared with, to view, without their joining it. */
  sharedWith?: string[]
  /** Its new ideas can be seen by everyone, not only its members. */
  public?: boolean
  requirements: {
    approvals: number
    /** One approval from any of these groups, which are asked to review. */
    anyOf?: string[]
    resolved: boolean
  }
}

export const teams: TeamSeed[] = [
  {
    handle: 'platform',
    name: 'Platform',
    description: 'APIs, jobs, data and the infrastructure under them.',
    admin: 'riley',
    members: { maya: 'maintainer', sam: 'member', devon: 'member', ben: 'member', kai: 'member' },
    // Security leaves at the end (lastChanges)
    groups: { security: 'member' },
    requirements: { approvals: 1, anyOf: ['security'], resolved: false },
  },
  {
    handle: 'mobile',
    name: 'Mobile',
    description: 'The field app, on iOS and Android.',
    admin: 'priya',
    members: { jordan: 'maintainer', zoe: 'member', alex: 'member', riley: 'member' },
    groups: { design: 'member' },
    requirements: { approvals: 1, resolved: true },
  },
  {
    handle: 'product',
    name: 'Product',
    description: 'What we build next, and why.',
    admin: 'noor',
    members: { maya: 'member', lena: 'member', tomas: 'member' },
    sharedWith: ['leads'],
    requirements: { approvals: 0, resolved: false },
  },
  commentsTeam,
]

/**
 * Made last, once everyone's notices from the setup are read: a change of each kind that gives riley an
 * unread notice about her teams and groups.
 */
export const lastChanges: Array<
  | { by: string; groupJoins: { team: string; group: string } }
  | { by: string; groupLeaves: { team: string; group: string } }
  | { by: string; adds: { team?: string; group?: string; person: string } }
  | { by: string; removes: { team?: string; group?: string; person: string } }
> = [
  // to riley as Leads's admin
  { by: 'noor', groupJoins: { team: 'product', group: 'leads' } },
  // to riley as Platform's admin
  { by: 'sam', groupLeaves: { team: 'platform', group: 'security' } },
  // to riley, about her
  { by: 'noor', adds: { team: 'product', person: 'riley' } },
  { by: 'devon', removes: { group: 'pager', person: 'riley' } },
]

/** People asking to join, for their admins to decide. */
export const joinRequests: Array<{ by: string; team?: string; group?: string }> = [
  { by: 'alex', team: 'platform' },
  { by: 'zoe', group: 'design' },
]

export interface Remark {
  by: string
  body: string
}

export interface Discussion extends Remark {
  /**
   * What it's about, in `file` (the idea's first file unless named): some text (`on`), a section by its
   * heading's words, or a block by words it has; the whole file without any of them.
   */
  on?: string
  section?: string
  block?: string
  file?: string
  /** A suggested edit: what replaces `on`. */
  suggest?: string
  /** The suggestion, accepted by the idea's author. */
  accepted?: boolean
  /** Part of a review not submitted yet: only its author sees it. */
  pending?: boolean
  replies?: Remark[]
  resolved?: boolean
}

export interface IdeaSeed {
  by: string
  team?: string
  title: string
  /** A sentence about it, which lists show. */
  description?: string
  /** Its files, by path: the first is where comments go unless they name another. */
  files: Record<string, string>
  /** Sent for review when it's made; a draft otherwise. */
  review?: boolean
  /** Who else has access: @person or group:handle (view unless edit), or everyone. */
  share?: Array<{ to: string; edit?: boolean }>
  /** Asked to review it: @person or group:handle. */
  reviewers?: string[]
  discussion?: Discussion[]
  /**
   * New versions, in order, after the discussion: each [old, new] replaced once, by its author unless
   * `by` names someone else who can edit it.
   */
  versions?: Array<{ by?: string; changes: Array<[string, string]> }>
  reviews?: Array<{ by: string; verdict: Verdict; body?: string }>
  /** Where it ends up. */
  ends?: { status: 'changes-in-progress'; note: string } | { close: 'accepted' | 'rejected'; note?: string }
}

export const ideas: IdeaSeed[] = [
  {
    by: 'devon',
    team: 'platform',
    title: 'Move background jobs to a queue',
    description: 'Stop jobs running twice by moving them from a timer on every node to a queue.',
    review: true,
    files: {
      'jobs-queue.md': `# Move background jobs to a queue

## Problem

Background work runs on a timer inside each web node: every minute, each node scans the jobs table for work that is due. With six nodes, the scan runs six times a minute, and two nodes regularly pick up the same job. Last month that sent 312 customers a duplicate invoice email.

## Proposal

Put jobs on a queue, with one consumer group per job type. A node takes a job by leasing it for five minutes, and a job that isn't finished by then goes back on the queue.

- Invoice emails, exports and webhooks move first, as they're the ones that hurt when they run twice.
- The jobs table stays as the record of what ran, but nothing scans it.
- Each job carries an idempotency key, so a job that does run twice does no harm.

## Alternatives

A lock row per job would stop the duplicates, but the scan would still run on every node. A managed scheduler would work, but it's another service to run for a problem the queue already solves.

## Rollout

Behind a flag per job type, moving one type a week, watching the duplicate count on the jobs dashboard.
`,
    },
    discussion: [
      {
        by: 'sam',
        on: 'leasing it for five minutes',
        body: 'What happens to a job that takes longer than five minutes? Exports of large accounts can take twenty.',
        replies: [
          {
            by: 'devon',
            body: 'Good catch. The consumer renews the lease every minute while it works, so only a node that dies lets a job go.',
          },
          { by: 'sam', body: 'That works for me.' },
        ],
        resolved: true,
      },
      {
        by: 'maya',
        on: 'moving one type a week',
        suggest: 'moving one type every two weeks',
        body: "A week isn't long enough to see the monthly invoice run.",
        accepted: true,
      },
      {
        by: 'ben',
        body: 'Can we write down what the queue keeps, and for how long? Job payloads include customer emails.',
      },
    ],
    reviews: [
      { by: 'maya', verdict: 'approve', body: 'Looks good once the retention question is answered.' },
      {
        by: 'sam',
        verdict: 'request-changes',
        body: 'How long job payloads are kept needs an answer before this goes ahead.',
      },
    ],
  },
  {
    by: 'maya',
    team: 'platform',
    title: 'Rate limit the public API per token',
    description: 'A limit per token, so one leaked token or busy script can\u2019t use up everyone\u2019s.',
    review: true,
    files: {
      'rate-limits.md': `# Rate limit the public API per token

## Problem

The public API's only limit is per address, at 600 requests a minute. Customers behind one proxy share it, and a single script with a leaked token can still use all of it.

## Proposal

Limit each token to 300 requests a minute, with a burst of 50, and answer over the limit with 429 and a Retry-After header. The limit per address stays as a backstop.

## Rollout

Log what the limit would have refused for two weeks, then turn it on. The owners of tokens that would have been limited get an email a week before.
`,
    },
    discussion: [
      {
        by: 'kai',
        on: 'a burst of 50',
        body: 'Our own CLI makes 80 calls on a cold sync. Can the burst be 100?',
        replies: [{ by: 'maya', body: 'Changed to 100.' }],
        resolved: true,
      },
    ],
    versions: [{ changes: [['a burst of 50', 'a burst of 100']] }],
    reviews: [
      { by: 'riley', verdict: 'approve' },
      { by: 'sam', verdict: 'approve', body: 'Retry-After makes this easy for clients to handle well.' },
    ],
    ends: { close: 'accepted', note: 'Shipping in the next release.' },
  },
  {
    by: 'kai',
    team: 'platform',
    title: 'Retire the v1 webhooks',
    description: 'Who still uses v1, and how to move them to v2.',
    files: {
      'retire-v1-webhooks.md': `# Retire the v1 webhooks

Notes so far, not ready for review.

- 41 customers still use v1; 9 of them had a delivery in the last month.
- v2 signs every payload and v1 doesn't, which is the main reason to retire it.
- Open question: do we move their endpoints to v2 for them, or ask them to?
`,
    },
  },
  {
    by: 'ben',
    team: 'platform',
    title: 'Structured logging with request IDs',
    description: 'JSON logs with an ID that follows each request through every service.',
    review: true,
    files: {
      'logging.md': `# Structured logging with request IDs

## Problem

Logs are plain text, and following one request across the API, the job runner and the mailer means searching by timestamp.

## Proposal

Log JSON lines with a request ID that every service passes on in a header, and keep the plain text format for local development.

## Fields

| Field | Example |
| --- | --- |
| time | 2026-11-12T09:14:03Z |
| level | info |
| request | req_8f2a91 |
| message | invoice sent |
`,
    },
    discussion: [
      {
        by: 'devon',
        on: 'keep the plain text format for local development',
        body: 'Why keep two formats? Pretty-printing the JSON locally would be one less thing to maintain.',
        replies: [{ by: 'ben', body: "Fair. I'll switch to one format." }],
      },
    ],
    reviews: [
      { by: 'riley', verdict: 'request-changes', body: 'Agree with Devon: one format, pretty-printed locally.' },
    ],
    ends: { status: 'changes-in-progress', note: 'Switching to one format.' },
  },
  {
    by: 'sam',
    team: 'platform',
    title: 'Threat model for single sign-on',
    description: 'What could go wrong with single sign-on, and what we do about it.',
    review: true,
    share: [{ to: 'group:security', edit: true }],
    files: {
      'sso-threat-model.md': `# Threat model for single sign-on

## Assets

Sessions, the identity provider's signing certificate, and the link from the provider's subject to our accounts.

## Threats

1. A stolen session cookie is used from another machine.
2. The provider's certificate rotates and sign-in fails for everyone.
3. Someone changes their email at the provider to take over another account.

## Mitigations

1. Sessions are bound to a device, and expire after 12 hours of inactivity.
2. We fetch the provider's metadata daily, and alert a week before a certificate expires.
3. Accounts are matched on the provider's subject, never on email.
`,
    },
    discussion: [
      {
        by: 'kai',
        on: '12 hours of inactivity',
        body: "Should this match the provider's own session length? Ours is 8 hours.",
        replies: [{ by: 'sam', body: "Matching it makes sense. I'll check what customers' providers use." }],
      },
    ],
    reviews: [{ by: 'ben', verdict: 'approve' }],
  },
  {
    by: 'riley',
    team: 'platform',
    title: 'Postgres read replicas for reporting',
    description: 'Take the monthly reporting load off the primary database.',
    review: true,
    files: {
      'read-replicas.md': `# Postgres read replicas for reporting

## Problem

The reporting queries run against the primary database, and slow everything else down at the start of each month.

## Proposal

Add a read replica, and point the reporting service at it.

## Cost

About $900 a month, for a replica the size of the primary.
`,
    },
    discussion: [
      {
        by: 'maya',
        body: 'Most of the slow queries are the three monthly summaries. Could we work those out nightly instead?',
        replies: [{ by: 'riley', body: "That removes most of the load for far less. Let's do that first." }],
        resolved: true,
      },
    ],
    ends: { close: 'rejected', note: "Working out the monthly summaries nightly instead: see Maya's comment." },
  },
  {
    by: 'priya',
    team: 'mobile',
    title: 'Offline mode for the field app',
    description: 'Save inspections on the device first, so a lost signal loses nothing.',
    review: true,
    reviewers: ['group:design'],
    files: {
      'offline.md': `# Offline mode for the field app

## Why

Field teams lose signal in basements and on rural sites, and today the app shows a spinner and loses whatever they typed. Support logged 57 tickets about lost inspection notes last quarter.

## What changes

- Inspections, notes and photos are saved on the device first, and sent when there's a connection.
- A banner says the app is offline, and how many changes are waiting.
- Conflicts, when someone else changed the same inspection, are shown side by side, and the person chooses.

## Not in scope

Starting a new site visit offline: it needs the schedule from the server.
`,
      'sync-states.md': `# Sync states

Each change on the device is in one of these states.

| State | Meaning |
| --- | --- |
| saved | on the device only |
| sending | being sent now |
| sent | the server has it |
| conflict | someone else changed it first |

A change stays on the device until the server confirms it, so closing the app while sending loses nothing.
`,
    },
    discussion: [
      {
        by: 'zoe',
        on: 'Conflicts, when someone else changed the same inspection',
        body: 'How often does that happen? Two people rarely inspect the same site on the same day.',
        replies: [
          { by: 'priya', body: "Rarely, but when it does it's the worst case: someone's notes silently disappear." },
          {
            by: 'jordan',
            body: 'Agree we need it. Could we start with the last change winning, plus a warning, and do side by side later?',
          },
        ],
      },
      {
        by: 'tomas',
        on: 'A banner says the app is offline',
        body: "Let's use the same banner as the web app's connection notice, so it looks familiar.",
      },
      {
        by: 'zoe',
        file: 'sync-states.md',
        body: 'Photos are big. Is there a limit to how much can wait on the device?',
      },
      {
        by: 'riley',
        on: 'Starting a new site visit offline',
        body: 'Could the schedule for the next week be kept on the device, so this works too?',
        pending: true,
      },
    ],
    reviews: [{ by: 'jordan', verdict: 'approve', body: 'Approve, with the last change winning to start.' }],
  },
  {
    by: 'alex',
    team: 'mobile',
    title: 'Push notification preferences',
    description: 'Fewer pushes, so people stop turning them all off.',
    files: {
      'push-preferences.md': `# Push notification preferences

## Problem

The app sends a push notification for every comment, so people turn notifications off altogether.

## Proposal

Three levels, the same as email: everything, only mentions and replies, and nothing. New installs start at only mentions and replies.
`,
    },
  },
  {
    by: 'zoe',
    team: 'mobile',
    title: 'Dark mode',
    description: 'Follow the phone\u2019s theme, using the web app\u2019s design tokens.',
    review: true,
    files: {
      'dark-mode.md': `# Dark mode

Follow the phone's setting, with an override in Settings. Colors come from the design tokens the web app already uses, so the two stay in step.

## Checks

- Every screen meets contrast AA in both themes.
- Photos and maps aren't inverted.
`,
    },
    discussion: [
      {
        by: 'lena',
        on: "Photos and maps aren't inverted.",
        body: 'Maps have a dark style of their own; worth using it.',
        replies: [{ by: 'zoe', body: 'Using it.' }],
        resolved: true,
      },
    ],
    reviews: [{ by: 'priya', verdict: 'approve' }],
    ends: { close: 'accepted' },
  },
  {
    by: 'jordan',
    team: 'mobile',
    title: 'Crash reporting with symbol upload',
    description: 'Readable stack traces in crash reports, without personal data.',
    review: true,
    reviewers: ['@riley'],
    files: {
      'crash-reporting.md': `# Crash reporting with symbol upload

Crash reports from the app arrive without symbols, so their stack traces are addresses. Upload the symbol files from each release build, so reports name the function and line.

- Symbols are uploaded by the release pipeline, never by hand.
- Reports keep no personal data: no names, no emails, no notes.
`,
    },
    discussion: [
      {
        by: 'riley',
        on: 'no names, no emails, no notes',
        suggest: 'no names, emails, notes or photos',
        body: "Photos too: they often show people's faces.",
      },
    ],
  },
  {
    by: 'noor',
    team: 'product',
    title: 'Onboarding revamp',
    description: 'End a new account\u2019s first week with a team, not a single user.',
    review: true,
    reviewers: ['group:design'],
    files: {
      'plan.md': `# Onboarding revamp

## Goal

Half of new accounts never invite a second person, and those accounts almost never become customers. The first week should end with a team, not a single user.

## Changes

1. Ask for teammates' emails in the second step, not in settings.
2. Start every account with a sample project that shows comments and reviews.
3. Send a short email on day three with what the team did so far.

## Measure

The share of new accounts with two or more active people after seven days, 48% today.
`,
      'research.md': `# Research notes

Interviews with 12 accounts that signed up in September.

- 9 of 12 didn't know they could invite people before the trial ended.
- 5 of 12 said the empty first screen made it hard to see what the product does.
- Two people asked for a way to import from spreadsheets.
`,
    },
    discussion: [
      {
        by: 'maya',
        on: 'Start every account with a sample project',
        body: 'A sample project is great, but please make it easy to delete. Old trials had samples nobody could get rid of.',
        replies: [{ by: 'noor', body: "It'll have a Delete sample button at the top." }],
        resolved: true,
      },
      {
        by: 'tomas',
        file: 'research.md',
        on: 'the empty first screen made it hard to see what the product does',
        body: 'This matches what we saw in the usability tests in October.',
      },
      { by: 'priya', on: 'on day three', body: 'Day three feels early for a summary. Day five?' },
    ],
    reviews: [{ by: 'lena', verdict: 'approve' }],
  },
  {
    by: 'tomas',
    team: 'product',
    title: 'Pricing page experiment',
    description: 'Does showing yearly prices first sell more yearly plans?',
    files: {
      'pricing-experiment.md': `# Pricing page experiment

Show yearly prices first, with the monthly price underneath, for half of visitors for four weeks. Success is more yearly plans without fewer sign-ups.
`,
    },
  },
  {
    by: 'lena',
    team: 'product',
    title: 'Customer advisory board',
    description: 'Eight customers, every quarter, to hear what they need.',
    review: true,
    files: {
      'advisory-board.md': `# Customer advisory board

Meet eight customers every quarter, to show what we're planning and hear what they need. Members serve a year, and half of them change each year.
`,
    },
    reviews: [{ by: 'noor', verdict: 'approve', body: 'Let’s start in January.' }],
    ends: { close: 'accepted', note: 'First meeting in January.' },
  },
  {
    by: 'riley',
    title: 'Notes on the 2027 roadmap',
    description: 'Rough notes for the planning offsite.',
    share: [{ to: '@priya', edit: true }, { to: '@noor' }],
    files: {
      'roadmap-2027.md': `# Notes on the 2027 roadmap

Rough notes before the planning offsite.

- Reliability first: the job queue and backups.
- Offline mode is the feature field teams ask for most.
- Hire two engineers for Platform, and one designer.
`,
    },
    discussion: [{ by: 'priya', on: 'and one designer', body: 'Can we make it two? Mobile and web both need one.' }],
  },
  {
    by: 'maya',
    title: 'Engineering reading group',
    description: 'One paper or chapter every other Thursday.',
    review: true,
    share: [{ to: 'everyone' }],
    files: {
      'reading-group.md': `# Engineering reading group

An hour every other Thursday, reading one paper or chapter and talking about it. First up is the Dynamo paper, then chapters from Designing Data-Intensive Applications.

Anyone can join, and there's no preparation beyond the reading.
`,
    },
    discussion: [
      {
        by: 'kai',
        body: "I'm in. Can we record the sessions, for people in other time zones?",
        replies: [
          { by: 'maya', body: "We'll take notes and add them here; recordings tend to go unwatched." },
          { by: 'alex', body: 'Count me in too.' },
          // taking part: maya's ideas, a section of riley's inbox grouped by team
          { by: 'riley', body: "I'll come for the Dynamo paper." },
          { by: 'maya', body: 'Thursday at four, then. I’ll send the paper round.' },
        ],
      },
    ],
  },
  {
    // someone else's own idea, outside any team: alex's ideas, a section of riley's inbox grouped by team
    by: 'alex',
    title: 'Offline maps for site visits',
    description: 'Download the day’s maps before a technician sets off.',
    review: true,
    reviewers: ['@riley'],
    files: {
      'offline-maps.md': `# Offline maps for site visits

Technicians lose signal on site, and the map goes with it. The app could download the maps around the day's jobs each morning, over Wi-Fi, before anyone leaves.

## Size

A city's tiles at street level come to about 80 MB. Only the areas around the day's jobs are needed, a few megabytes each.
`,
    },
    discussion: [
      { by: 'alex', on: 'over Wi-Fi', body: 'Riley, does this fit with the offline sync work, or is it separate?' },
    ],
  },
  {
    by: 'kai',
    title: 'Spike: a faster build cache',
    description: 'Can a remote cache take minutes off every CI run?',
    files: {
      'build-cache.md': `# Spike: a faster build cache

CI spends about four minutes of every run restoring the cache. Try a remote cache keyed by each package's inputs, and measure a week of runs against today's.
`,
    },
  },
  // five versions, from two people: the version list, comparing any two, and comments outdated along the way
  {
    by: 'sam',
    team: 'platform',
    title: 'Incident reviews within a week',
    description: 'A short written review after every incident that paged someone, within a week.',
    review: true,
    files: {
      'incident-reviews.md': `# Incident reviews within a week

## Why

We had nine incidents last quarter and wrote up two of them. The same expired certificate took the API down twice.

## What we do

After any incident that paged someone, the person on call writes a review within two weeks. It says what happened, when we noticed, and what we change so it doesn't happen again.

## Who reads them

The team that owns the service reads the review in its next planning meeting.
`,
    },
    discussion: [
      {
        by: 'maya',
        on: 'within two weeks',
        body: 'Two weeks is long enough that people forget the details. A week?',
        replies: [{ by: 'sam', body: 'Agreed, a week.' }],
        resolved: true,
      },
      {
        by: 'devon',
        on: 'the person on call writes a review',
        body: 'The person on call is the most tired person in the building. Could whoever leads the incident write it?',
      },
    ],
    versions: [
      { changes: [['within two weeks', 'within a week']] },
      {
        changes: [
          ['the person on call writes a review', 'whoever led the incident writes a review'],
          [
            "and what we change so it doesn't happen again.",
            "and what we change so it doesn't happen again. It never names who made a mistake: it says what made the mistake easy.",
          ],
        ],
      },
      {
        by: 'maya',
        changes: [
          [
            'The team that owns the service reads the review in its next planning meeting.',
            'The team that owns the service reads the review in its next planning meeting, and the changes it lists go into that planning like any other work.',
          ],
        ],
      },
      {
        changes: [
          [
            '## Who reads them',
            '## Template\n\nWhat happened, in order, with times. How we noticed. What made it worse. What we change, with an owner and a date.\n\n## Who reads them',
          ],
        ],
      },
    ],
    reviews: [{ by: 'kai', verdict: 'approve', body: 'The template makes this much easier to start.' }],
  },
  // a busy discussion: many threads, replies, resolved and open, a suggestion or two
  busyIdea(),
  ...commentIdeas(),
]

/** The handbook page everyone had an opinion on: eighteen threads across its sections. */
function busyIdea(): IdeaSeed {
  const said: Array<[string, string, string, Array<[string, string]>, boolean?]> = [
    [
      'kai',
      'one week in six',
      'Is that across the whole company, or per team?',
      [['riley', 'Per team: each team has its own rotation.']],
      true,
    ],
    [
      'maya',
      'one week in six',
      'Teams of four would be on call one week in four. Should we say what happens then?',
      [
        ['riley', 'Yes: borrow from another team. Adding a line.'],
        ['sam', 'Platform does this already and it works.'],
      ],
    ],
    [
      'devon',
      'within five minutes',
      'Five minutes at 3am is tight. Fifteen?',
      [
        ['riley', 'Fifteen to acknowledge, thirty to start working on it.'],
        ['ben', 'Fifteen sounds right.'],
        ['kai', '+1'],
      ],
      true,
    ],
    [
      'zoe',
      'A laptop and a phone',
      'Does the company pay for the phone?',
      [['riley', 'A stipend, yes. Linking the expense policy.']],
    ],
    [
      'alex',
      'the next working day off',
      'Only if you were paged, or every week on call?',
      [
        ['riley', 'Only if you were paged after midnight.'],
        ['alex', 'Thanks, that should be in the text.'],
      ],
    ],
    [
      'sam',
      'hand over on Monday',
      'Monday mornings are full of meetings. Tuesday?',
      [
        ['jordan', 'Monday works better for Mobile: releases go out on Tuesday.'],
        ['sam', 'Fair. Monday it is.'],
      ],
      true,
    ],
    ['priya', 'a written handover', 'A template would help; the last few handovers were a sentence each.', []],
    [
      'ben',
      'paged more than three times',
      'Three times a night, or a week?',
      [['riley', 'A night. Clarifying.']],
      true,
    ],
    [
      'lena',
      'escalates to the team lead',
      'And if the team lead is the one on call?',
      [['riley', 'Then their manager. Good catch.']],
    ],
    [
      'tomas',
      'the runbook',
      'Which runbook? We have three.',
      [
        ['sam', "The one in the service's repository. The wiki ones are out of date."],
        ['tomas', 'Can we delete the wiki ones, then?'],
        ['sam', 'On it.'],
      ],
      true,
    ],
    [
      'noor',
      'Customers are told',
      'Who tells them? Support, or whoever is on call?',
      [['riley', 'Support, from what the person on call posts in the incident channel.']],
    ],
    ['jordan', 'status page', 'The status page needs an owner. Today nobody updates it.', []],
    [
      'kai',
      'a quiet week',
      'Is "quiet" fewer than three pages?',
      [
        ['maya', 'I read it as no pages at all.'],
        ['riley', 'Fewer than three. Making that explicit.'],
      ],
      true,
    ],
    [
      'devon',
      'swap with anyone',
      'Anyone in the company, or anyone on the rotation?',
      [['riley', 'Anyone on the rotation.']],
      true,
    ],
    ['maya', 'reviewed every quarter', 'Who reviews it?', []],
    [
      'zoe',
      'New joiners shadow',
      'For how long?',
      [
        ['riley', 'Two rotations.'],
        ['zoe', 'Two seems right.'],
      ],
    ],
    [
      'sam',
      'alerts that page',
      "Every alert that pages should have a runbook link. Ours mostly don't.",
      [['ben', 'I can add a check for that.']],
    ],
    ['alex', 'The rotation is in', 'Which calendar? Mobile uses a different tool.', []],
  ]
  return {
    by: 'riley',
    title: 'Handbook: being on call',
    // the whole company's to read and discuss
    share: [{ to: 'everyone' }],
    description: 'How on call works for every team: the rotation, what to do when paged, and what you get for it.',
    review: true,
    files: {
      'on-call.md': `# Being on call

## The rotation

Each person is on call one week in six. You hand over on Monday morning, with a written handover. The rotation is in the shared calendar, and you can swap with anyone, as long as the calendar says so.

## When you're paged

Acknowledge within five minutes, and start working on it within fifteen. Follow the runbook for the alert. If you're paged more than three times, or you're stuck, it escalates to the team lead.

## Talking to customers

Customers are told within thirty minutes of an outage, on the status page and by email for the larger accounts.

## What you need

A laptop and a phone, with you, the whole week.

## What you get

A day's extra pay for each week on call, and the next working day off after a night you were paged. After a quiet week, nothing changes: that's the goal.

## New joiners

New joiners shadow before they're on call themselves. The rotation, and the alerts that page, are reviewed every quarter.
`,
    },
    discussion: said.map(([by, on, body, replies, resolved]) => ({
      by,
      on,
      body,
      replies: replies.map(([who, text]) => ({ by: who, body: text })),
      ...(resolved ? { resolved: true } : {}),
    })),
  }
}
