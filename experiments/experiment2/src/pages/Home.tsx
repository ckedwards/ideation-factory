// PROTOTYPE: home. What's waiting on you, your ideas, your inbox, your teams.
import { Link } from '@tanstack/react-router'
import { ME } from '../data'
import { useStore } from '../store'
import { WATCH_LEVELS, threads, ownMaintain, ruleBroken, isActive, isOpen, myTeams, reasonsFor, reasonText, visibleIdeas, waitingOnMe, watchLevel } from '../model'
import { Empty, IdeaRow, PageHeader, fmt } from '../ui'
import { ThreadRow } from './Notifications'

export function Home() {
  const { state } = useStore()
  const first = state.users[ME].name.split(' ')[0]
  const waiting = waitingOnMe(state).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  const mine = visibleIdeas(state).filter((i) => i.authorId === ME && isOpen(state, i)).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  const unread = threads(state).filter((t) => t.unread > 0 && !t.done)
  const teams = myTeams(state)
  // things only a maintainer or admin can resolve, for teams and groups where that's
  // *your* role. Site-admin powers don't add anything here; site-wide issues live on /admin.
  const attention = [
    ...state.teams
      .filter((t) => !t.archivedAt && ownMaintain(t) && t.requirements.groups.some((r) => ruleBroken(state.groups, r)))
      .map((t) => ({ key: `req-${t.id}`, error: true, text: `⚠ ${t.name}’s approval requirements name a deleted group. Fix them →`, to: '/teams/$teamId/settings', params: { teamId: t.id }, search: { tab: 'requirements' } })),
    ...[...state.teams.filter((t) => !t.archivedAt), ...state.groups.filter((g) => !g.deletedAt)]
      .filter((m) => m.requests.length > 0 && ownMaintain(m))
      .map((m) => {
        const isTeam = state.teams.includes(m as never)
        return {
          key: `rq-${m.id}`,
          error: false,
          text: `${m.requests.length} ${m.requests.length === 1 ? 'person wants' : 'people want'} to join ${m.name} →`,
          to: isTeam ? '/teams/$teamId/settings' : '/groups/$groupId/settings',
          params: isTeam ? { teamId: m.id } : { groupId: m.id },
          search: { tab: 'members' },
        }
      }),
  ]
  const activeByTeam = new Map<string, number>()
  for (const i of visibleIdeas(state)) if (isActive(state, i)) activeByTeam.set(i.teamId, (activeByTeam.get(i.teamId) ?? 0) + 1)

  return (
    <div className="page page-wide">
      <PageHeader
        title={`Good afternoon, ${first}`}
        sub={
          <>
            {fmt(waiting.length)} review{waiting.length === 1 ? '' : 's'} waiting on you · {fmt(unread.length)} idea{unread.length === 1 ? '' : 's'} with unread updates
          </>
        }
      />
      <div className="home-grid">
        <div className="home-main">
          <section className="section">
            <h2>Waiting on your review</h2>
            {waiting.slice(0, 5).map((i) => (
              <IdeaRow
                key={i.id}
                idea={i}
                extra={
                  <span className="tag tag-reason">
                    {reasonText(state, reasonsFor(state, i).find((r) => r.kind === 'reviewer' || r.kind === 'group')!)}
                  </span>
                }
              />
            ))}
            {waiting.length > 5 && (
              <Link className="see-all" to="/ideas" search={{ review: 'me' } as never}>
                All {fmt(waiting.length)}, plus everything else you’re reviewing →
              </Link>
            )}
            {waiting.length === 0 && <Empty>Nothing waiting on you. Nice.</Empty>}
          </section>

          <section className="section">
            <h2>Your open ideas</h2>
            {mine.slice(0, 5).map((i) => (
              <IdeaRow key={i.id} idea={i} hide={{ author: true }} />
            ))}
            {mine.length > 5 && (
              <Link className="see-all" to="/ideas" search={{ author: 'me' } as never}>
                See all {fmt(mine.length)} of your ideas →
              </Link>
            )}
            {mine.length === 0 && <Empty>You have no open ideas. Use “ideaf start” in your repo.</Empty>}
          </section>
        </div>

        <aside className="home-side">
          {attention.length > 0 && (
            <section className="section">
              <h2>Needs you as a maintainer</h2>
              <div className="card-list">
                {attention.map((a) => (
                  <Link key={a.key} to={a.to as never} params={a.params as never} search={a.search as never} className={`attention ${a.error ? 'is-error' : ''}`}>
                    {a.text}
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section className="section">
            <div className="section-head">
              <h2>Unread</h2>
              <Link to="/notifications">All notifications →</Link>
            </div>
            <div className="card-list">
              {unread.slice(0, 5).map((t) => (
                <ThreadRow key={t.idea.id} t={t} compact />
              ))}
              {unread.length === 0 && <Empty>You’re all caught up.</Empty>}
            </div>
          </section>

          <section className="section">
            <div className="section-head">
              <h2>Your teams</h2>
              <Link to="/teams" search={{ show: 'mine' } as never}>
                {teams.length > 6 ? `All ${teams.length} of your teams →` : 'Browse teams →'}
              </Link>
            </div>
            <div className="card-list">
              {teams.slice(0, 6).map((t) => {
                const open = activeByTeam.get(t.id) ?? 0
                return (
                  <Link key={t.id} to="/teams/$teamId" params={{ teamId: t.id }} className="team-mini">
                    <span className="team-mini-name">{t.name}</span>
                    <span className="muted">
                      {fmt(open)} active idea{open === 1 ? '' : 's'}
                    </span>
                    {watchLevel(state, t.id) !== 'participating' && <span className="tag tag-watch">Watching {WATCH_LEVELS.find((w) => w.id === watchLevel(state, t.id))!.short.toLowerCase()}</span>}
                  </Link>
                )
              })}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
