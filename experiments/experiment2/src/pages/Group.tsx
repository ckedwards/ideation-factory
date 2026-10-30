// PROTOTYPE: a group's page. Name, description, members (with roles), and
// where the group is used: team approval requirements and ideas it reviews.
import { Link, useParams } from '@tanstack/react-router'
import { useStore } from '../store'
import { ago, usesGroup, canMaintain, canSee, isActive, maintainViaSite, noActiveAdmin, ruleBroken, ruleText } from '../model'
import { Empty, IdeaRow, PageHeader, fmt } from '../ui'
import { MembersList, MembershipButton } from './members'

export function GroupPage() {
  const { groupId } = useParams({ strict: false }) as { groupId: string }
  const { state } = useStore()
  const group = state.groups.find((g) => g.id === groupId)
  if (!group)
    return (
      <div className="page">
        <PageHeader title="Group not found" />
        <Empty>
          There’s no group called “{groupId}”. <Link to="/groups">Browse groups</Link>
        </Empty>
      </div>
    )

  const usedBy = state.teams
    .filter((t) => !t.archivedAt)
    .flatMap((t) =>
      usesGroup(t, group.id).map((r) => ({ team: t, rule: r })),
    )
  const reviewing = state.ideas.filter((i) => canSee(state, i) && isActive(state, i) && i.reviewers.some((r) => r.kind === 'group' && r.groupId === group.id))
  const deleted = !!group.deletedAt

  return (
    <div className="page page-wide">
      <div className="crumbs">
        <Link to="/groups">Groups</Link> / {group.name}
      </div>
      <PageHeader
        title={
          <>
            {group.name} {deleted && <span className="tag tag-deleted">Deleted</span>}
            {!deleted && group.joinPolicy === 'invite' && <span className="tag">Invite only</span>}
          </>
        }
        sub={
          <>
            {group.description || 'No description.'} Created by {state.users[group.createdBy]?.name} · {ago(group.createdAt)}
          </>
        }
        actions={
          !deleted && (
            <div className="team-actions is-big">
              {canMaintain(state, group) && (
                <Link
                  className={`button ${maintainViaSite(state, group) ? 'via-admin' : ''}`}
                  to="/groups/$groupId/settings"
                  params={{ groupId: group.id }}
                  title={maintainViaSite(state, group) ? 'You’re not an admin or maintainer here. This is open to you only as a site admin.' : undefined}
                >
                  Settings
                </Link>
              )}
              <MembershipButton entity="group" m={group} />
            </div>
          )
        }
      />

      {deleted && (
        <div className="banner banner-error" role="alert">
          <b>This group was deleted {ago(group.deletedAt!)} by {state.users[group.deletedBy!]?.name ?? 'an admin'}.</b> It can’t review ideas or count
          toward approval requirements.
          {(() => {
            const n = usedBy.filter((u) => ruleBroken(state.groups, u.rule)).length
            return n > 0 ? ` ${n} team requirement${n === 1 ? ' needs' : 's need'} fixing (below).` : ''
          })()}
        </div>
      )}

      {!deleted && noActiveAdmin(state, group) && (
        <div className="banner banner-warn" role="status">
          <b>{group.name} has no active admin.</b> Until a site admin makes someone else an admin, nobody can change its settings or delete it.
          {state.siteAdmin && (
            <>
              {' '}
              <Link className="via-admin" to="/groups/$groupId/settings" params={{ groupId: group.id }} search={{ tab: 'members' } as never}>
                Pick a new admin →
              </Link>
            </>
          )}
        </div>
      )}

      <div className="team-grid">
        <div className="section-stack">
          <section className="section">
            <h2>
              Used in approval requirements <span className="muted">{usedBy.length}</span>
            </h2>
            {usedBy.length === 0 ? (
              <p className="hint">No team requires an approval from this group.</p>
            ) : (
              <ul className="usage">
                {usedBy.map(({ team, rule }, i) => (
                  <li key={i} className={deleted ? (ruleBroken(state.groups, rule) ? 'is-broken' : 'is-warning') : ''}>
                    <Link to="/teams/$teamId" params={{ teamId: team.id }}>
                      {team.name}
                    </Link>
                    : {ruleText(state.groups, rule)}
                    {deleted &&
                      (ruleBroken(state.groups, rule) ? (
                        <span className="hint"> · a maintainer or admin of {team.name} needs to replace this group</span>
                      ) : (
                        <span className="hint"> · still works through the other groups</span>
                      ))}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="section">
            <h2>
              Reviewing <span className="muted">{fmt(reviewing.length)} active idea{reviewing.length === 1 ? '' : 's'}</span>
            </h2>
            <div className="card-list">
              {reviewing.slice(0, 5).map((i) => (
                <IdeaRow key={i.id} idea={i} hide={{ groupId: group.id }} />
              ))}
            </div>
            {reviewing.length > 5 && <p className="hint">And {fmt(reviewing.length - 5)} more.</p>}
            {reviewing.length === 0 && <p className="hint">Not reviewing any active ideas.</p>}
          </section>
        </div>

        <aside>
          <section className="section">
            <h2>
              Members <span className="muted">{fmt(group.members.length)}</span>
            </h2>
            <MembersList m={group} />
          </section>
        </aside>
      </div>
    </div>
  )
}
