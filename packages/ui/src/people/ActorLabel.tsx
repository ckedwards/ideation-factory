import { Tag } from '../labels/Tag.tsx'
import type { Person } from './person.ts'
import { UserName } from './UserName.tsx'
import './ActorLabel.css'

// Who did something. The three token purposes: a person themselves, a bot
// acting for a person, and a bot of its own (automated).
export type Actor =
  | { kind: 'person'; person: Person }
  | { kind: 'bot-for-person'; bot: string; person: Person }
  | { kind: 'bot'; bot: string }

export interface ActorLabelProps {
  actor: Actor
  // "for Riley" instead of "on behalf of Riley", where space is tight
  short?: boolean
}

// "Riley Park", "🤖 planbot on behalf of Riley Park" or "🤖 archbot automated".
// Agent work is always labeled.
export function ActorLabel({ actor, short = false }: ActorLabelProps) {
  if (actor.kind === 'person') {
    return (
      <span className="actor">
        <UserName person={actor.person} withAvatar />
      </span>
    )
  }
  return (
    <span className="actor actor-bot">
      <span className="bot-mark" aria-hidden>
        🤖
      </span>
      <span className="visually-hidden">Bot</span>
      <span className="actor-name">{actor.bot}</span>
      {actor.kind === 'bot-for-person' ? (
        <span className="actor-behalf">
          {short ? 'for' : 'on behalf of'}{' '}
          <span className="actor-person">
            <UserName person={actor.person} />
          </span>
        </span>
      ) : (
        <Tag tone="bot">automated</Tag>
      )}
    </span>
  )
}
