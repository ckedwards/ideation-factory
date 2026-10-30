// PROTOTYPE: a team's page. Open | Closed ideas, your watch level, the team's
// approval requirements (read-only here; changed in settings), and members.
// Archived teams are read-only.
import { Link, useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { ME, type Idea, type Team } from '../data'
import { useStore } from '../store'
import { WATCH_LEVELS, autoAddFor, requirementChecks, ago, canMaintain, canSee, canSeeInside, seesAssignedOnly, isOpen, maintainViaSite, myTeams, noActiveAdmin, hasRequirements, ruleBroken, watchLevel } from '../model'
import { Combobox, Dialog, Empty, PageHeader, WatchSelect, fmt } from '../ui'
import { rank } from '../search'
import { IdeaBrowser } from './IdeaBrowser'
import { MembersList, MembershipButton } from './members'
import { LockedTag } from './Teams'

export function TeamPage() {
  const { teamId } = useParams({ strict: false }) as { teamId: string }
  const { state } = useStore()
  const team = state.teams.find((t) => t.id === teamId)
  if (!team)
    return (
      <div className="page">
        <PageHeader title="Team not found" />
        <Empty>
          There’s no team called “{teamId}”. <Link to="/teams">Browse teams</Link>
        </Empty>
      </div>
    )

  if (team.personal) return <YourIdeas team={team} />

  const level = watchLevel(state, team.id)
  const levelInfo = WATCH_LEVELS.find((w) => w.id === level)!
  const maintain = canMaintain(state, team)
  // shown only because you're a site admin, so it's called out
  const via = maintainViaSite(state, team) ? 'via-admin' : ''
  const broken = team.requirements.groups.filter((r) => ruleBroken(state.groups, r))
  const checks = requirementChecks(state.groups, team.requirements)
  const archived = !!team.archivedAt
  const fixers = [...team.admins, ...team.maintainers].map((id) => state.users[id]?.name).filter(Boolean)
  const inside = canSeeInside(team)

  return (
    <div className="page page-wide">
      <div className="crumbs">
        <Link to="/teams">Teams</Link> / {team.name}
      </div>
      <PageHeader
        title={
          <>
            {team.name} {team.locked && <LockedTag />}
            {archived && <span className="tag tag-archived">Archived</span>}
            {team.joinPolicy === 'invite' && <span className="tag">Invite only</span>}
          </>
        }
        sub={
          <>
            {team.description} Created by {state.users[team.createdBy]?.name} · {ago(team.createdAt)}
          </>
        }
        actions={
          <div className="team-actions is-big">
            {maintain && (
              <Link
                className={`button ${via}`}
                to="/teams/$teamId/settings"
                params={{ teamId: team.id }}
                title={via ? 'You’re not an admin or maintainer here. This is open to you only as a site admin.' : undefined}
              >
                Settings
              </Link>
            )}
            <MembershipButton entity="team" m={team} disabled={archived ? 'This team is archived.' : undefined} />
          </div>
        }
      />

      {archived && (
        <div className="banner banner-archived" role="status">
          <b>This team was archived {ago(team.archivedAt!)} by {state.users[team.archivedBy!]?.name ?? 'an admin'}.</b> Its ideas are read-only and
          count as archived: no new ideas, and no changes to the state of the ones that were open.
        </div>
      )}

      {team.locked && (
        <div className={`banner banner-locked ${inside ? '' : 'is-outside'}`} role="status">
          {inside ? (
            team.memberSees === 'assigned' ? (
              seesAssignedOnly(team) ? (
                <>
                  <b>🔒 This team is locked, and you see only the ideas you’re on:</b> ones you wrote or are asked to review. Its admins and maintainers see
                  all of them.
                </>
              ) : (
                <>
                  <b>🔒 This team is locked.</b> Its members only see the ideas they wrote or are asked to review; as {team.admins.includes(ME) ? 'an admin' : 'a maintainer'}{' '}
                  you see all of them. Removing someone from the team, or from an idea’s reviewers, takes their access away.
                </>
              )
            ) : (
              <>
                <b>🔒 This team is locked.</b> Only its {fmt(team.members.length)} members can see its ideas or get notifications about them. Removing someone
                from the team takes their access away.
              </>
            )
          ) : (
            <>
              <b>🔒 This team is locked.</b> Only its members can see its ideas.{' '}
              {team.archivedAt ? '' : 'Ask to join, and a maintainer or admin will approve or deny it.'}
              {state.siteAdmin && <span className="via-admin-text"> Being a site admin doesn’t change this: you can manage its members and settings, but not read its ideas.</span>}
            </>
          )}
        </div>
      )}

      {!archived && noActiveAdmin(state, team) && (
        <div className="banner banner-warn" role="status">
          <b>{team.name} has no active admin</b> ({team.admins.map((a) => state.users[a]?.name).join(', ')} {team.admins.length === 1 ? 'is' : 'are'}{' '}
          inactive). Until a site admin makes someone else an admin, nobody can change its settings or archive it.
          {state.siteAdmin && (
            <>
              {' '}
              <Link className="via-admin" to="/teams/$teamId/settings" params={{ teamId: team.id }} search={{ tab: 'members' } as never}>
                Pick a new admin →
              </Link>
            </>
          )}
        </div>
      )}

      {!archived && broken.length > 0 && (
        <div className="banner banner-error" role="alert">
          <b>⚠ {team.name}’s approval requirements name a deleted group.</b> Ideas here can’t be approved until a maintainer or admin replaces it.{' '}
          {maintain ? (
            <Link className={via} to="/teams/$teamId/settings" params={{ teamId: team.id }} search={{ tab: 'requirements' } as never}>
              Fix the requirements →
            </Link>
          ) : (
            <>Who can fix it: {fixers.slice(0, 3).join(', ')}{fixers.length > 3 ? ` and ${fixers.length - 3} more` : ''}.</>
          )}
        </div>
      )}

      {!archived && inside && (
        <div className={`watch-note ${level !== 'participating' ? 'is-on' : ''}`}>
          <WatchSelect teamId={team.id} />
          <span>
            {levelInfo.blurb}
            {level !== 'participating' && !team.members.includes(ME) && ' You don’t need to be a member to watch.'}
          </span>
        </div>
      )}

      <div className="team-grid">
        {inside ? (
          <IdeaBrowser pool={state.ideas.filter((i) => i.teamId === team.id && canSee(state, i))} hide={{ team: true }} />
        ) : (
          <div className="locked-empty">
            <div className="locked-icon" aria-hidden>
              🔒
            </div>
            <h2>Ideas are visible to members only</h2>
            <p className="hint">You can see who’s in {team.name} and its approval requirements, but not its ideas, how many there are, or any activity on them.</p>
          </div>
        )}

        <aside>
          <section className="section">
            <div className="section-head">
              <h2>Approval requirements</h2>
              {maintain && !archived && (
                <Link className={`section-link ${via}`} to="/teams/$teamId/settings" params={{ teamId: team.id }} search={{ tab: 'requirements' } as never}>
                  Change
                </Link>
              )}
            </div>
            {checks.length === 0 ? (
              <p className="hint">None. Ideas here can be closed as accepted without any approvals.</p>
            ) : (
              <>
                <p className="hint">An idea in {team.name} is approved once all of these hold:</p>
                <ul className="rules">
                  {checks.map((c) => (
                    <li key={c.key} className={c.broken ? 'is-broken' : c.warning ? 'is-warning' : ''}>
                      {c.text}
                      {c.warning && <span className="hint"> · still works through the other groups</span>}
                      {c.rule?.autoAdd && <span className="hint"> · added as {c.rule.groupIds.length === 1 ? 'a reviewer' : 'reviewers'} automatically</span>}
                    </li>
                  ))}
                </ul>
                <p className="hint">
                  {team.locked && 'Locked teams can’t use groups, so reviewers are always people. '}Only maintainers and admins of {team.name} can change these.
                </p>
              </>
            )}
          </section>

          <section className="section">
            <h2>
              Members <span className="muted">{fmt(team.members.length)}</span>
            </h2>
            <MembersList m={team} />
          </section>
        </aside>
      </div>
    </div>
  )
}

// "Your ideas": a hidden, one-person team. No members, watching, settings or
// requirements, just your ideas, and a way to move one into a real team.
function YourIdeas({ team }: { team: Team }) {
  const { state } = useStore()
  const [moving, setMoving] = useState<Idea | null>(null)
  if (team.personal !== ME)
    return (
      <div className="page">
        <PageHeader title="Private" />
        <Empty>These ideas are private to the person who wrote them.</Empty>
      </div>
    )
  return (
    <div className="page page-wide">
      <PageHeader
        title="🔒 Your ideas"
        sub="Ideas that aren’t in any team. Only you can see them, plus anyone you ask to review. When one’s ready to share, move it into a team."
      />
      <IdeaBrowser
        pool={state.ideas.filter((i) => i.teamId === team.id)}
        hide={{ team: true, author: true }}
        rowExtra={(i) =>
          isOpen(state, i) && (
            <button className="link move-link" onClick={() => setMoving(i)}>
              Move to a team…
            </button>
          )
        }
      />
      {moving && <MoveDialog idea={moving} onClose={() => setMoving(null)} />}
    </div>
  )
}

function MoveDialog({ idea, onClose }: { idea: Idea; onClose: () => void }) {
  const { state, dispatch } = useStore()
  const [teamId, setTeamId] = useState('')
  const mine = myTeams(state).filter((t) => !t.archivedAt)
  const picked = mine.find((t) => t.id === teamId)
  const autoGroups = picked ? autoAddFor(state, picked, idea) : []
  const search = (q: string) =>
    rank(mine, q, (t) => [{ name: 'name', text: t.name, weight: 0 }]).map((r) => option(r.item.id)!)
  const option = (id: string) => {
    const t = mine.find((x) => x.id === id)
    return t ? { id, label: `${t.locked ? '🔒 ' : ''}${t.name}`, sub: `${t.locked ? 'Locked · ' : ''}${fmt(t.members.length)} members` } : undefined
  }
  const target = mine.find((t) => t.id === teamId)
  return (
    <Dialog
      title={`Move “${idea.title}” to a team`}
      onClose={onClose}
      footer={
        <>
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={!target}
            onClick={() => {
              dispatch({ type: 'moveIdea', ideaId: idea.id, teamId })
              dispatch({ type: 'toast', text: `Moved to ${target!.name}. ${target!.locked ? 'Its members can read it now.' : 'Everyone can read it now.'}` })
              onClose()
            }}
          >
            Move to team
          </button>
        </>
      }
    >
      <div className="field">
        <span className="field-label">Team</span>
        <Combobox
          label="Team"
          anyLabel="Search your teams…"
          placeholder="Only teams you’re in."
          value={teamId}
          onChange={setTeamId}
          search={search}
          display={option}
          pinned={mine.slice(0, 6).map((t) => option(t.id)!)}
        />
      </div>
      {target ? (
        <ul className="consequences">
          {target.locked && target.memberSees === 'assigned' ? (
            <li>
              {target.name} is locked and members only see ideas they’re on, so you, the members you ask to review, and its admins and maintainers can read it.
              Nobody else can.
            </li>
          ) : target.locked ? (
            <li>
              {target.name} is locked, so its {fmt(target.members.length)} members can read it, and nobody else. Reviewers you asked who aren’t members lose access.
            </li>
          ) : (
            <li>Everyone can read it, like any other idea. It stops being private.</li>
          )}
          <li>{target.name}’s approval requirements apply{hasRequirements(target.requirements) ? ` (${requirementChecks(state.groups, target.requirements).length})` : ' (it has none)'}.</li>
          {autoGroups.length > 0 && (
            <li>
              {idea.status === 'draft' ? 'When it leaves draft, ' : ''}
              {autoGroups.map((g) => state.groups.find((x) => x.id === g)?.name).join(' and ')} {idea.status === 'draft' ? (autoGroups.length === 1 ? 'is' : 'are') : autoGroups.length === 1 ? 'is' : 'are'} added
              as {autoGroups.length === 1 ? 'a reviewer' : 'reviewers'}
              {idea.status === 'draft' ? '' : ' straight away'}, because {target.name} adds {autoGroups.length === 1 ? 'it' : 'them'} automatically.
            </li>
          )}
          <li>People watching {target.name} start hearing about it.</li>
          <li>Its history, comments and reviewers come with it.</li>
        </ul>
      ) : (
        <p className="hint">Moving shares it: the idea leaves your private space and joins the team.</p>
      )}
    </Dialog>
  )
}
