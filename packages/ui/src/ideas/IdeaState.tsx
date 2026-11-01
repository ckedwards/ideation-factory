import type { ReactNode } from 'react'
import { Tooltip } from '../overlays/Tooltip.tsx'
import { RelativeTime } from '../time/RelativeTime.tsx'
import { ideaState, plural, type IdeaInfo, type IdeaStateKey } from './idea.ts'
import { RequirementList } from './RequirementList.tsx'
import { StatusPill } from './StatusPill.tsx'
import './IdeaState.css'

const LABEL: Record<IdeaStateKey, string> = {
  draft: 'Draft',
  review: 'In review',
  met: 'Reqs met',
  accepted: 'Closed',
  rejected: 'Closed',
  archived: 'Closed',
}

// Each state has its own shape, so it never rests on color alone
const SHAPE: Record<IdeaStateKey, ReactNode> = {
  // dashed ring: not out yet
  draft: <circle cx="8" cy="8" r="5.5" strokeDasharray="2.2 2.2" />,
  // ring, half filled: under way
  review: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 2.5a5.5 5.5 0 0 1 0 11Z" fill="currentColor" stroke="none" />
    </>
  ),
  // ring with a check: requirements met
  met: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M5.5 8.25l1.75 1.75 3.25-3.5" />
    </>
  ),
  // closed states are solid
  accepted: (
    <>
      <circle cx="8" cy="8" r="6.5" fill="currentColor" stroke="none" />
      <path d="M5.25 8.25l1.9 1.9 3.6-3.9" stroke="var(--surface)" strokeWidth="1.75" />
    </>
  ),
  rejected: (
    <>
      <circle cx="8" cy="8" r="6.5" fill="currentColor" stroke="none" />
      <path d="M5.75 5.75l4.5 4.5 M10.25 5.75l-4.5 4.5" stroke="var(--surface)" strokeWidth="1.75" />
    </>
  ),
  archived: (
    <>
      <rect x="2" y="3" width="12" height="3.5" rx="0.75" fill="currentColor" stroke="none" />
      <path d="M3 7v6h10V7 M6.5 9.5h3" />
    </>
  ),
}

function Icon({ state }: { state: IdeaStateKey }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {SHAPE[state]}
    </svg>
  )
}

export interface IdeaStateProps {
  idea: IdeaInfo
  // the icon only, without its label
  compact?: boolean
}

// An idea's coarse state as an icon and a short label. Hovering or focusing it
// shows the details: status, requirements, approvals, reviewers, team.
export function IdeaState({ idea, compact = false }: IdeaStateProps) {
  const state = ideaState(idea)
  return (
    <Tooltip focusable className={`idea-state state-${state}`} content={() => <Details idea={idea} state={state} />}>
      <Icon state={state} />
      <span className={compact ? 'visually-hidden' : 'idea-state-label'}>
        <span className="visually-hidden">State: </span>
        {LABEL[state]}
      </span>
    </Tooltip>
  )
}

function headline(idea: IdeaInfo, state: IdeaStateKey): string {
  if (state === 'draft') {
    return 'Draft'
  }
  if (state === 'archived') {
    return 'Closed · team archived'
  }
  if (state === 'accepted' || state === 'rejected') {
    return `Closed as ${state}`
  }
  const { requirements } = idea
  if (requirements.length === 0) {
    return 'In review · no requirements'
  }
  if (requirements.some((check) => check.broken)) {
    return 'In review · requirements need fixing'
  }
  const met = requirements.filter((check) => check.met).length
  return `In review · ${met} of ${plural(requirements.length, 'requirement')} met`
}

function names(people: { name: string }[]): string {
  const all = people.map((person) => person.name)
  return all.length > 3 ? `${all.slice(0, 3).join(', ')} and ${all.length - 3} more` : all.join(', ')
}

function Details({ idea, state }: { idea: IdeaInfo; state: IdeaStateKey }) {
  const people = idea.reviewers.filter((r) => r.kind === 'person').length
  const groups = idea.reviewers.length - people
  const reviewers = [people > 0 && plural(people, 'person', 'people'), groups > 0 && plural(groups, 'group')]
    .filter(Boolean)
    .join(' and ')
  const inReview = state === 'review' || state === 'met'
  const closed = state === 'accepted' || state === 'rejected' || state === 'archived'
  return (
    <>
      <div className={`idea-state-head state-${state}`}>
        <Icon state={state} />
        <span>{headline(idea, state)}</span>
      </div>
      <dl className="idea-state-facts">
        <dt>Status</dt>
        <dd>
          <StatusPill
            status={idea.status}
            {...(idea.closedReason ? { reason: idea.closedReason } : {})}
            archived={Boolean(idea.archived)}
          />
        </dd>
        {inReview && (
          <>
            <dt>Requirements</dt>
            <dd>
              {idea.requirements.length > 0 ? (
                <RequirementList checks={idea.requirements} />
              ) : (
                'None, so it can be closed as accepted any time.'
              )}
            </dd>
          </>
        )}
        {state !== 'draft' && (
          <>
            <dt>Approvals</dt>
            <dd>{idea.approvals.length > 0 ? names(idea.approvals) : <span className="muted">None yet</span>}</dd>
          </>
        )}
        <dt>Reviewers</dt>
        <dd>{reviewers || <span className="muted">None yet</span>}</dd>
        <dt>Team</dt>
        <dd>
          {(idea.team.personal || idea.team.locked) && <span aria-hidden>🔒 </span>}
          {idea.team.name}
        </dd>
        <dt>{closed ? 'Closed' : 'Updated'}</dt>
        <dd>
          <RelativeTime at={idea.updatedAt} /> · v{idea.version}
        </dd>
      </dl>
      {state === 'archived' && (
        <p className="idea-state-note">Its team is archived, so it’s read only and counts as closed.</p>
      )}
      {state === 'draft' && <p className="idea-state-note">Not out for review yet.</p>}
    </>
  )
}
