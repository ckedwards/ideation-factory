// PROTOTYPE: canned example data for experiment 1. Not a real data model.

export type User = { id: string; name: string; initials: string }

// Who did something. Mirrors the three token purposes in idea.md:
// "me" -> user, "bot associated with me" -> userbot, "bot" -> bot.
export type Actor =
  | { kind: 'user'; userId: string }
  | { kind: 'userbot'; bot: string; userId: string }
  | { kind: 'bot'; bot: string }

export type IdeaStatus = 'draft' | 'requesting review' | 'changes in progress'

// Images referenced by the idea's markdown, as uploaded by the cli with that
// version. Keyed by repo path. Uploaded images are stored once by content hash;
// anything the cli didn't upload says why. Other media (PDF, video, code) is
// never uploaded: links to it resolve to the repository instead.
export type Media =
  | { status: 'uploaded'; url: string; bytes: number; type: string; hash: string }
  | { status: 'skipped'; reason: string; bytes?: number }

// Deployment-wide settings a site admin chooses (see experiment 2's Site admin
// page): how external images behave, and the largest image the cli uploads.
export type ExternalImages = 'click' | 'always' | 'never'
export const deployment = { externalImages: 'click' as ExternalImages, maxImageMB: 10 }

export type Version = {
  n: number
  author: Actor
  message: string
  at: string
  files: Record<string, string>
  media?: Record<string, Media>
}

export type Anchor =
  | { type: 'selection'; quote: string; section?: string }
  | { type: 'section'; section: string }
  | { type: 'file' }

export type Reply = { id: string; author: Actor; body: string; at: string }

export type Comment = {
  id: string
  file: string
  version: number // version the comment was made on
  anchor: Anchor
  author: Actor
  body: string
  at: string
  status: 'unresolved' | 'resolved'
  replies: Reply[]
  suggestion?: { replacement: string; state: 'open' | 'accepted' | 'rejected' }
}

export type Reviewer =
  | { kind: 'user'; userId: string; lastSeenVersion?: number }
  | { kind: 'group'; name: string; members: string[] }

export const NOW = Date.parse('2026-10-24T15:00:00Z')

export const users: Record<string, User> = {
  riley: { id: 'riley', name: 'Riley Park', initials: 'RP' },
  maya: { id: 'maya', name: 'Maya Ortiz', initials: 'MO' },
  devon: { id: 'devon', name: 'Devon Fox', initials: 'DF' },
  sam: { id: 'sam', name: 'Sam Achebe', initials: 'SA' },
}

// The logged-in user is the idea's author.
export const me = users.riley

const offlineIdea = {
  id: 'idea-142',
  title: 'Offline-first sync for the field app',
  description:
    'Let technicians finish work orders with no signal, and sync in the background when they reconnect.',
  ownerId: 'riley',
  team: 'Mobile',
  repo: 'acme/field-app',
  branch: 'riley/offline-sync',
  target: 'main',
  reviewers: [
    { kind: 'user', userId: 'maya', lastSeenVersion: 3 },
    { kind: 'user', userId: 'devon', lastSeenVersion: 2 },
    { kind: 'group', name: 'Platform team', members: ['sam'] },
  ] as Reviewer[],
}

const offlineStatus: IdeaStatus = 'requesting review'

// Idea-level events that aren't versions or comments (for the feed).
export type Activity = { id: string; at: string; actor: Actor; text: string; kind: 'created' | 'status' | 'review-requested' }

const offlineActivity: Activity[] = [
  { id: 'a1', at: '2026-10-20T16:09:30Z', actor: { kind: 'user', userId: 'riley' }, kind: 'created', text: 'created this idea as a draft' },
  { id: 'a2', at: '2026-10-22T10:08:00Z', actor: { kind: 'user', userId: 'riley' }, kind: 'review-requested', text: 'requested review from Maya Ortiz, Devon Fox and Platform team' },
  { id: 'a3', at: '2026-10-22T10:08:30Z', actor: { kind: 'user', userId: 'riley' }, kind: 'status', text: 'changed the status to Requesting review' },
  { id: 'a4', at: '2026-10-23T09:15:00Z', actor: { kind: 'user', userId: 'riley' }, kind: 'status', text: 'changed the status to Changes in progress' },
  { id: 'a5', at: '2026-10-23T18:42:00Z', actor: { kind: 'user', userId: 'riley' }, kind: 'status', text: 'changed the status to Requesting review' },
]

const FENCE = '```'

const readmeV1 = `# Offline-first sync for the field app

Field technicians spend a surprising part of their day without signal: basements, plant rooms, rural sites. Today the app blocks on every save and shows a spinner until the request finishes.

## Goals

- A technician can complete a full work order with no connectivity.
- Changes sync within 2 minutes of the device reconnecting.

## Rollout

1. Ship behind the \`offline_sync\` flag to internal devices.
2. Default on for everyone.

## Proposal

Every change is written to a local operation log in SQLite. We will reuse the existing REST endpoints unchanged and replay the log against them.
`

const readmeV2 = `# Offline-first sync for the field app

Field technicians spend a surprising part of their day without signal: basements, plant rooms, rural sites. Today the app blocks on every save and shows a spinner until the request finishes. When the request fails, the technician retypes their notes or, more often, writes them on paper and enters them back at the truck.

## Goals

- A technician can complete a full work order with no connectivity.
- Changes sync within 2 minutes of the device reconnecting.
- No silent data loss. When two edits conflict, a person decides.

## Rollout

1. Ship behind the \`offline_sync\` flag to internal devices.
2. Expand to 5% of technicians in one region and watch conflict rates.
3. Default on once the conflict rate stays under 0.5% for two weeks.

## Proposal

![Sync flow sketch](./img/sync-flow.svg)

Every change the technician makes is written to a local operation log in SQLite before it touches the UI. We will reuse the existing REST endpoints unchanged and replay the log against them.

Conflicts are handled per field, not per record. See [conflict resolution](./conflict-resolution.md) for the rules.

## Open questions

- Should photo attachments sync over cellular by default?
`

const readmeV3 = `# Offline-first sync for the field app

![Prototype badge](https://img.shields.io/badge/prototype-offline%20sync-2b6b5a)

Field technicians spend a surprising part of their day without signal: basements, plant rooms, rural sites. Today the app blocks on every save and shows a spinner until the request finishes. When the request fails, the technician retypes their notes or, more often, writes them on paper and enters them back at the truck.

This proposal makes the field app work offline by default and sync in the background.

## Goals

- A technician can complete a full work order with no connectivity.
- Changes sync within 30 seconds of the device reconnecting.
- No silent data loss. When two edits conflict, a person decides.

## Non-goals

- Real-time collaboration between technicians on the same work order.
- Offline support for the admin web console.

## Proposal

![Sync flow sketch](./img/sync-flow.svg)

Every change the technician makes is written to a local operation log in SQLite before it touches the UI. A background worker drains the log to a new \`/sync\` endpoint in batches, and the server replies with the operations other devices made since the last sync.

### Sync endpoint

${FENCE}mermaid
sequenceDiagram
  participant App
  participant Log as Local op log
  participant API as /sync
  App->>Log: append(op)
  Log-->>App: ok (instant)
  Log->>API: POST batch
  API-->>Log: ack + remote ops
${FENCE}

The worker lives in [services/sync/worker.ts](https://github.com/acme/field-app/blob/riley/offline-sync/services/sync/worker.ts), next to its [implementation notes](../../services/sync/NOTES.md).

### Conflicts

Conflicts are handled per field, not per record. See [conflict resolution](./conflict-resolution.md) for the rules.

## Rollout

1. Ship behind the \`offline_sync\` flag to internal devices.
2. Expand to 5% of technicians in one region and watch conflict rates.
3. Default on once the conflict rate stays under 0.5% for two weeks.

Background: the [load test results](../../perf/sync-load-test.pdf) and a [screen recording of the offline demo](./media/offline-demo.mp4).

## Open questions

- Should photo attachments sync over cellular by default?
- How long do we keep the local op log after a successful sync?
`

const conflictV2 = `# Conflict resolution

A conflict happens when two devices change the same field of the same record before either has synced.

## Rules

| Field type | Rule |
|---|---|
| Free text (notes) | Keep both, newest first, and flag for review |
| Status | Last write wins |
| Checklists | Merge per item; an item checked on any device stays checked |
| Photos | Never conflict; both are kept |

## Surfacing conflicts

Flagged work orders show a banner on the technician's device.
`

const conflictV3 = `# Conflict resolution

A conflict happens when two devices change the same field of the same record before either has synced.

## Rules

| Field type | Rule |
|---|---|
| Free text (notes) | Keep both, newest first, and flag for review |
| Status | Server order wins; the losing device gets a notification |
| Checklists | Merge per item; an item checked on any device stays checked |
| Photos | Never conflict; both are kept |

## Surfacing conflicts

Flagged work orders show a banner on the technician's device and appear in the dispatcher's queue. The dispatcher picks a version or edits the merged text.

![Conflict banner on the technician's device](./img/conflict-banner.svg)

## Why not last-write-wins?

Device clocks drift, and a technician who syncs late would silently overwrite a colleage's notes. That breaks our "no silent data loss" goal.
`

const overviewMain = `# Architecture overview

## Clients

The field app is a React Native client that talks to the REST API directly. Every write is a synchronous request.

## Services

- \`api\`: REST API for work orders, customers and assets.
- \`notifications\`: push and SMS delivery.
`

const overviewIdea = `# Architecture overview

![Whiteboard photo from the kickoff](./img/kickoff-whiteboard.jpg)

## Clients

The field app is a React Native client. Writes go to a local operation log and are synced in the background by the sync service.

## Services

- \`api\`: REST API for work orders, customers and assets.
- \`notifications\`: push and SMS delivery.
- \`sync\`: batch sync endpoint and conflict resolution. New, see [offline sync](../offline-sync/README.md).
`

const docsIndex = `# Docs

Start with the [architecture overview](./architecture/overview.md).
`

const syncNotes = `# Sync worker notes

Implementation notes that live next to the code.

- Batch size starts at 50 ops and backs off on 413 responses.
- The worker pauses on a metered connection while photos are queued.
- Retries use exponential backoff, capped at 5 minutes.
`

// What the CLI last reported for the target branch (main).
const offlineTarget: Record<string, string> = {
  'docs/README.md': docsIndex,
  'docs/architecture/overview.md': overviewMain,
}

const WHITEBOARD: Media = { status: 'skipped', reason: `Not uploaded: 14.2 MB is over this deployment’s ${deployment.maxImageMB} MB image limit`, bytes: 14_200_000 }

const offlineVersions: Version[] = [
  {
    n: 1,
    author: { kind: 'user', userId: 'riley' },
    message: 'First draft',
    at: '2026-10-20T16:10:00Z',
    media: { 'docs/architecture/img/kickoff-whiteboard.jpg': WHITEBOARD },
    files: {
      'docs/README.md': docsIndex,
      'docs/architecture/overview.md': overviewIdea,
      'docs/offline-sync/README.md': readmeV1,
    },
  },
  {
    n: 2,
    author: { kind: 'userbot', bot: 'planbot', userId: 'riley' },
    message: 'Add conflict resolution doc, flesh out rollout',
    at: '2026-10-22T10:05:00Z',
    media: {
      'docs/architecture/img/kickoff-whiteboard.jpg': WHITEBOARD,
      'docs/offline-sync/img/sync-flow.svg': { status: 'uploaded', url: '/uploads/sync-flow-v2.svg', bytes: 1370, type: 'image/svg+xml', hash: 'sha256:5e1c…a09f' },
    },
    files: {
      'docs/README.md': docsIndex,
      'docs/architecture/overview.md': overviewIdea,
      'docs/offline-sync/README.md': readmeV2,
      'docs/offline-sync/conflict-resolution.md': conflictV2,
    },
  },
  {
    n: 3,
    author: { kind: 'user', userId: 'riley' },
    message: 'Address review: batch endpoint, non-goals, move rollout, sync notes',
    at: '2026-10-23T18:40:00Z',
    media: {
      'docs/architecture/img/kickoff-whiteboard.jpg': WHITEBOARD,
      'docs/offline-sync/img/sync-flow.svg': { status: 'uploaded', url: '/uploads/sync-flow-v3.svg', bytes: 1856, type: 'image/svg+xml', hash: 'sha256:b77d…31c2' },
      'docs/offline-sync/img/conflict-banner.svg': { status: 'uploaded', url: '/uploads/conflict-banner.svg', bytes: 1347, type: 'image/svg+xml', hash: 'sha256:0c4a…e81b' },
    },
    files: {
      'docs/README.md': docsIndex,
      'docs/architecture/overview.md': overviewIdea,
      'docs/offline-sync/README.md': readmeV3,
      'docs/offline-sync/conflict-resolution.md': conflictV3,
      'services/sync/NOTES.md': syncNotes,
    },
  },
]

const README = 'docs/offline-sync/README.md'
const CONFLICT = 'docs/offline-sync/conflict-resolution.md'

const offlineComments: Comment[] = [
  {
    id: 'c1',
    file: README,
    version: 3,
    anchor: { type: 'selection', quote: 'Changes sync within 30 seconds of the device reconnecting.', section: 'Goals' },
    author: { kind: 'user', userId: 'maya' },
    body: 'Is 30 seconds realistic on a bad connection? This reads like a promise. I think it should be a p95 target.',
    at: '2026-10-24T09:12:00Z',
    status: 'unresolved',
    replies: [
      {
        id: 'r1',
        author: { kind: 'user', userId: 'riley' },
        body: "Fair. It's meant as a p95. Happy to take the wording.",
        at: '2026-10-24T09:40:00Z',
      },
    ],
    suggestion: {
      replacement: '95% of changes sync within 30 seconds of the device reconnecting.',
      state: 'open',
    },
  },
  {
    id: 'c2',
    file: README,
    version: 3,
    anchor: { type: 'selection', quote: 'Should photo attachments sync over cellular by default?', section: 'Open questions' },
    author: { kind: 'user', userId: 'devon' },
    body: "Most customers' MDM policy already blocks large uploads on cellular. I'd default to Wi-Fi only and add a per-device override.",
    at: '2026-10-24T10:02:00Z',
    status: 'unresolved',
    replies: [],
  },
  {
    id: 'c3',
    file: README,
    version: 3,
    anchor: { type: 'section', section: 'Proposal' },
    author: { kind: 'bot', bot: 'archbot' },
    body: '`/sync` is new API surface. Document auth and rate limits before review closes. (Automated check: api-surface-review)',
    at: '2026-10-23T18:44:00Z',
    status: 'unresolved',
    replies: [],
  },
  {
    id: 'c10',
    file: README,
    version: 3,
    anchor: { type: 'section', section: 'Conflicts' },
    author: { kind: 'user', userId: 'sam' },
    body: 'Per-field merging means the server needs a field-level schema for every record type. Is that owned by this project or by the API team?',
    at: '2026-10-24T12:05:00Z',
    status: 'unresolved',
    replies: [],
  },
  {
    id: 'c11',
    file: README,
    version: 3,
    anchor: { type: 'section', section: 'Sync endpoint' },
    author: { kind: 'user', userId: 'maya' },
    body: 'Can the batch size and retry policy live here instead of only in the worker notes? Reviewers will look here first.',
    at: '2026-10-24T09:31:00Z',
    status: 'unresolved',
    replies: [
      {
        id: 'r5',
        author: { kind: 'userbot', bot: 'planbot', userId: 'riley' },
        body: 'Drafted a short "Batching" paragraph for this section. Riley will review before the next upload.',
        at: '2026-10-24T09:33:00Z',
      },
    ],
  },
  {
    id: 'c12',
    file: README,
    version: 3,
    anchor: { type: 'selection', quote: 'per field, not per record', section: 'Conflicts' },
    author: { kind: 'user', userId: 'devon' },
    body: 'What happens when a record is deleted on one device and edited on another? That one is per record no matter what.',
    at: '2026-10-24T10:40:00Z',
    status: 'unresolved',
    replies: [],
  },
  {
    id: 'c4',
    file: README,
    version: 2,
    anchor: { type: 'section', section: 'Rollout' },
    author: { kind: 'user', userId: 'devon' },
    body: 'Can we add an explicit kill-switch step? If conflict rates spike in the 5% cohort we need to turn it off without a release.',
    at: '2026-10-22T14:30:00Z',
    status: 'unresolved',
    replies: [
      {
        id: 'r2',
        author: { kind: 'userbot', bot: 'planbot', userId: 'riley' },
        body: 'The `offline_sync` flag is remotely configurable, so turning it off works as a kill switch. I can make that explicit in step 2.',
        at: '2026-10-22T14:31:00Z',
      },
    ],
  },
  {
    id: 'c5',
    file: README,
    version: 2,
    anchor: {
      type: 'selection',
      quote: 'We will reuse the existing REST endpoints unchanged and replay the log against them.',
      section: 'Proposal',
    },
    author: { kind: 'user', userId: 'maya' },
    body: "Replaying against the REST endpoints means one request per op. That won't hold up after a full day offline.",
    at: '2026-10-22T11:20:00Z',
    status: 'unresolved',
    replies: [
      {
        id: 'r3',
        author: { kind: 'user', userId: 'riley' },
        body: 'Agreed. Switching to a batch endpoint in the next version.',
        at: '2026-10-22T12:02:00Z',
      },
    ],
  },
  {
    id: 'c6',
    file: README,
    version: 3,
    anchor: { type: 'file' },
    author: { kind: 'user', userId: 'maya' },
    body: "Overall this reads well. I'd like one pass from someone on the Platform team before we start building.",
    at: '2026-10-24T09:20:00Z',
    status: 'unresolved',
    replies: [],
  },
  {
    id: 'c7',
    file: CONFLICT,
    version: 3,
    anchor: { type: 'selection', quote: "colleage's", section: 'Why not last-write-wins?' },
    author: { kind: 'userbot', bot: 'typobot', userId: 'devon' },
    body: 'Spelling.',
    at: '2026-10-24T08:01:00Z',
    status: 'unresolved',
    replies: [],
    suggestion: { replacement: "colleague's", state: 'open' },
  },
  {
    id: 'c8',
    file: CONFLICT,
    version: 2,
    anchor: { type: 'selection', quote: 'Last write wins', section: 'Rules' },
    author: { kind: 'user', userId: 'devon' },
    body: "Device clocks drift. Last-write-wins will quietly drop a technician's status change.",
    at: '2026-10-22T15:10:00Z',
    status: 'resolved',
    replies: [
      {
        id: 'r4',
        author: { kind: 'user', userId: 'riley' },
        body: 'Switched to server order and added a section on why.',
        at: '2026-10-23T18:41:00Z',
      },
    ],
  },
  {
    id: 'c9',
    file: 'docs/architecture/overview.md',
    version: 3,
    anchor: { type: 'selection', quote: 'batch sync endpoint and conflict resolution', section: 'Services' },
    author: { kind: 'user', userId: 'sam' },
    body: 'Link the ADR here once it exists.',
    at: '2026-10-24T11:45:00Z',
    status: 'unresolved',
    replies: [],
  },
]

// ---------- which idea this page shows ----------
// The prototype holds more than one idea. ?idea=<id> picks one, once, before
// the app renders (selectIdea in main.tsx); everything reads these bindings.
// Without ?idea it's the offline-sync idea.

export type IdeaInfo = typeof offlineIdea
export type IdeaData = {
  idea: IdeaInfo
  status: IdeaStatus
  activity: Activity[]
  target: Record<string, string>
  versions: Version[]
  comments: Comment[]
  defaultFile: string
}

const offlineSync: IdeaData = {
  idea: offlineIdea,
  status: offlineStatus,
  activity: offlineActivity,
  target: offlineTarget,
  versions: offlineVersions,
  comments: offlineComments,
  defaultFile: 'docs/offline-sync/README.md',
}

export let idea = offlineSync.idea
export let initialStatus = offlineSync.status
export let initialActivity = offlineSync.activity
export let target = offlineSync.target
export let initialVersions = offlineSync.versions
export let initialComments = offlineSync.comments
export let defaultFile = offlineSync.defaultFile

export function selectIdea(d: IdeaData) {
  idea = d.idea
  initialStatus = d.status
  initialActivity = d.activity
  target = d.target
  initialVersions = d.versions
  initialComments = d.comments
  defaultFile = d.defaultFile
}
