// PROTOTYPE: the "MVP architecture" idea, in the Dogfood team. Its files are the
// real docs in the repository's mvp/ folder, read at build time, so the demo
// always shows their current text. Open it with ?idea=mvp.
//
// The example comments are anchored to sections and text that are in the docs
// today. If the docs change under them, they become outdated, just as the
// real product would show it.
import type { IdeaData } from '../data'

const docs = import.meta.glob('../../../../docs/mvp/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const files: Record<string, string> = {}
for (const [path, text] of Object.entries(docs)) files[`mvp/${path.split('/').pop()}`] = text

const OVERVIEW = 'mvp/architecture.md'
const BACKEND = 'mvp/architecture-backend.md'
const CLI = 'mvp/architecture-cli.md'

export const mvpIdea: IdeaData = {
  idea: {
    id: 'idea-mvp',
    title: 'Ideation Factory MVP architecture',
    description: 'The pitch for the minimum viable product: the high-level design and tech stack, then the front end, the back end, and the cli and skills.',
    ownerId: 'riley',
    team: 'Dogfood',
    repo: 'acme/ideation-factory',
    branch: 'riley/mvp-architecture',
    target: 'main',
    reviewers: [
      { kind: 'user', userId: 'maya', lastSeenVersion: 1 },
      { kind: 'user', userId: 'sam' },
    ],
  },
  status: 'requesting review',
  activity: [
    { id: 'm-a1', at: '2026-10-26T15:00:00Z', actor: { kind: 'user', userId: 'riley' }, kind: 'created', text: 'created this idea as a draft' },
    { id: 'm-a2', at: '2026-10-26T15:05:00Z', actor: { kind: 'user', userId: 'riley' }, kind: 'review-requested', text: 'requested review from Maya Ortiz and Sam Achebe' },
    { id: 'm-a3', at: '2026-10-26T15:05:30Z', actor: { kind: 'user', userId: 'riley' }, kind: 'status', text: 'changed the status to Requesting review' },
  ],
  // nothing in main yet: every file is new
  target: {},
  versions: [
    {
      n: 1,
      author: { kind: 'user', userId: 'riley' },
      message: 'MVP architecture: overview, front end, back end, cli and skills',
      at: '2026-10-26T15:02:00Z',
      files,
    },
  ],
  comments: [
    {
      id: 'm-c1',
      file: OVERVIEW,
      version: 1,
      anchor: { type: 'section', section: 'MVP scope' },
      author: { kind: 'user', userId: 'maya' },
      body: 'Do group rules need to be in the MVP? A minimum number of approvals might be enough to prove the review loop, and groups could follow.',
      at: '2026-10-26T16:20:00Z',
      status: 'unresolved',
      replies: [],
    },
    {
      id: 'm-c2',
      file: OVERVIEW,
      version: 1,
      anchor: { type: 'selection', quote: 'One actor per idea.', section: 'High-level design' },
      author: { kind: 'user', userId: 'sam' },
      body: 'What happens when one idea gets busy, say a bot posting hundreds of comments? Everything for it goes through one actor.',
      at: '2026-10-26T16:45:00Z',
      status: 'unresolved',
      replies: [
        {
          id: 'm-r1',
          author: { kind: 'user', userId: 'riley' },
          body: 'Rate limits per token (tighter for bots) and a per-idea cap on comments per minute. See Auth and access in the back-end doc.',
          at: '2026-10-26T17:02:00Z',
        },
      ],
    },
    {
      id: 'm-c3',
      file: BACKEND,
      version: 1,
      anchor: { type: 'section', section: 'Self-hosting' },
      author: { kind: 'bot', bot: 'archbot' },
      body: 'The one-VM shape needs a real number for its loss window before we promise it to anyone. How long do the newest writes live only on that disk? See the Rivet spike.',
      at: '2026-10-26T16:05:00Z',
      status: 'unresolved',
      replies: [],
    },
    {
      id: 'm-c4',
      file: CLI,
      version: 1,
      anchor: { type: 'file' },
      author: { kind: 'userbot', bot: 'planbot', userId: 'maya' },
      body: 'Reviewed the command list against the backend operations: every MVP operation has a cli command, and `ideaf edit --dry-run` matches the backend dry run.',
      at: '2026-10-26T16:30:00Z',
      status: 'resolved',
      replies: [],
    },
  ],
  defaultFile: OVERVIEW,
}
