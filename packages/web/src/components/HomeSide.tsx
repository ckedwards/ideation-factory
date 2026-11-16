// Home's second column: the ideas with news you haven't read, join requests waiting on you (as a team's
// or group's maintainer or admin), and your teams, with how much of each you hear about.
import { Link, Section } from '@ideaf/ui'
import './HomeSide.css'

export interface HomeSideProps {
  /** The latest ideas with unread news, and how many updates each has. */
  unread: { id: string; title: string; href: string; count: number }[]
  /** How many there are in all. */
  unreadTotal: number
  /** Teams and groups with people asking to join, for you to decide. */
  requests: { key: string; name: string; href: string; count: number }[]
  teams: { handle: string; name: string; watch: 'participating' | 'active' | 'all' }[]
}

const WATCH = { participating: null, active: 'Active ideas', all: 'All ideas' } as const

export function HomeSide({ unread, unreadTotal, requests, teams }: HomeSideProps) {
  return (
    <div className="home-side">
      {requests.length > 0 && (
        <Section title="Needs you">
          <ul className="home-side-list">
            {requests.map((r) => (
              <li key={r.key}>
                <Link href={r.href}>{r.name}</Link>
                <span className="home-side-note">
                  {r.count === 1 ? '1 request to join' : `${r.count} requests to join`}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section
        title="Unread"
        action={unreadTotal > unread.length ? <Link href="/notifications">See all</Link> : undefined}
      >
        {unread.length === 0 ? (
          <p className="home-side-none">You’re up to date.</p>
        ) : (
          <ul className="home-side-list">
            {unread.map((n) => (
              <li key={n.id}>
                <Link href={n.href}>{n.title}</Link>
                <span className="home-side-note">{n.count === 1 ? '1 new' : `${n.count} new`}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Your teams" action={<Link href="/teams">All teams</Link>}>
        {teams.length === 0 ? (
          <p className="home-side-none">You’re not in a team yet.</p>
        ) : (
          <ul className="home-side-list">
            {teams.map((t) => (
              <li key={t.handle}>
                <Link href={`/${t.handle}`}>{t.name}</Link>
                {WATCH[t.watch] && <span className="home-side-note">Watching {WATCH[t.watch]!.toLowerCase()}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
