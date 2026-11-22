// The Comments team: ideas made to try out comments on pages (docs/handoff-page-comments.md), each
// with the kind of discussion one part of it is for. scripts/test-ui-data.ts adds them to the seed.
//
// - Crowded comments: one paragraph with eight threads, and quiet ones around it, for the fit rule
//   (full, short, line, pile), threads folded (one of six replies, one of sixteen on the last
//   section, to scroll to), and a long comment cut short.
// - Comments on every kind of block: whole-file, section and block comments on a paragraph, a list
//   item, a table, code, a diagram and a quote; resolved, pending, and a suggested edit.
// - Comments through new versions: a comment whose text is rewritten, a block moved, a block
//   deleted, for "moved" and "Not in this version".
// - Two files, both commented on: counts in the Files list, whole-file comments on each, focus view.
// - A long file: fourteen sections with a comment or two each, for scrolling and the ticks.
import type { Discussion, IdeaSeed, TeamSeed } from './test-ui-data.ts'

export const commentsTeam: TeamSeed = {
  handle: 'comments',
  name: 'Comments',
  description: 'Ideas for trying out comments on pages: crowded, on blocks and sections, across versions.',
  admin: 'riley',
  members: {
    maya: 'maintainer',
    sam: 'member',
    devon: 'member',
    priya: 'member',
    jordan: 'member',
    lena: 'member',
    noor: 'member',
    kai: 'member',
  },
  requirements: { approvals: 0, resolved: false },
}

const CROWDED = `# Offline sync, argued over

## Why

Field teams lose signal in basements and plant rooms, and today the app loses whatever they typed.

## The queue

Changes wait in a queue on the device and are sent oldest first when the connection comes back. Each change carries the time it was made and the device it came from, and the queue survives a restart of the app. Nothing is sent twice: each change has an ID the server remembers for a month.

## Conflicts

When two devices change the same record, the server keeps both versions and asks the next person online to choose between them. Photos are never merged. Notes from the two devices are joined in time order, with a line between them. A status change is different: the later one wins.

## Rollout

Ship behind a flag, one team at a time, starting with the two teams that asked for it.
`

const BLOCKS = `# Sync states

Each change on the device is in one of these states, and the app shows which.

## The states

| State | Meaning | Shown as |
| --- | --- | --- |
| saved | on the device only | a clock |
| sending | being sent now | a spinner |
| sent | the server has it | a tick |
| conflict | someone else changed it first | a warning |

- A change moves from saved to sending as soon as there's a connection.
- A conflict waits for the person to choose.
- Nothing is deleted from the device until it's sent.

## How they connect

\`\`\`mermaid
flowchart LR
  saved --> sending --> sent
  sending --> conflict --> saved
\`\`\`

## The client

\`\`\`ts
type SyncState = 'saved' | 'sending' | 'sent' | 'conflict'
\`\`\`

> We tried showing only sent and not sent in the pilot. People couldn't tell a slow send from a stuck one.
`

const VERSIONS = `# Comments through new versions

## Plan

The team writes the handbook in three passes over a month.

Each pass ends with a review by the whole team.

## Steps

- Draft the sections everyone agrees on.
- Argue about the rest in comments.
- Cut what nobody defends.

## Later

Nothing here yet.
`

const OVERVIEW = `# Field app: offline mode

The field app keeps working without a connection, and catches up when it comes back. This file says what changes for the people using it; sync.md says how it works.

## For technicians

Nothing to learn: the app looks the same, with a small banner while it's offline.

## For supervisors

A change made offline shows who made it and when, as any other change does.
`

const SYNC = `# How sync works

Each change is kept in a queue on the device and sent, oldest first, when the connection comes back.

## Conflicts

When two people changed the same field, the server keeps both and asks the second to choose.

## Limits

The queue holds 5,000 changes. Past that, the app asks the technician to find a connection.
`

/** A long file: fourteen sections of a page each, so the comments spread down it. */
const SECTIONS = [
  'Before your first week',
  'The handover',
  'Your phone',
  'Your laptop',
  'When an alert fires',
  'Severity',
  'Talking to customers',
  'Escalating',
  'Writing it up',
  'Nights and weekends',
  'Swapping a shift',
  'Pay',
  'When it goes wrong',
  'After your week',
]
const LONG = `# The on-call guide\n\n${SECTIONS.map(
  (title, i) => `## ${title}

${title} is part ${i + 1} of the guide. Read it once before your first week, and again when it comes up: the guide changes as we learn, and the date of each change is at the end of the page.

The short version: say what you're doing, write down what you did, and ask for help early. Nobody is on call alone, and nobody is judged for paging someone at three in the morning.

${i % 3 === 0 ? `- Check the alert's runbook first.\n- Then the dashboard for the service.\n- Then ask in the on-call channel.\n` : 'If you are unsure, page the secondary. That is what they are there for.'}
`,
).join('\n')}`

const people = ['maya', 'sam', 'devon', 'priya', 'jordan', 'lena', 'noor', 'kai']

/** A thread that goes on: who replied, and what they said, in order. */
const LONG_THREAD: Array<[string, string]> = [
  ['maya', 'The Denver crew and the North Yard team.'],
  ['noor', 'Both have bad signal on most sites?'],
  ['maya', 'Denver does. North Yard asked because their tablets are old and drop the connection.'],
  ['sam', 'Old tablets are a different problem. Offline mode will hide it, not fix it.'],
  ['maya', 'Hiding it is what they want until the new tablets come in March.'],
  ['devon', 'Then the flag stays on for them after March?'],
  ['maya', 'Yes, it stays on for everyone it reaches. There is no going back to online only.'],
  ['priya', 'Who decides when the next team gets it?'],
  ['maya', 'Whoever runs the pilot, once the conflict count is under 1% for two weeks.'],
  ['jordan', 'Who runs the pilot?'],
  ['maya', 'Me, with Devon on the server side.'],
  ['lena', 'Can design sit in on the first week? The banner needs checking in the field.'],
  ['maya', 'Yes. I will add you to the pilot channel.'],
  ['kai', 'What do we do if the conflict count never gets under 1%?'],
  ['sam', 'Then the conflict screen is wrong, and we fix that before anyone else gets it.'],
  ['noor', 'Good. Put the two team names and the 1% rule in this section, and I will resolve this.'],
]

export function commentIdeas(): IdeaSeed[] {
  return [
    {
      by: 'maya',
      team: 'comments',
      title: 'Crowded comments',
      description: 'One paragraph with eight threads, and quiet ones around it: cards shrink where it is crowded.',
      review: true,
      files: { 'crowded.md': CROWDED },
      discussion: [
        { by: 'sam', on: 'lose signal', body: 'How often? A number here would make the case.' },
        {
          by: 'devon',
          on: 'oldest first',
          body:
            'Oldest first means one bad change holds up every change behind it. On a device that was offline for ' +
            'a week that can be hundreds of changes, and the person sees none of them arrive. Could the queue set ' +
            'aside a change the server refuses, say so on the device, and carry on with the rest? Then the refused ' +
            'one waits for someone to fix it, and everything else goes through.\n\nThe same goes for a change that ' +
            'times out: retry it a few times with a pause, then set it aside like a refused one.',
        },
        { by: 'priya', on: 'survives a restart', body: 'And a reinstall?' },
        {
          by: 'kai',
          on: 'remembers for a month',
          suggest: 'remembers for ninety days',
          body: 'A month is shorter than some field trips.',
        },
        {
          by: 'sam',
          on: 'two devices change the same record',
          body: 'Same record, or same field?',
          replies: [{ by: 'maya', body: 'Same record. Two fields of it changed separately are merged.' }],
        },
        {
          by: 'devon',
          on: 'keeps both versions',
          body: 'Both where? In the list, or only when you open the record?',
          replies: [
            { by: 'maya', body: 'Only on the record. The list shows a badge.' },
            { by: 'devon', body: 'What does the badge say?' },
            { by: 'lena', body: 'Two versions, and a warning color.' },
            { by: 'devon', body: 'Can it say who made the other one?' },
            { by: 'lena', body: 'Yes, when you point at it.' },
            { by: 'devon', body: 'Then that works for me.' },
          ],
        },
        { by: 'priya', on: 'asks the next person online', body: 'What if nobody comes online for a week?' },
        { by: 'jordan', on: 'Photos are never merged', body: 'Both photos are kept, then?' },
        { by: 'lena', on: 'joined in time order', body: 'Time order by which clock? Device clocks drift.' },
        { by: 'noor', on: 'with a line between them', body: 'A line, or a heading with who wrote each?' },
        { by: 'kai', on: 'A status change is different', body: 'Why different? Say it here.' },
        { by: 'maya', on: 'the later one wins', body: 'The later by the server, or by the device?' },
        // a long thread: sixteen replies, folded to the last two until asked for
        {
          by: 'noor',
          on: 'Ship behind a flag',
          body: 'Which two teams asked? Name them.',
          replies: LONG_THREAD.map(([by, body]) => ({ by, body })),
        },
      ],
    },
    {
      by: 'sam',
      team: 'comments',
      title: 'Comments on every kind of block',
      description: 'Comments on the whole file, a section, and each kind of block: a table, a list item, a diagram.',
      review: true,
      files: { 'sync-states.md': BLOCKS },
      discussion: [
        { by: 'maya', body: 'A picture of each state as the app shows it would help.' },
        {
          by: 'priya',
          body: 'Who decided on four states? Was three considered?',
          replies: [{ by: 'sam', body: 'Yes, in the pilot: see the quote at the end.' }],
        },
        { by: 'devon', section: 'The states', body: 'This section and the client type need to agree.' },
        { by: 'lena', section: 'The states', body: 'Can a change go back from sent?' },
        { by: 'jordan', block: 'Each change on the device', body: 'Shows where? In the list, or on the record?' },
        { by: 'kai', block: '| State | Meaning', body: 'Add a row for a change that failed to send.' },
        { by: 'noor', on: 'a warning', body: 'A warning color, or an icon?' },
        { by: 'maya', block: 'A conflict waits for the person to choose', body: 'Forever?' },
        {
          by: 'priya',
          block: 'Nothing is deleted from the device',
          body: 'What about when the device is full?',
          resolved: true,
        },
        { by: 'devon', block: 'flowchart LR', body: 'Conflict goes back to saved? I thought it went to sending.' },
        { by: 'lena', block: 'type SyncState', body: 'Export this from the shared package.' },
        { by: 'jordan', block: 'We tried showing only sent', body: 'How many people were in the pilot?' },
        {
          by: 'riley',
          block: 'A change moves from saved to sending',
          body: 'Even on a metered connection?',
          pending: true,
        },
        {
          by: 'kai',
          on: 'someone else changed it first',
          suggest: 'someone changed it first on another device',
          body: 'It can be the same person on two devices.',
        },
      ],
    },
    {
      by: 'devon',
      team: 'comments',
      title: 'Comments through new versions',
      description: 'Comments made on v1, then a version that rewrites, moves and deletes what they were on.',
      files: { 'plan.md': VERSIONS },
      discussion: [
        { by: 'maya', on: 'three passes over a month', body: 'Three passes is a lot for a month.' },
        { by: 'sam', block: 'Each pass ends with a review', body: 'Who runs the review?' },
        { by: 'priya', block: 'Cut what nobody defends', body: 'Harsh, but right.' },
        { by: 'jordan', on: 'Argue about the rest', body: 'In comments here, or in a meeting?' },
        { by: 'lena', section: 'Steps', body: 'These steps need owners.' },
      ],
      versions: [
        {
          changes: [
            // rewritten: its comment is no longer on anything (Not in this version)
            ['three passes over a month', 'two passes'],
            // moved, unchanged, to Later: its comment moves with it
            ['\n\nEach pass ends with a review by the whole team.\n', '\n'],
            ['Nothing here yet.', 'Nothing here yet.\n\nEach pass ends with a review by the whole team.'],
            // deleted: its comment is no longer on anything
            ['- Cut what nobody defends.\n', ''],
          ],
        },
      ],
    },
    {
      by: 'priya',
      team: 'comments',
      title: 'Two files, both commented on',
      description: 'An overview and how it works, each with comments on its text and on the file as a whole.',
      review: true,
      files: { 'overview.md': OVERVIEW, 'sync.md': SYNC },
      discussion: [
        { by: 'maya', body: 'Who is this overview for? Say it at the top.' },
        { by: 'sam', on: 'a small banner', body: 'Where on the screen?' },
        { by: 'noor', section: 'For supervisors', body: 'Supervisors will want a report of offline work.' },
        { by: 'devon', file: 'sync.md', body: 'This needs a diagram of the queue.' },
        { by: 'kai', file: 'sync.md', on: 'oldest first', body: 'Oldest first per record, or overall?' },
        { by: 'lena', file: 'sync.md', block: 'The queue holds 5,000 changes', body: 'Where does 5,000 come from?' },
        { by: 'jordan', file: 'sync.md', section: 'Conflicts', body: 'Link to the conflicts idea.' },
      ],
    },
    {
      by: 'noor',
      team: 'comments',
      title: 'A long file with comments down it',
      description: 'Fourteen sections with a comment or two each: scroll it, and follow the ticks down its edge.',
      review: true,
      files: { 'on-call-guide.md': LONG },
      discussion: [
        { by: 'maya', body: 'Too long to read in one go: split it into pages?' },
        { by: 'sam', body: 'The date of each change should be at the top, not the end.' },
        ...SECTIONS.flatMap((title, i): Discussion[] => {
          const by = people[i % people.length]!
          const first: Discussion =
            i % 2 === 0
              ? { by, on: `${title} is part ${i + 1}`, body: `Is "${title}" in the right place?` }
              : { by, section: title, body: `Who owns "${title}"?` }
          return i % 4 === 1
            ? [first, { by: people[(i + 3) % people.length]!, block: `${title} is part ${i + 1}`, body: 'Shorter?' }]
            : [first]
        }),
      ],
    },
  ]
}
