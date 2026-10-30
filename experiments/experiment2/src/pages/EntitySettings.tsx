// PROTOTYPE: settings pages for a team (/teams/:id/settings) and a group
// (/groups/:id/settings). Pages, not popups. What you see depends on your role:
//   admins (and site admins): General, Members, Requirements, Archive / Delete
//   maintainers: Members (requests, adding, removing members), Requirements
//   everyone else: no access
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { ME, type Group, type Requirements as RequirementsT, type Rule, type Team } from '../data'
import { useStore, type Entity, type Role } from '../store'
import { adminViaSite, requirementChecks, usesGroup, ago, canAdmin, canMaintain, deletedIn, maintainViaSite, ownAdmin, isActive, isArchived, isOpen, roleOf, ruleBroken, ruleText } from '../model'
import { rank } from '../search'
import { AdminCallout, AdminMark, Avatar, Combobox, Dialog, Empty, InactiveTag, PageHeader, SearchInput, fmt, useGroupSearch, usePaged, useParam, usePeopleSearch, useSetParams } from '../ui'
import { RoleTag } from './members'

type Tab = 'general' | 'members' | 'requirements' | 'archive' | 'delete' | 'erase'

export function TeamSettings() {
  const { teamId } = useParams({ strict: false }) as { teamId: string }
  const { state } = useStore()
  const team = state.teams.find((t) => t.id === teamId)
  if (!team) return <Missing what="team" id={teamId} />
  if (team.personal)
    return (
      <div className="page">
        <PageHeader title="No settings" />
        <Empty>“Your ideas” is a private space, not a team, so there’s nothing to configure.</Empty>
      </div>
    )
  return <SettingsShell entity="team" m={team} />
}

// ---------- new team or group: set up through the settings page ----------
// Step 1 is the General form, on its own page (/teams/new, /groups/new). Creating
// it moves you into its real settings with a guide above the tabs:
//   group: 1 Name and access ✓ · 2 Members · Finish → the group's page
//   team:  1 Name and access ✓ · 2 Members · 3 Approval requirements · Finish
// Everything stays changeable later from the same settings.

const SETUP_STEPS: Record<Entity, { tab: Tab; label: string }[]> = {
  group: [
    { tab: 'general', label: 'Name and access' },
    { tab: 'members', label: 'Members' },
  ],
  team: [
    { tab: 'general', label: 'Name and access' },
    { tab: 'members', label: 'Members' },
    { tab: 'requirements', label: 'Approval requirements' },
  ],
}
export const setupTabs = (entity: Entity) => SETUP_STEPS[entity].map((x) => x.tab)

// an id from the name that collides with nothing (nor with the /new pages)
function newId(taken: (id: string) => boolean, name: string, fallback: string) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback
  const used = (id: string) => id === 'new' || taken(id)
  if (!used(base)) return base
  for (let n = 2; ; n++) if (!used(`${base}-${n}`)) return `${base}-${n}`
}

export const NewGroup = () => <NewEntity entity="group" />
export const NewTeam = () => <NewEntity entity="team" />

function NewEntity({ entity }: { entity: Entity }) {
  const { state, dispatch } = useStore()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [policy, setPolicy] = useState<'open' | 'invite'>('open')
  const [locked, setLocked] = useState(false)
  const [memberSees, setMemberSees] = useState<'all' | 'assigned'>('assigned')
  const trimmed = name.trim()
  const pool: { id: string; name: string; deletedAt?: string }[] = entity === 'team' ? state.teams.filter((t) => !t.personal) : state.groups
  const taken = pool.some((x) => !x.deletedAt && x.name.toLowerCase() === trimmed.toLowerCase())
  const valid = trimmed.length > 0 && !taken
  const create = () => {
    if (!valid) return
    const id = newId((x) => (entity === 'team' ? state.teams : state.groups).some((m) => m.id === x), trimmed, entity)
    if (entity === 'team') {
      dispatch({ type: 'createTeam', id, name: trimmed, description: description.trim(), joinPolicy: locked ? 'invite' : policy, locked, memberSees })
      navigate({ to: '/teams/$teamId/settings', params: { teamId: id }, search: { tab: 'members', setup: 'yes' } } as never)
    } else {
      dispatch({ type: 'createGroup', id, name: trimmed, description: description.trim(), joinPolicy: policy })
      navigate({ to: '/groups/$groupId/settings', params: { groupId: id }, search: { tab: 'members', setup: 'yes' } } as never)
    }
  }
  const list = entity === 'team' ? '/teams' : '/groups'
  return (
    <div className="page">
      <div className="crumbs">
        <Link to={list}>{entity === 'team' ? 'Teams' : 'Groups'}</Link> / New {entity}
      </div>
      <PageHeader
        title={`New ${entity}`}
        sub={
          entity === 'team'
            ? 'A team holds ideas, and sets who approves them. Anyone can create one, and you’ll be its admin.'
            : 'A group bundles people so an idea can ask all of them for review at once. Anyone can create one, and you’ll be its admin.'
        }
      />
      <SetupSteps entity={entity} current="general" />
      <form
        className="section settings-form"
        onSubmit={(e) => {
          e.preventDefault()
          create()
        }}
      >
        <label className="field">
          <span className="field-label">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={entity === 'team' ? 'e.g. Field Ops' : 'e.g. Sync reviewers'} maxLength={60} autoFocus />
          {taken && <span className="field-error">A {entity} with this name already exists.</span>}
        </label>
        <label className="field">
          <span className="field-label">
            Description <span className="muted">(optional)</span>
          </span>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={entity === 'team' ? 'What kind of ideas belong here?' : 'Who should ask this group for review?'}
          />
        </label>
        {entity === 'team' && (
          <fieldset className="field purpose">
            <legend className="field-label">Who can see its ideas</legend>
            {(
              [
                [false, 'Everyone', 'Anyone can read its ideas, search them and watch the team, member or not.'],
                [true, '🔒 Locked', 'Only members can see its ideas or get notifications about them. Locked teams are invite only, and their reviewers are people, never groups.'],
              ] as const
            ).map(([id, label, blurb]) => (
              <label key={String(id)} className={`purpose-option ${locked === id ? 'on' : ''}`}>
                <input type="radio" name="locked" checked={locked === id} onChange={() => setLocked(id)} />
                <span className="purpose-text">
                  <b>{label}</b>
                  <span className="hint">{blurb}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {entity === 'team' && locked && <MemberSeesField value={memberSees} onChange={setMemberSees} />}
        <fieldset className="field purpose" disabled={locked}>
          <legend className="field-label">Who can join{locked && <span className="hint"> · locked teams are invite only</span>}</legend>
          {(
            [
              ['open', 'Anyone', `Anyone can join the ${entity} straight away.`],
              ['invite', 'Invite only', 'People ask to join, and a maintainer or admin approves or denies. Maintainers and admins can also add people directly.'],
            ] as const
          ).map(([id, label, blurb]) => (
            <label key={id} className={`purpose-option ${(locked ? 'invite' : policy) === id ? 'on' : ''}`}>
              <input type="radio" name="policy" checked={(locked ? 'invite' : policy) === id} onChange={() => setPolicy(id)} />
              <span className="purpose-text">
                <b>{label}</b>
                <span className="hint">{blurb}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="row-end">
          <Link className="button ghost" to={list}>
            Cancel
          </Link>
          <button className="primary" type="submit" disabled={!valid}>
            Create and add members →
          </button>
        </div>
      </form>
    </div>
  )
}

// Locked teams only: what plain members see. Admins and maintainers always see
// every idea.
function MemberSeesField({ value, onChange }: { value: 'all' | 'assigned'; onChange: (v: 'all' | 'assigned') => void }) {
  return (
    <fieldset className="field purpose sub-field">
      <legend className="field-label">What members see</legend>
      <span className="hint">Admins and maintainers always see every idea in the team.</span>
      {(
        [
          ['assigned', 'Only ideas they’re on', 'Members see the ideas they wrote or are asked to review, and nothing else, not even how many others there are. Taking someone off an idea’s reviewers takes their access away.'],
          ['all', 'Every idea in the team', 'Every member can read every idea, and watch the team.'],
        ] as const
      ).map(([id, label, blurb]) => (
        <label key={id} className={`purpose-option ${value === id ? 'on' : ''}`}>
          <input type="radio" name="memberSees" checked={value === id} onChange={() => onChange(id)} />
          <span className="purpose-text">
            <b>{label}</b>
            <span className="hint">{blurb}</span>
          </span>
        </label>
      ))}
    </fieldset>
  )
}

// The step list above a new team's or group's settings. Steps are links once it
// exists; "Next" moves on, and Finish opens its page.
function SetupSteps({ entity, current, m }: { entity: Entity; current: Tab; m?: Team | Group }) {
  const setParams = useSetParams()
  const steps = SETUP_STEPS[entity]
  const at = steps.findIndex((x) => x.tab === current)
  const next = steps[at + 1]
  return (
    <ol className="setup-steps" aria-label={`Setting up your ${entity}`}>
      {steps.map((step, i) => {
        const done = !!m && (i < at || step.tab === 'general')
        const label = (
          <>
            <span className="setup-num" aria-hidden>
              {done && step.tab !== current ? '✓' : i + 1}
            </span>
            {step.label}
          </>
        )
        return (
          <li key={step.tab} className={`${step.tab === current ? 'is-current' : ''} ${done ? 'is-done' : ''}`} aria-current={step.tab === current ? 'step' : undefined}>
            {m && step.tab !== current ? (
              <button className="link" onClick={() => setParams({ tab: step.tab })}>
                {label}
              </button>
            ) : (
              label
            )}
          </li>
        )
      })}
      <li className="setup-finish">
        {!m ? (
          <span className="muted">Then finish</span>
        ) : (
          <>
            {next && (
              <button className={current === 'general' ? 'ghost' : 'primary'} onClick={() => setParams({ tab: next.tab })}>
                Next: {next.label} →
              </button>
            )}
            {entity === 'team' && current === 'requirements' ? (
              // the editor's own "Save and finish" ends setup, so nothing is lost unsaved
              <span className="muted">Finish below</span>
            ) : entity === 'team' ? (
              <Link className={`button ${next ? 'ghost' : 'primary'}`} to="/teams/$teamId" params={{ teamId: m.id }}>
                Finish
              </Link>
            ) : (
              <Link className={`button ${next ? 'ghost' : 'primary'}`} to="/groups/$groupId" params={{ groupId: m.id }}>
                Finish
              </Link>
            )}
          </>
        )}
      </li>
    </ol>
  )
}

export function GroupSettings() {
  const { groupId } = useParams({ strict: false }) as { groupId: string }
  const { state } = useStore()
  const group = state.groups.find((g) => g.id === groupId)
  if (!group) return <Missing what="group" id={groupId} />
  return <SettingsShell entity="group" m={group} />
}

function Missing({ what, id }: { what: string; id: string }) {
  return (
    <div className="page">
      <PageHeader title={`No such ${what}`} />
      <Empty>There’s no {what} called “{id}”.</Empty>
    </div>
  )
}

function SettingsShell({ entity, m }: { entity: Entity; m: Team | Group }) {
  const { state } = useStore()
  const admin = canAdmin(state, m)
  const maintain = canMaintain(state, m)
  // `via`: open to you only because you're a site admin (called out in the UI)
  const viaAdmin = adminViaSite(state, m)
  const viaMaintain = maintainViaSite(state, m)
  const tabs: { id: Tab; label: string; via: boolean }[] = [
    ...(admin ? [{ id: 'general' as Tab, label: 'General', via: viaAdmin }] : []),
    ...(maintain ? [{ id: 'members' as Tab, label: `Members${m.requests.length ? ` · ${m.requests.length} waiting` : ''}`, via: viaMaintain }] : []),
    ...(maintain && entity === 'team' ? [{ id: 'requirements' as Tab, label: 'Approval requirements', via: viaMaintain }] : []),
    ...(admin && entity === 'team' ? [{ id: 'archive' as Tab, label: (m as Team).archivedAt ? 'Archived' : 'Archive', via: viaAdmin }] : []),
    ...(admin && entity === 'group' ? [{ id: 'delete' as Tab, label: 'Delete', via: viaAdmin }] : []),
    ...(state.siteAdmin && entity === 'team' ? [{ id: 'erase' as Tab, label: 'Delete permanently', via: true }] : []),
  ]
  // open on what your own role gives you; site-admin-only tabs come second
  const home = tabs.find((t) => !t.via) ?? tabs[0]
  const [raw, setTab] = useParam<string>('tab', home?.id ?? 'general')
  const [setupParam] = useParam<string>('setup', '')
  const setup = setupParam === 'yes' && admin
  const tab = (tabs.find((t) => t.id === raw)?.id ?? home?.id) as Tab | undefined
  const back =
    entity === 'team' ? (
      <Link to="/teams/$teamId" params={{ teamId: m.id }}>
        {m.name}
      </Link>
    ) : (
      <Link to="/groups/$groupId" params={{ groupId: m.id }}>
        {m.name}
      </Link>
    )
  const myRole = state.siteAdmin && !m.admins.includes(ME) ? 'site admin' : roleOf(m, ME)

  if (!maintain || (entity === 'group' && (m as Group).deletedAt))
    return (
      <div className="page">
        <div className="crumbs">
          {entity === 'team' ? <Link to="/teams">Teams</Link> : <Link to="/groups">Groups</Link>} / {back} / Settings
        </div>
        <PageHeader title="Settings" />
        <Empty>
          {(m as Group).deletedAt
            ? 'This group was deleted, so there’s nothing to change.'
            : `Only maintainers and admins of ${m.name} (and site admins) can open its settings.`}
        </Empty>
      </div>
    )

  return (
    <div className="page">
      <div className="crumbs">
        {entity === 'team' ? <Link to="/teams">Teams</Link> : <Link to="/groups">Groups</Link>} / {back} / Settings
      </div>
      <PageHeader
        title={setup ? `Set up ${m.name}` : `${m.name} settings`}
        sub={
          setup ? (
            entity === 'team' ? (
              <>Your team is created and you’re its admin. Add its members, then decide who has to approve its ideas. You can change all of this later in its settings.</>
            ) : (
              <>Your group is created and you’re its admin. Add the people who should review as {m.name}. You can change all of this later in its settings.</>
            )
          ) : viaMaintain ? undefined : (
            <>
              You’re {roleOf(m, ME) === 'admin' ? 'an' : 'a'} {roleOf(m, ME)} here{!ownAdmin(m) && ', so you can manage members and requirements'}.
            </>
          )
        }
      />
      {viaMaintain && (
        <AdminCallout title={`You’re here as a site admin`}>
          You’re not a maintainer or admin of {m.name}. Everything on this page is open to you only because you’re a site admin, and changes are logged as
          site admin actions.
        </AdminCallout>
      )}
      {!viaMaintain && viaAdmin && (
        <AdminCallout title="Some tabs are site admin only">
          The tabs marked 🛡 are open to you only because you’re a site admin. As a {roleOf(m, ME)} you’d normally just see Members
          {entity === 'team' ? ' and Approval requirements' : ''}.
        </AdminCallout>
      )}
      {setup && tab && setupTabs(entity).includes(tab) && <SetupSteps entity={entity} current={tab} m={m} />}
      <div className={`tabs ${setup ? 'is-setup' : ''}`} role="tablist">
        {tabs.filter((t) => !setup || setupTabs(entity).includes(t.id)).map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`${tab === t.id ? 'on' : ''} ${t.id === 'delete' || t.id === 'archive' || t.id === 'erase' ? 'tab-danger' : ''} ${t.via ? 'via-admin' : ''}`}
            title={t.via ? 'Open to you only because you’re a site admin' : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {/* keyed by id: going from one team's settings to another's starts each form fresh */}
      <div key={`${entity}-${m.id}`} className="settings-body">
        {tab === 'general' && <General entity={entity} m={m} />}
        {tab === 'members' && <MembersAdmin entity={entity} m={m} setup={setup} />}
        {tab === 'requirements' && <Requirements team={m as Team} setup={setup} />}
        {tab === 'archive' && <Archive team={m as Team} />}
        {tab === 'delete' && <DeleteGroup group={m as Group} />}
        {tab === 'erase' && <DeleteTeam team={m as Team} />}
      </div>
    </div>
  )
}

// ---------- general (admins) ----------

function General({ entity, m }: { entity: Entity; m: Team | Group }) {
  const { state, dispatch } = useStore()
  const [name, setName] = useState(m.name)
  const [description, setDescription] = useState(m.description)
  const [policy, setPolicy] = useState(m.joinPolicy)
  const wasLocked = entity === 'team' && !!(m as Team).locked
  const [locked, setLocked] = useState(wasLocked)
  // undefined on an existing locked team means everyone sees everything; newly locked teams start at "only ideas they're on"
  const wasSees = entity === 'team' ? ((m as Team).memberSees ?? (wasLocked ? 'all' : 'assigned')) : 'all'
  const [memberSees, setMemberSees] = useState<'all' | 'assigned'>(wasSees)
  const dirty =
    name.trim() !== m.name || description.trim() !== m.description || policy !== m.joinPolicy || locked !== wasLocked || (locked && memberSees !== wasSees)
  const plainMembers = m.members.filter((id) => !m.admins.includes(id) && !m.maintainers.includes(id)).length
  const teamIdeas = entity === 'team' ? state.ideas.filter((i) => i.teamId === m.id).length : 0
  // locked teams can't use groups: requirements must be fixed first (dropping
  // them silently would loosen approval), group review requests are removed
  const groupRules = entity === 'team' ? (m as Team).requirements.groups.length : 0
  const groupReviews = entity === 'team' ? state.ideas.filter((i) => i.teamId === m.id && isOpen(state, i) && i.reviewers.some((r) => r.kind === 'group')).length : 0
  const blocked = locked && !wasLocked && groupRules > 0
  const valid = name.trim().length > 0
  return (
    <section className="section settings-form">
      <label className="field">
        <span className="field-label">Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      </label>
      <label className="field">
        <span className="field-label">Description</span>
        <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      {entity === 'team' && (
        <fieldset className="field purpose">
          <legend className="field-label">Who can see its ideas</legend>
          {(
            [
              [false, 'Everyone', 'Anyone can read its ideas, search them and watch the team, member or not.'],
              [true, '🔒 Locked', 'Only members can see its ideas or get notifications about them. The team is still listed and anyone can see its members. Removing someone takes their access away. Locked teams are always invite only, and reviewers are people, never groups.'],
            ] as const
          ).map(([id, label, blurb]) => (
            <label key={String(id)} className={`purpose-option ${locked === id ? 'on' : ''}`}>
              <input type="radio" name="locked" checked={locked === id} onChange={() => setLocked(id)} />
              <span className="purpose-text">
                <b>{label}</b>
                <span className="hint">{blurb}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {entity === 'team' && locked && <MemberSeesField value={memberSees} onChange={setMemberSees} />}
      {wasLocked && locked && memberSees !== wasSees && (
        <div className="banner banner-warn">
          {memberSees === 'assigned' ? (
            <>
              <b>
                {fmt(plainMembers)} member{plainMembers === 1 ? '' : 's'} will only see the ideas they wrote or review
              </b>
              , and stop getting notifications about the rest, straight away. Admins and maintainers keep seeing everything.
            </>
          ) : (
            <>
              <b>Every member will see all {fmt(teamIdeas)} of {m.name}’s ideas</b>, including ones they aren’t on.
            </>
          )}
        </div>
      )}
      {blocked && (
        <div className="banner banner-error" role="alert">
          <b>
            {m.name}’s approval requirements use groups ({groupRules} group rule{groupRules === 1 ? '' : 's'}).
          </b>{' '}
          Locked teams can’t use groups, so remove its group rules first (a minimum number of approvals and resolved discussions are fine).{' '}
          <Link to="/teams/$teamId/settings" params={{ teamId: m.id }} search={{ tab: 'requirements' } as never}>
            Change requirements →
          </Link>
        </div>
      )}
      {locked && !wasLocked && !blocked && (
        <div className="banner banner-warn">
          <b>Locking hides {fmt(teamIdeas)} idea{teamIdeas === 1 ? '' : 's'} from everyone who isn’t one of the {fmt(m.members.length)} members</b>, including
          people who wrote or review them, and stops their notifications. Anyone who already copied or linked them keeps what they have.
          {groupReviews > 0 && (
            <>
              {' '}
              <b>
                Group review requests on {fmt(groupReviews)} open idea{groupReviews === 1 ? '' : 's'} are removed
              </b>
              , since locked teams only take people as reviewers. Ask members directly instead.
            </>
          )}
        </div>
      )}
      {!locked && wasLocked && (
        <div className="banner banner-warn">
          <b>Unlocking makes {fmt(teamIdeas)} idea{teamIdeas === 1 ? '' : 's'} readable by everyone</b>, along with their history and comments.
        </div>
      )}
      <fieldset className="field purpose" disabled={locked}>
        <legend className="field-label">Who can join{locked && <span className="hint"> · locked teams are invite only</span>}</legend>
        {(
          [
            ['open', 'Anyone', `Anyone can join the ${entity} straight away.`],
            ['invite', 'Invite only', 'People ask to join, and a maintainer or admin approves or denies. Maintainers and admins can also add people directly.'],
          ] as const
        ).map(([id, label, blurb]) => (
          <label key={id} className={`purpose-option ${(locked ? 'invite' : policy) === id ? 'on' : ''}`}>
            <input type="radio" name="policy" checked={(locked ? 'invite' : policy) === id} onChange={() => setPolicy(id)} />
            <span className="purpose-text">
              <b>{label}</b>
              <span className="hint">{blurb}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {policy === 'open' && m.requests.length > 0 && m.joinPolicy === 'invite' && (
        <p className="hint">The {m.requests.length} pending request{m.requests.length === 1 ? '' : 's'} stay until a maintainer approves or denies them.</p>
      )}
      <div className="row-end">
        <button
          className="ghost"
          disabled={!dirty}
          onClick={() => {
            setName(m.name)
            setDescription(m.description)
            setPolicy(m.joinPolicy)
            setLocked(wasLocked)
            setMemberSees(wasSees)
          }}
        >
          Discard
        </button>
        <button
          className="primary"
          disabled={!dirty || !valid || blocked}
          onClick={() => {
            dispatch({ type: 'updateInfo', entity, id: m.id, name: name.trim(), description: description.trim(), joinPolicy: policy, locked, memberSees })
            dispatch({ type: 'toast', text: 'Settings saved' })
          }}
        >
          Save
        </button>
      </div>
    </section>
  )
}

// ---------- members (maintainers and admins) ----------

function MembersAdmin({ entity, m, setup }: { entity: Entity; m: Team | Group; setup?: boolean }) {
  const { state, dispatch } = useStore()
  const admin = canAdmin(state, m)
  const people = usePeopleSearch(m.members, true)
  const [q, setQ] = useState('')
  const ordered = useMemo(() => {
    const order = (id: string) => (m.admins.includes(id) ? 0 : m.maintainers.includes(id) ? 1 : 2)
    const sorted = [...m.members].sort((a, b) => order(a) - order(b) || (state.users[a]?.name ?? '').localeCompare(state.users[b]?.name ?? ''))
    return q.trim()
      ? rank(sorted.map((id) => state.users[id]).filter(Boolean), q.replace(/^@/, ''), (u) => [
          { name: 'name', text: u.name, weight: 0 },
          { name: 'handle', text: u.handle, weight: 1 },
        ]).map((r) => r.item.id)
      : sorted
  }, [m, q, state.users])
  const { slice, pager } = usePaged(ordered)
  const lastAdmin = (id: string) => m.admins.length === 1 && m.admins[0] === id
  const toast = (text: string) => dispatch({ type: 'toast', text })
  // removing someone from a locked team revokes access, so it's confirmed
  const locked = entity === 'team' && !!(m as Team).locked
  const [removing, setRemoving] = useState<string | null>(null)
  const remove = (id: string) => {
    dispatch({ type: 'removeMember', entity, id: m.id, userId: id })
    toast(locked ? `Removed ${state.users[id]?.name}. They can’t see ${m.name}’s ideas any more.` : `Removed ${state.users[id]?.name}`)
    setRemoving(null)
  }

  return (
    <>
      {/* a brand-new group has no requests yet, so setup skips straight to adding people */}
      {!(setup && m.requests.length === 0) && (
      <section className="section">
        <h2>
          Requests to join <span className="muted">{m.requests.length}</span>
        </h2>
        {m.joinPolicy === 'open' && m.requests.length === 0 && <p className="hint">This {entity} is open, so people join without asking.</p>}
        {m.joinPolicy === 'invite' && m.requests.length === 0 && <p className="hint">No one is waiting.</p>}
        <div className="card-list">
          {m.requests.map((r) => (
            <div key={r.userId} className="request-row">
              <Avatar userId={r.userId} />
              <div className="request-main">
                <InactiveTag userId={r.userId} />
                <b>{state.users[r.userId]?.name}</b> <span className="muted">@{state.users[r.userId]?.handle} · asked {ago(r.at)}</span>
                {r.note && <p className="request-note">“{r.note}”</p>}
              </div>
              <button
                className="primary"
                onClick={() => {
                  dispatch({ type: 'decide', entity, id: m.id, userId: r.userId, approve: true })
                  toast(`Approved ${state.users[r.userId]?.name}`)
                }}
              >
                Approve
              </button>
              <button
                onClick={() => {
                  dispatch({ type: 'decide', entity, id: m.id, userId: r.userId, approve: false })
                  toast(`Denied ${state.users[r.userId]?.name}’s request`)
                }}
              >
                Deny
              </button>
            </div>
          ))}
        </div>
      </section>
      )}

      <section className="section">
        <h2>Add people</h2>
        <div className="add-people">
          <Combobox
            label="Add a person"
            anyLabel="Search by name or @handle"
            placeholder="Try an @handle."
            value=""
            onChange={(id) => {
              if (!id) return
              dispatch({ type: 'addMember', entity, id: m.id, userId: id })
              toast(`Added ${state.users[id]?.name}`)
            }}
            search={people.search}
            display={people.option}
          />
          <span className="hint">
            {setup ? `They’re added straight away, as members. You’re already in it. Make someone a maintainer below to share approving requests.` : 'They’re added straight away, as members.'}
          </span>
        </div>
      </section>

      <section className="section">
        <h2>
          Members <span className="muted">{fmt(m.members.length)}</span>
        </h2>
        {admin && adminViaSite(state, m) ? (
          <AdminCallout title="Changing roles is a site admin action here">
            You’re not an admin of {m.name}, so the role menus and removing maintainers or admins are available only because you’re a site admin. There must
            always be at least one admin.
          </AdminCallout>
        ) : (
          <p className="hint">
            {admin
              ? 'As an admin you can change anyone’s role. There must always be at least one admin.'
              : 'As a maintainer you can add and remove members. Only admins change roles or remove maintainers and admins.'}
          </p>
        )}
        <SearchInput value={q} onChange={setQ} placeholder="Find a member" label="Find a member" />
        <div className="member-table" role="table">
          {slice.map((id) => {
            const role = roleOf(m, id) as Role
            const canRemove = admin ? !lastAdmin(id) : role === 'member'
            return (
              <div key={id} className="member-row" role="row">
                <span role="cell" className="actor">
                  <Avatar userId={id} size="sm" />
                  <span>
                    <b>{state.users[id]?.name}</b> <span className="muted">@{state.users[id]?.handle}</span>
                  </span>
                  <InactiveTag userId={id} />
                </span>
                <span role="cell">
                  {admin ? (
                    <select
                      className={adminViaSite(state, m) ? 'via-admin' : ''}
                      value={role}
                      disabled={lastAdmin(id)}
                      title={lastAdmin(id) ? 'The only admin. Make someone else an admin first.' : undefined}
                      onChange={(e) => {
                        dispatch({ type: 'setRole', entity, id: m.id, userId: id, role: e.target.value as Role })
                        toast(`${state.users[id]?.name} is now ${e.target.value === 'member' ? 'a member' : `a${e.target.value === 'admin' ? 'n' : ''} ${e.target.value}`}`)
                      }}
                      aria-label={`Role for ${state.users[id]?.name}`}
                    >
                      <option value="member">Member</option>
                      <option value="maintainer">Maintainer</option>
                      <option value="admin">Admin</option>
                    </select>
                  ) : (
                    <RoleTag m={m} userId={id} />
                  )}
                </span>
                <span role="cell">
                  <button
                    className="ghost danger"
                    disabled={!canRemove}
                    title={canRemove ? undefined : admin ? 'The only admin can’t be removed.' : 'Only admins can remove maintainers and admins.'}
                    onClick={() => (locked ? setRemoving(id) : remove(id))}
                  >
                    Remove
                  </button>
                </span>
              </div>
            )
          })}
        </div>
        {pager}
      </section>
      {removing && <RemoveLockedDialog team={m as Team} userId={removing} onCancel={() => setRemoving(null)} onRemove={() => remove(removing)} />}
    </>
  )
}

function RemoveLockedDialog({ team, userId, onCancel, onRemove }: { team: Team; userId: string; onCancel: () => void; onRemove: () => void }) {
  const { state } = useStore()
  const name = state.users[userId]?.name ?? 'them'
  const ideas = state.ideas.filter((i) => i.teamId === team.id)
  const wrote = ideas.filter((i) => i.authorId === userId).length
  const reviews = ideas.filter((i) => isOpen(state, i) && i.reviewers.some((r) => r.kind === 'user' && r.userId === userId)).length
  return (
    <Dialog
      title={`Remove ${name} from ${team.name}?`}
      onClose={onCancel}
      footer={
        <>
          <button className="ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="danger-solid" onClick={onRemove}>
            Remove and revoke access
          </button>
        </>
      }
    >
      <ul className="consequences">
        <li>
          <b>
            {team.name} is locked, so {name} loses access to its {fmt(ideas.length)} idea{ideas.length === 1 ? '' : 's'} straight away
          </b>
          {wrote || reviews ? (
            <>
              , including {[wrote && `${fmt(wrote)} they wrote`, reviews && `${fmt(reviews)} they’re reviewing`].filter(Boolean).join(' and ')}
            </>
          ) : null}
          .
        </li>
        <li>Their notifications about those ideas disappear, and they stop getting new ones.</li>
        <li>What they already wrote (comments, versions, approvals) stays, still credited to them.</li>
        <li>To give access back, add them to the team again.</li>
      </ul>
    </Dialog>
  )
}

// ---------- approval requirements (teams; maintainers and admins) ----------

// Three kinds of requirement, always in this order:
//   minimum approvals (always shown; 0 = no minimum)
//   group rules: "one approval from any of" (or) / "an approval from each of" (and).
//     One group works in either, so the and/or choice only shows with two or more.
//   all discussions resolved
function Requirements({ team, setup }: { team: Team; setup?: boolean }) {
  const { state, dispatch } = useStore()
  const navigate = useNavigate()
  const [req, setReq] = useState<RequirementsT>(team.requirements)
  const groupSearch = useGroupSearch()
  const setRule = (i: number, r: Rule) => setReq({ ...req, groups: req.groups.map((x, j) => (j === i ? r : x)) })
  const ruleValid = (r: Rule) => r.groupIds.length >= 1 && !ruleBroken(state.groups, r)
  const valid = req.minApprovals >= 0 && req.groups.every(ruleValid)
  const dirty = JSON.stringify(req) !== JSON.stringify(team.requirements)
  const active = state.ideas.filter((i) => i.teamId === team.id && isActive(state, i)).length
  const preview = requirementChecks(state.groups, req).filter((c) => !c.rule || ruleValid(c.rule))
  const openThreads = state.ideas.filter((i) => i.teamId === team.id && isActive(state, i) && i.openThreads > 0).length

  if (team.archivedAt) return <p className="hint">{team.name} is archived, so its requirements can’t change.</p>

  return (
    <section className="section settings-form req-form">
      <p className="hint">
        An idea in {team.name} is approved once everything below holds.
        {active > 0 && ` Changes apply to the ${fmt(active)} active idea${active === 1 ? '' : 's'} straight away.`}
      </p>

      <div className="req-block">
        <h3>Minimum approvals</h3>
        <label className="rule-count">
          At least
          <input
            type="number"
            min={0}
            max={20}
            value={req.minApprovals}
            onChange={(e) => setReq({ ...req, minApprovals: Math.max(0, Math.min(20, Math.floor(Number(e.target.value) || 0))) })}
            aria-label="Minimum approvals"
          />
          approval{req.minApprovals === 1 ? '' : 's'} in total, from anyone
        </label>
        <p className="hint">{req.minApprovals === 0 ? '0 means no minimum.' : 'Approvals from anyone count, including people in the groups below.'}</p>
      </div>

      <div className="req-block">
        <h3>Group approvals</h3>
        {team.locked ? (
          <p className="hint">{team.name} is locked, so it can’t use groups. Reviewers are always people.</p>
        ) : (
          <>
            <p className="hint">
              Requirements name groups rather than people, so they keep working as people come and go. Each rule is either <b>any of</b> its groups (or)
              or <b>each of</b> them (and). With one group they’re the same.
            </p>
            {req.groups.map((r, i) => {
              const gone = deletedIn(state.groups, r)
              const broken = ruleBroken(state.groups, r)
              const goneNames = gone.map((g) => state.groups.find((x) => x.id === g)?.name ?? g).join(', ')
              return (
                <div key={i} className={`rule-edit ${broken ? 'is-broken' : gone.length ? 'is-warning' : ''}`}>
                  <div className="rule-edit-head">
                    {r.groupIds.length >= 2 ? (
                      <select value={r.kind} onChange={(e) => setRule(i, { ...r, kind: e.target.value as Rule['kind'] })} aria-label="Any or each">
                        <option value="any">One approval from any of these groups (or)</option>
                        <option value="each">An approval from each of these groups (and)</option>
                      </select>
                    ) : (
                      <span className="rule-edit-kind">One approval from</span>
                    )}
                    <button className="ghost" aria-label="Remove rule" onClick={() => setReq({ ...req, groups: req.groups.filter((_, j) => j !== i) })}>
                      ✕
                    </button>
                  </div>
                  {broken && <div className="field-error">⚠ Names a deleted group: {goneNames}. This can’t be met until you replace it or remove this rule.</div>}
                  {!broken && gone.length > 0 && (
                    <div className="field-warning">
                      {goneNames} was deleted. This still works through the other groups, and approvals from{' '}
                      {goneNames.endsWith('s') ? `${goneNames}’` : `${goneNames}’s`} former members no longer count toward it. Remove it to tidy up.
                    </div>
                  )}
                  <div className="rule-groups">
                    <div className="chips">
                      {r.groupIds.map((id, n) => (
                        <span key={id} className="chip-wrap">
                          {n > 0 && <span className="rule-joiner">{r.kind === 'any' ? 'or' : 'and'}</span>}
                          <span className={`chip ${gone.includes(id) ? 'chip-broken' : ''}`}>
                            {groupSearch.option(id)?.label}
                            {gone.includes(id) && ' (deleted)'}
                            <button className="chip-x" aria-label="Remove group" onClick={() => setRule(i, { ...r, groupIds: r.groupIds.filter((x) => x !== id) })}>
                              ✕
                            </button>
                          </span>
                        </span>
                      ))}
                    </div>
                    <Combobox
                      label="Add a group"
                      anyLabel={r.groupIds.length ? 'Add another group…' : 'Pick a group…'}
                      placeholder="Search by group name."
                      value=""
                      onChange={(id) => id && !r.groupIds.includes(id) && setRule(i, { ...r, groupIds: [...r.groupIds, id] })}
                      search={(q) => groupSearch.search(q).filter((o) => !r.groupIds.includes(o.id))}
                      display={groupSearch.option}
                    />
                    {r.groupIds.length === 0 && <span className="field-error">Pick a group.</span>}
                  </div>
                  <label className="check rule-auto">
                    <input type="checkbox" checked={!!r.autoAdd} onChange={(e) => setRule(i, { ...r, autoAdd: e.target.checked || undefined })} />
                    <span>
                      Add {r.groupIds.length === 1 ? 'this group as a reviewer' : 'these groups as reviewers'} automatically
                      <span className="hint"> · when an idea is created ready for review, or moves out of draft</span>
                    </span>
                  </label>
                </div>
              )
            })}
            <button onClick={() => setReq({ ...req, groups: [...req.groups, { kind: 'any', groupIds: [] }] })}>Add group rule</button>
          </>
        )}
      </div>

      <div className="req-block">
        <h3>Discussions</h3>
        <label className="check">
          <input type="checkbox" checked={req.resolved} onChange={(e) => setReq({ ...req, resolved: e.target.checked })} /> All discussions must be resolved
        </label>
        <p className="hint">
          Every comment thread on the idea is resolved.
          {req.resolved && !team.requirements.resolved && openThreads > 0 && ` ${fmt(openThreads)} active idea${openThreads === 1 ? ' has' : 's have'} open threads right now.`}
        </p>
      </div>

      <div className="req-summary">
        <b>{preview.length === 0 ? 'No requirements.' : 'Approved once all of these hold:'}</b>
        {preview.length === 0 ? (
          <span className="hint"> Ideas here can be closed as accepted any time.</span>
        ) : (
          <ul className="rules">
            {preview.map((c) => (
              <li key={c.key}>
                {c.text}
                {c.rule?.autoAdd && <span className="hint"> · added as {c.rule.groupIds.length === 1 ? 'a reviewer' : 'reviewers'} automatically</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {req.groups.some((r, i) => r.autoAdd && !team.requirements.groups[i]?.autoAdd) && (
        <p className="hint">Auto-adding applies from now on. Ideas already in review keep the reviewers they have.</p>
      )}
      <div className="row-end">
        <button className="ghost" disabled={!dirty} onClick={() => setReq(team.requirements)}>
          Discard
        </button>
        <button
          className="primary"
          disabled={setup ? !valid : !dirty || !valid}
          onClick={() => {
            if (dirty) dispatch({ type: 'setRequirements', teamId: team.id, requirements: req })
            if (setup) {
              // last setup step: saving finishes, so nothing is left behind unsaved
              dispatch({ type: 'toast', text: `${team.name} is ready` })
              navigate({ to: '/teams/$teamId', params: { teamId: team.id } } as never)
            } else dispatch({ type: 'toast', text: `Saved ${team.name}’s approval requirements` })
          }}
        >
          {setup ? (dirty ? 'Save and finish' : 'Finish without requirements') : 'Save requirements'}
        </button>
      </div>
    </section>
  )
}

// ---------- archive a team (admins). Teams are never deleted. ----------

function Archive({ team }: { team: Team }) {
  const { state, dispatch } = useStore()
  const [confirm, setConfirm] = useState('')
  const open = state.ideas.filter((i) => i.teamId === team.id && i.status !== 'closed')
  const drafts = open.filter((i) => i.status === 'draft').length

  if (team.archivedAt)
    return (
      <section className="section settings-form">
        <div className="banner banner-archived">
          <b>Archived {ago(team.archivedAt)} by {state.users[team.archivedBy!]?.name ?? 'an admin'}.</b> Its {fmt(open.length)} formerly open idea
          {open.length === 1 ? '' : 's'} count as archived and are read-only.
        </div>
        <p className="hint">Unarchiving makes the team usable again and returns those ideas to the state they were in.</p>
        <div className="row-end">
          <button
            onClick={() => {
              dispatch({ type: 'archiveTeam', id: team.id, archived: false })
              dispatch({ type: 'toast', text: `Unarchived ${team.name}` })
            }}
          >
            Unarchive team
          </button>
        </div>
      </section>
    )

  return (
    <section className="section settings-form">
      <p>
        Teams can’t be deleted, only archived. Archiving <b>{team.name}</b>:
      </p>
      <ul className="consequences">
        <li>Stops anyone starting new ideas in it.</li>
        <li>
          Freezes its <b>{fmt(open.length)} open idea{open.length === 1 ? '' : 's'}</b>
          {drafts ? ` (${fmt(drafts)} draft${drafts === 1 ? '' : 's'})` : ''}. They count as <b>archived</b>, a closed state, and their state can’t
          change. Everything stays readable and searchable.
        </li>
        <li>Keeps its members, history and closed ideas as they are.</li>
      </ul>
      <label className="field">
        <span className="field-label">
          Type <code>{team.name}</code> to confirm
        </span>
        <input value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </label>
      <div className="row-end">
        <button
          className="danger-solid"
          disabled={confirm !== team.name}
          onClick={() => {
            dispatch({ type: 'archiveTeam', id: team.id, archived: true })
            dispatch({ type: 'toast', text: `Archived ${team.name}` })
            setConfirm('')
          }}
        >
          Archive team
        </button>
      </div>
    </section>
  )
}

// ---------- delete a group (admins), with what it would break ----------

function DeleteGroup({ group }: { group: Group }) {
  const { state, dispatch } = useStore()
  const navigate = useNavigate()
  const [confirm, setConfirm] = useState('')
  // what each rule would look like once this group is gone
  const after = state.groups.map((g) => (g.id === group.id ? { ...g, deletedAt: 'pending' } : g))
  const teamsUsing = state.teams
    .filter((t) => !t.archivedAt)
    .map((t) => {
      const rules = usesGroup(t, group.id)
      return {
        team: t,
        breaks: rules.filter((r: Rule) => ruleBroken(after, r)),
        keeps: rules.filter((r: Rule) => !ruleBroken(after, r)),
        active: state.ideas.filter((i) => i.teamId === t.id && isActive(state, i)).length,
      }
    })
    .filter((x) => x.breaks.length + x.keeps.length > 0)
  const breaking = teamsUsing.filter((x) => x.breaks.length > 0)
  const softened = teamsUsing.filter((x) => x.breaks.length === 0)
  const blocked = breaking.reduce((n, x) => n + x.active, 0)
  const reviewing = state.ideas.filter((i) => isOpen(state, i) && i.reviewers.some((r) => r.kind === 'group' && r.groupId === group.id))

  return (
    <section className="section settings-form">
      <h2>What deleting {group.name} would affect</h2>
      {teamsUsing.length === 0 && reviewing.length === 0 ? (
        <p className="ok-note">✓ Nothing depends on this group. Its {fmt(group.members.length)} members simply stop being in it.</p>
      ) : (
        <ul className="consequences">
          {breaking.length > 0 && (
            <li className="is-serious">
              <b>
                Approval requirements in {breaking.length} team{breaking.length === 1 ? '' : 's'} can’t be met without this group.
              </b>{' '}
              They’ll show an error, and the <b>{fmt(blocked)} active idea{blocked === 1 ? '' : 's'}</b> in them can’t be approved until a maintainer or
              admin of each team replaces the group:
              <ul>
                {breaking.map(({ team, breaks, active }) => (
                  <li key={team.id}>
                    <Link to="/teams/$teamId" params={{ teamId: team.id }}>
                      {team.name}
                    </Link>{' '}
                    ({fmt(active)} active): {breaks.map((r) => ruleText(state.groups, r)).join('; ')}
                  </li>
                ))}
              </ul>
            </li>
          )}
          {softened.length > 0 && (
            <li>
              <b>
                {softened.length} team{softened.length === 1 ? '' : 's'} list{softened.length === 1 ? 's' : ''} it as one of several groups.
              </b>{' '}
              Those requirements keep working through the other groups, but approvals from this group’s members stop counting toward them:
              <ul>
                {softened.map(({ team, keeps }) => (
                  <li key={team.id}>
                    <Link to="/teams/$teamId" params={{ teamId: team.id }}>
                      {team.name}
                    </Link>
                    : {keeps.map((r) => ruleText(state.groups, r)).join('; ')}
                  </li>
                ))}
              </ul>
            </li>
          )}
          {reviewing.length > 0 && (
            <li>
              <b>
                It’s a reviewer on {fmt(reviewing.length)} open idea{reviewing.length === 1 ? '' : 's'}.
              </b>{' '}
              It will show there as a deleted reviewer, and its members stop getting review notifications through it.
            </li>
          )}
          <li>Its {fmt(group.members.length)} members stop being in it. Nobody loses access to anything else.</li>
        </ul>
      )}
      <p className="hint">Only admins can delete a group. This can’t be undone.</p>
      <label className="field">
        <span className="field-label">
          Type <code>{group.name}</code> to confirm
        </span>
        <input value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </label>
      <div className="row-end">
        <button
          className="danger-solid"
          disabled={confirm !== group.name}
          onClick={() => {
            dispatch({ type: 'deleteGroup', id: group.id })
            dispatch({ type: 'toast', text: `Deleted ${group.name}${breaking.length ? `. ${breaking.length} team${breaking.length === 1 ? '' : 's'} need${breaking.length === 1 ? 's' : ''} to fix their requirements.` : ''}` })
            navigate({ to: '/groups/$groupId', params: { groupId: group.id } } as never)
          }}
        >
          Delete group
        </button>
      </div>
    </section>
  )
}

// ---------- permanently delete a team (site admins only) ----------

function DeleteTeam({ team }: { team: Team }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="section settings-form">
      <AdminCallout title="Site admin only">
        Team admins never see this. Deleting a team permanently erases it and every idea in it. It can’t be undone. For almost every case, archive the
        team instead: it stops new work and keeps everything readable.
      </AdminCallout>
      <p className="hint">Use this for things that must not be kept at all, such as a team created by mistake or content you’re legally required to remove.</p>
      <div className="row-end">
        <button className="danger-solid via-admin-solid" onClick={() => setOpen(true)}>
          🛡 Delete {team.name} permanently…
        </button>
      </div>
      {open && <DeleteTeamDialog team={team} onClose={() => setOpen(false)} />}
    </section>
  )
}

function DeleteTeamDialog({ team, onClose }: { team: Team; onClose: () => void }) {
  const { state, dispatch } = useStore()
  const navigate = useNavigate()
  const [confirm, setConfirm] = useState('')
  const teamIdeas = state.ideas.filter((i) => i.teamId === team.id)
  const open = teamIdeas.filter((i) => isOpen(state, i)).length
  const archived = teamIdeas.filter((i) => isArchived(state, i)).length
  const closed = teamIdeas.length - open - archived
  const threads = teamIdeas.reduce((n, i) => n + i.openThreads, 0)
  const groupsNamedForIt = state.groups.filter((g) => !g.deletedAt && g.name.startsWith(`${team.name} `)).length

  return (
    <Dialog
      title={`Permanently delete ${team.name}?`}
      onClose={onClose}
      footer={
        <>
          {!team.archivedAt && (
            <button
              onClick={() => {
                dispatch({ type: 'archiveTeam', id: team.id, archived: true })
                dispatch({ type: 'toast', text: `Archived ${team.name} instead. Nothing was deleted.` })
                onClose()
              }}
            >
              Archive instead
            </button>
          )}
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="danger-solid"
            disabled={confirm !== team.name}
            onClick={() => {
              dispatch({ type: 'deleteTeam', id: team.id })
              dispatch({ type: 'toast', text: `Permanently deleted ${team.name} and its ${fmt(teamIdeas.length)} ideas` })
              navigate({ to: '/teams' } as never)
            }}
          >
            Delete permanently
          </button>
        </>
      }
    >
      <AdminMark label="Site admin action" />
      <div className="banner banner-error">
        <b>This can’t be undone.</b> There is no trash and no restore. Once it’s gone, nobody (including site admins) can get it back.
      </div>
      <p>This erases:</p>
      <ul className="consequences">
        <li className="is-serious">
          <b>
            All {fmt(teamIdeas.length)} idea{teamIdeas.length === 1 ? '' : 's'}
          </b>{' '}
          ({fmt(open)} open, {fmt(closed)} closed{archived ? `, ${fmt(archived)} archived` : ''}), with every version, file, comment, suggestion,
          review and approval{threads ? `, including ${fmt(threads)} open comment threads` : ''}.
        </li>
        <li>Every notification about those ideas, for everyone, and everyone’s watch settings for the team.</li>
        <li>The team itself: its {fmt(team.members.length)} memberships, roles, join requests and approval requirements.</li>
        <li>
          Every link to those ideas stops working, including links in docs, chat, commit messages and anything synced with the <code>ideaf</code> cli.
        </li>
      </ul>
      <p className="hint">
        People and groups aren’t affected{groupsNamedForIt ? ` (including the ${groupsNamedForIt} group${groupsNamedForIt === 1 ? '' : 's'} named after this team)` : ''}.
        If anything here might be needed later, export it first or archive the team instead.
      </p>
      <label className="field">
        <span className="field-label">
          Type <code>{team.name}</code> to confirm
        </span>
        <input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoFocus />
      </label>
    </Dialog>
  )
}
